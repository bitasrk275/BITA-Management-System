import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ButtonLink,
  EmptyRow,
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
import { homeFor } from "@/lib/roles";
import { formatINR } from "../jobs/labels";
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
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusFilter } = await searchParams;
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    redirect(homeFor(person?.roles));
  }

  const today = todayIST();

  const { data } = (await invoicesTable(supabase)
    .select(
      "*, jobs(id, job_no, po_number, po_date, scope, status, customer_id, quotation_id, customers(id, name, code, gstin, billing_address, payment_terms_days)), reports(id, report_no, method, status), quotations(id, ref_no, status)",
    )
    .order("created_at", { ascending: false })) as { data: InvoiceWithRelations[] | null };

  const allInvoices = data ?? [];
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
      return inv.status !== "draft" && inv.status !== "cancelled" && Number(inv.balance) > 0 && !!inv.due_date && inv.due_date < today;
    }
    return inv.status === statusFilter;
  });

  const filters = [
    { key: "all", label: `All (${allInvoices.length})` },
    { key: "draft", label: `Drafts (${drafts.length})` },
    { key: "issued", label: `Issued (${allInvoices.filter((i) => i.status === "issued").length})` },
    { key: "partly_paid", label: `Partly paid (${allInvoices.filter((i) => i.status === "partly_paid").length})` },
    { key: "overdue", label: `Overdue (${overdue.length})` },
    { key: "paid", label: `Paid (${allInvoices.filter((i) => i.status === "paid").length})` },
    { key: "cancelled", label: `Cancelled (${allInvoices.filter((i) => i.status === "cancelled").length})` },
  ];

  return (
    <>
      <PageHeader
        title="Invoices & Payments"
        subtitle="Generate GST invoices from approved reports, issue BITA/YY-YY/INV-xxxx numbers, download PDF & Word, and record payments."
        action={
          <>
            <ButtonLink href="/invoices/export" variant="secondary" size="sm">
              CA GST export (GSTR-1)
            </ButtonLink>
            <ButtonLink href="/jobs" variant="secondary" size="sm">
              Generate from a job
            </ButtonLink>
          </>
        }
      />

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
            note: overdue.length > 0 ? <span className="text-bad">{overdue.length} past due date</span> : "nothing overdue",
          },
          {
            label: "Drafts to issue",
            value: drafts.length,
            note: drafts.length > 0 ? "Review & issue number" : "all caught up",
          },
        ]}
      />

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
            const detailParts = [
              jobNo,
              inv.reports?.report_no ? `Report ${inv.reports.report_no}` : null,
              inv.invoice_date ? `Dated ${shortDate(inv.invoice_date)}` : null,
              inv.due_date ? `Due ${shortDate(inv.due_date)}` : null,
              inv.reminders_paused ? "Reminders paused" : null,
            ].filter(Boolean);

            return (
              <ListRow
                key={inv.id}
                tone={st.tone}
                title={
                  <Link href={`/invoices/${inv.id}`} className="hover:underline">
                    <Mono>{displayNo}</Mono>
                    <span className="ml-2.5 font-normal text-ink-2">{customerName}</span>
                  </Link>
                }
                detail={detailParts.join(" · ")}
                action={
                  <div className="flex flex-wrap items-center justify-end gap-2 text-right">
                    <div className="text-right text-[13px]">
                      <div className="font-semibold text-ink tabular-nums">{formatINR(Number(inv.total) || 0)}</div>
                      <div className="text-[11.5px] text-ink-3 tabular-nums">
                        Balance: {formatINR(Number(inv.balance) || 0)}
                      </div>
                    </div>
                    <Status tone={st.tone}>{st.label}</Status>
                    <ButtonLink href={`/invoices/${inv.id}`} variant="secondary" size="sm">
                      Open
                    </ButtonLink>
                  </div>
                }
              />
            );
          })}
          {filtered.length === 0 && (
            <EmptyRow>
              No invoices match this view. Open an approved report or a job and click Generate invoice to create a draft.
            </EmptyRow>
          )}
        </List>
      </section>
    </>
  );
}
