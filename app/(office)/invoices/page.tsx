import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyRow,
  ErrorNote,
  List,
  ListRow,
  Mono,
  PageHeader,
  SectionTitle,
  Stats,
  Status,
  type Tone,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { shortDate, todayIST } from "@/lib/dates";
import { listInvoicePendingReports } from "@/lib/modules/invoices/service";
import { homeFor } from "@/lib/roles";
import { formatINR, METHOD_LABEL } from "../jobs/labels";
import { generateInvoiceFromSelectedReports } from "./actions";
import { invoicesTable, type InvoiceWithRelations } from "./db";

export const metadata = { title: "Invoices & Payments – BITA" };

function statusDisplay(inv: InvoiceWithRelations, today: string): { label: string; tone: Tone } {
  switch (inv.status) {
    case "draft":
      return { label: "Draft", tone: "wait" };
    case "paid":
      return { label: "Paid", tone: "ok" };
    case "cancelled":
      return { label: "Cancelled", tone: "none" };
    case "partly_paid":
      if (inv.due_date && inv.due_date < today && inv.balance > 0) {
        return { label: "Partly paid · Overdue", tone: "bad" };
      }
      return { label: "Partly paid", tone: "info" };
    case "issued":
    default:
      if (inv.due_date && inv.due_date < today && inv.balance > 0) {
        return { label: "Issued · Overdue", tone: "bad" };
      }
      return { label: "Issued", tone: "info" };
  }
}

export default async function InvoicesListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { status: statusFilter, error: actionError } = await searchParams;
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    redirect(homeFor(person?.roles));
  }

  const today = todayIST();

  const [invoicesRes, pendingReports] = await Promise.all([
    invoicesTable(supabase)
      .select(
        "*, jobs(id, job_no, po_number, po_date, scope, status, customer_id, quotation_id, customers(id, name, code, gstin, billing_address, payment_terms_days)), reports(id, report_no, method, status), invoice_reports(report_id, reports(id, report_no, method, status)), quotations(id, ref_no, status)",
      )
      .order("created_at", { ascending: false }) as Promise<{
      data: InvoiceWithRelations[] | null;
    }>,
    listInvoicePendingReports(supabase).catch(() => []),
  ]);

  const allInvoices = invoicesRes.data ?? [];
  const activeInvoices = allInvoices.filter((i) => i.status !== "cancelled");
  const drafts = allInvoices.filter((i) => i.status === "draft");
  const issuedUnpaid = activeInvoices.filter((i) => i.status !== "draft" && Number(i.balance) > 0);
  const overdue = issuedUnpaid.filter((i) => i.due_date && i.due_date < today);

  const totalBilled = activeInvoices
    .filter((i) => i.status !== "draft")
    .reduce((sum, i) => sum + (Number(i.total) || 0), 0);
  const totalOutstanding = issuedUnpaid.reduce((sum, i) => sum + (Number(i.balance) || 0), 0);
  const totalOverdue = overdue.reduce((sum, i) => sum + (Number(i.balance) || 0), 0);

  const filtered = allInvoices.filter((inv) => {
    if (!statusFilter || statusFilter === "all") return true;
    if (statusFilter === "overdue") {
      return (
        inv.status !== "draft" &&
        inv.status !== "cancelled" &&
        Number(inv.balance) > 0 &&
        !!inv.due_date &&
        inv.due_date < today
      );
    }
    return inv.status === statusFilter;
  });

  const filters = [
    { key: "all", label: `All (${allInvoices.length})` },
    { key: "draft", label: `Drafts (${drafts.length})` },
    { key: "issued", label: `Issued (${allInvoices.filter((i) => i.status === "issued").length})` },
    {
      key: "partly_paid",
      label: `Partly paid (${allInvoices.filter((i) => i.status === "partly_paid").length})`,
    },
    { key: "overdue", label: `Overdue (${overdue.length})` },
    { key: "paid", label: `Paid (${allInvoices.filter((i) => i.status === "paid").length})` },
    {
      key: "cancelled",
      label: `Cancelled (${allInvoices.filter((i) => i.status === "cancelled").length})`,
    },
  ];

  return (
    <>
      <PageHeader
        title="Invoices & Payments"
        subtitle="Generate GST invoices from one or several approved reports of the same customer GSTIN, issue BITA/YY-YY/INV-xxxx numbers, download PDF & Word, and record payments."
        action={
          <>
            <ButtonLink href="/price-list" variant="secondary" size="sm">
              Price list
            </ButtonLink>
            <ButtonLink href="/invoices/export" variant="secondary" size="sm">
              CA GST export (GSTR-1)
            </ButtonLink>
            <ButtonLink href="/jobs" variant="secondary" size="sm">
              Generate from a job
            </ButtonLink>
          </>
        }
      />

      <ErrorNote message={actionError} />

      <Stats
        items={[
          {
            label: "Total billed",
            value: formatINR(totalBilled),
            note: `${activeInvoices.filter((i) => i.status !== "draft").length} issued invoices`,
          },
          {
            label: "Outstanding balance",
            value: formatINR(totalOutstanding),
            note: `${issuedUnpaid.length} awaiting payment`,
          },
          {
            label: "Overdue",
            value: formatINR(totalOverdue),
            note:
              overdue.length > 0 ? (
                <span className="text-bad">{overdue.length} past due date</span>
              ) : (
                "nothing overdue"
              ),
          },
          {
            label: "Invoices pending",
            value: pendingReports.length,
            note:
              pendingReports.length > 0
                ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} to issue`
                : "all approved reports billed",
          },
        ]}
      />

      {/* Prepare invoice from one or several Invoice pending reports (P4a) */}
      <section className="mb-7">
        <SectionTitle>
          Prepare invoice from Invoice pending reports ({pendingReports.length})
        </SectionTitle>
        <Card className="space-y-4">
          <p className="text-[13px] text-ink-2">
            Approved reports stay <strong className="text-ink">Invoice pending</strong> until linked to a draft or issued invoice. Select one or several reports belonging to the{" "}
            <strong className="text-ink">same customer GSTIN</strong> to combine them onto one invoice. If the reports come from different POs, all PO numbers are combined on the invoice.
          </p>
          {pendingReports.length === 0 ? (
            <p className="text-sm text-ink-3">
              No approved reports are currently awaiting an invoice.
            </p>
          ) : (
            <form action={generateInvoiceFromSelectedReports} className="space-y-3">
              <input type="hidden" name="return_to" value="/invoices" />
              <div className="divide-y divide-line rounded-lg border border-line">
                {pendingReports.map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-sm hover:bg-surface-2"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <input
                        type="checkbox"
                        name="report_ids"
                        value={r.id}
                        className="h-4 w-4 rounded border-line"
                      />
                      <Mono>{r.report_no}</Mono>
                      <Status tone="wait">Invoice pending</Status>
                      <span className="text-xs text-ink-2">
                        {METHOD_LABEL[r.method as keyof typeof METHOD_LABEL] ?? r.method} · Job {r.job_no} ·{" "}
                        <strong className="text-ink">{r.customer_name}</strong>
                      </span>
                      {r.customer_gstin && <Badge>GSTIN {r.customer_gstin}</Badge>}
                      {r.customer_po_number && <Badge>PO {r.customer_po_number}</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-3">{shortDate(r.report_date)}</span>
                      <ButtonLink href={`/review/${r.id}`} variant="secondary" size="sm">
                        Report
                      </ButtonLink>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-xs text-ink-3">
                  Tick one or more reports with the same customer GSTIN and click Prepare invoice.
                </span>
                <Button type="submit">Prepare invoice for selected reports</Button>
              </div>
            </form>
          )}
        </Card>
      </section>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const active = (statusFilter ?? "all") === f.key;
          return (
            <Link
              key={f.key}
              href={f.key === "all" ? "/invoices" : `/invoices?status=${f.key}`}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                active
                  ? "bg-ink text-white"
                  : "border border-line bg-white text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <section>
        <SectionTitle>Invoices</SectionTitle>
        <List>
          {filtered.map((inv) => {
            const st = statusDisplay(inv, today);
            const displayNo = inv.invoice_no ?? inv.number ?? "Draft (Unissued)";
            const customerName = inv.jobs?.customers?.name ?? "Customer";
            const jobNo = inv.jobs?.job_no ?? "Job";
            const linkedReportNos = Array.from(
              new Set(
                [
                  ...(inv.invoice_reports ?? [])
                    .map((ir) => ir.reports?.report_no)
                    .filter((x): x is string => Boolean(x)),
                  inv.reports?.report_no ?? null,
                ].filter((x): x is string => Boolean(x)),
              ),
            );
            const reportPart =
              linkedReportNos.length > 1
                ? `Reports ${linkedReportNos.join(", ")}`
                : linkedReportNos.length === 1
                  ? `Report ${linkedReportNos[0]}`
                  : null;
            const detailParts = [
              jobNo,
              reportPart,
              inv.customer_po_number ? `PO ${inv.customer_po_number}` : null,
              inv.invoice_date ? `Dated ${shortDate(inv.invoice_date)}` : null,
              inv.due_date ? `Due ${shortDate(inv.due_date)}` : null,
              inv.reminders_paused ? "Reminders paused" : null,
            ].filter(Boolean);

            return (
              <ListRow
                key={inv.id}
                tone={st.tone}
                title={
                  <span className="inline-flex flex-wrap items-center gap-2.5">
                    <Mono>{displayNo}</Mono>
                    <Status tone={st.tone}>{st.label}</Status>
                    <span className="font-normal text-ink-2">{customerName}</span>
                  </span>
                }
                detail={detailParts.join(" · ")}
                action={
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-[13px] font-semibold text-ink tabular-nums">
                        {formatINR(Number(inv.total) || 0)}
                      </div>
                      {inv.status !== "draft" && inv.status !== "cancelled" && (
                        <div className="text-[11.5px] text-ink-3 tabular-nums">
                          Bal: {formatINR(Number(inv.balance) || 0)}
                        </div>
                      )}
                    </div>
                    <ButtonLink href={`/invoices/${inv.id}`} variant="secondary" size="sm">
                      {inv.status === "draft" ? "Review & issue" : "Open"}
                    </ButtonLink>
                  </div>
                }
              />
            );
          })}
          {filtered.length === 0 && (
            <EmptyRow>
              No invoices match this filter. Select one or more Invoice pending reports above to prepare a draft invoice.
            </EmptyRow>
          )}
        </List>
      </section>
    </>
  );
}
