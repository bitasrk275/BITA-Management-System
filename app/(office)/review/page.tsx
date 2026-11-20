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
  Select,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { daysBetween, shortDate, todayIST } from "@/lib/dates";
import type { Enums } from "@/lib/db/types";
import {
  isReportInvoicePending,
  loadActiveInvoiceReportMap,
} from "@/lib/modules/invoices/service";
import { homeFor } from "@/lib/roles";
import { getActiveTestMethods } from "@/lib/modules/settings/templates";
import { generateInvoiceFromSelectedReports } from "../invoices/actions";
import { getMethodLabel } from "../jobs/labels";

export const metadata = { title: "Reports – BITA" };

// Reviewer home: the report queue (R26). Signatures and seal are added only after approval (R27).
export default async function ReviewQueue({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    inspectionId?: string;
    filter?: string;
    method?: string;
  }>;
}) {
  const {
    error: actionError,
    inspectionId: preselectedInspectionId,
    filter,
    method: methodFilter,
  } = await searchParams;
  // Old links to the prepare form now open the Create report page.
  if (preselectedInspectionId) redirect(`/review/new?inspectionId=${encodeURIComponent(preselectedInspectionId)}`);
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "reviewer" || r === "management" || r === "office")) {
    redirect(homeFor(person?.roles));
  }

  const canBill = person.roles.some((r) => r === "management" || r === "office");
  const filterInvoicePending = filter === "invoice_pending";

  let queueQuery = supabase
    .from("reports")
    .select(
      "id, report_no, method, created_at, jobs(id, job_no, customers(name)), inspections(missing_fields, submitted_at)",
    )
    .eq("status", "in_review")
    .order("created_at");

  let draftsQuery = supabase
    .from("reports")
    .select(
      "id, report_no, method, status, jobs(id, job_no, customers(name)), inspections(missing_fields, submitted_at)",
    )
    .in("status", ["draft", "returned"])
    .order("created_at");

  let recentQuery = supabase
    .from("reports")
    .select(
      "id, report_no, method, status, approved_at, pdf_path, jobs(id, job_no, po_number, customers(name, gstin))",
    )
    .in("status", ["approved", "sent"])
    .order("approved_at", { ascending: false })
    .limit(50);

  let inspectionsQuery = supabase
    .from("inspections")
    .select(
      "id, job_id, method, submitted_at, missing_fields, jobs(job_no, customers(name))",
    )
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(50);

  if (methodFilter && methodFilter !== "all") {
    const enumVal = methodFilter as unknown as Enums<"test_method">;
    queueQuery = queueQuery.eq("method", enumVal);
    draftsQuery = draftsQuery.eq("method", enumVal);
    recentQuery = recentQuery.eq("method", enumVal);
    inspectionsQuery = inspectionsQuery.eq("method", enumVal);
  }

  const [queue, drafts, recent, inspectionsRes, reportedRes, activeInvoiceMap, activeMethods] =
    await Promise.all([
      queueQuery,
      draftsQuery,
      recentQuery,
      inspectionsQuery,
      supabase.from("reports").select("inspection_id").not("inspection_id", "is", null),
      loadActiveInvoiceReportMap(supabase),
      getActiveTestMethods(supabase).catch(() => []),
    ]);

  const today = todayIST();
  const waiting = queue.data ?? [];
  const oldest = waiting[0] ? daysBetween(waiting[0].created_at.slice(0, 10), today) : 0;
  const reportedInspections = new Set((reportedRes.data ?? []).map((r) => r.inspection_id));
  const toPrepare = (inspectionsRes.data ?? []).filter((i) => !reportedInspections.has(i.id));
  const approvedReports = recent.data ?? [];
  const invoicePendingReports = approvedReports.filter((r) =>
    isReportInvoicePending(r, activeInvoiceMap),
  );

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={
          waiting.length
            ? `${waiting.length} waiting · oldest ${oldest === 0 ? "today" : `${oldest} days`} · ${invoicePendingReports.length} invoice pending`
            : `${invoicePendingReports.length} approved report${invoicePendingReports.length === 1 ? "" : "s"} invoice pending`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink
              href={filterInvoicePending ? "/review" : "/review?filter=invoice_pending"}
              variant={filterInvoicePending ? "primary" : "secondary"}
              size="sm"
            >
              Invoice pending ({invoicePendingReports.length})
            </ButtonLink>
            <ButtonLink href="/report-preview/UT" variant="secondary" size="sm">
              Paper format preview
            </ButtonLink>
            <ButtonLink href="/review/new" size="sm">
              + Create report
            </ButtonLink>
          </div>
        }
      />

      <ErrorNote message={actionError} />

      {/* Filter pills */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link
          href={methodFilter ? `/review?method=${encodeURIComponent(methodFilter)}` : "/review"}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            !filterInvoicePending
              ? "bg-ink text-white"
              : "border border-line bg-surface text-ink-2 hover:text-ink"
          }`}
        >
          All queues
        </Link>
        <Link
          href={
            methodFilter
              ? `/review?filter=invoice_pending&method=${encodeURIComponent(methodFilter)}`
              : "/review?filter=invoice_pending"
          }
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            filterInvoicePending
              ? "bg-ink text-white"
              : "border border-line bg-surface text-ink-2 hover:text-ink"
          }`}
        >
          Invoice pending ({invoicePendingReports.length})
        </Link>

        {activeMethods.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pl-2 border-l border-line">
            <span className="text-xs text-ink-3">Method:</span>
            <Link
              href={filterInvoicePending ? "/review?filter=invoice_pending" : "/review"}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                !methodFilter
                  ? "bg-ink-2 text-white font-medium"
                  : "border border-line text-ink-2 hover:text-ink"
              }`}
            >
              All
            </Link>
            {activeMethods.map((m) => (
              <Link
                key={m.code}
                href={`/review?${filterInvoicePending ? "filter=invoice_pending&" : ""}method=${encodeURIComponent(m.code)}`}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
                  methodFilter === m.code
                    ? "bg-ink-2 text-white font-medium"
                    : "border border-line text-ink-2 hover:text-ink"
                }`}
              >
                {m.code}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Multi-report invoice builder for Invoice pending reports */}
      {(filterInvoicePending || (canBill && invoicePendingReports.length > 0)) && (
        <section className="mb-7">
          <SectionTitle>
            Invoice pending — approved reports awaiting billing ({invoicePendingReports.length})
          </SectionTitle>
          <Card className="space-y-4">
            <p className="text-[13px] text-ink-2">
              Approved reports stay <strong className="text-ink">Invoice pending</strong> until added to a draft or issued invoice. Tick one or several reports belonging to the{" "}
              <strong className="text-ink">same customer GSTIN</strong> to combine them on a single invoice (distinct customer POs are combined automatically).
            </p>
            {invoicePendingReports.length === 0 ? (
              <p className="text-sm text-ink-3">
                All approved reports have been added to an invoice.
              </p>
            ) : (
              <form action={generateInvoiceFromSelectedReports} className="space-y-3">
                <input
                  type="hidden"
                  name="return_to"
                  value={filterInvoicePending ? "/review?filter=invoice_pending" : "/review"}
                />
                <div className="divide-y divide-line rounded-lg border border-line">
                  {invoicePendingReports.map((r) => {
                    const gstin = r.jobs?.customers?.gstin;
                    const poNo = r.jobs?.po_number;
                    return (
                      <label
                        key={r.id}
                        className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-sm hover:bg-surface-2"
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          {canBill && (
                            <input
                              type="checkbox"
                              name="report_ids"
                              value={r.id}
                              className="h-4 w-4 rounded border-line"
                            />
                          )}
                          <Mono>{r.report_no}</Mono>
                          <Status tone="wait">Invoice pending</Status>
                          <Status tone="ok">
                            {r.status === "sent" ? "Sent" : "Approved"}
                          </Status>
                          <span className="text-xs text-ink-2">
                            {getMethodLabel(r.method)} · Job {r.jobs?.job_no ?? "—"} ·{" "}
                            <strong className="text-ink">
                              {r.jobs?.customers?.name ?? "Customer"}
                            </strong>
                          </span>
                          {gstin && <Badge>GSTIN {gstin}</Badge>}
                          {poNo && <Badge>PO {poNo}</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          {r.approved_at && (
                            <span className="text-xs text-ink-3">
                              {shortDate(r.approved_at.slice(0, 10))}
                            </span>
                          )}
                          <ButtonLink href={`/review/${r.id}`} variant="secondary" size="sm">
                            View
                          </ButtonLink>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {canBill && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <span className="text-xs text-ink-3">
                      Select one or more reports of the same customer (same GSTIN), choose Tax invoice or Proforma, and click Prepare invoice.
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select name="kind" defaultValue="tax_invoice" className="w-56">
                        <option value="tax_invoice">Tax invoice (BITA/YY-YY/INV-xxxx)</option>
                        <option value="proforma">Proforma invoice (BITA/YY-YY/PI-xxxx)</option>
                      </Select>
                      <Button type="submit">Prepare invoice</Button>
                    </div>
                  </div>
                )}
              </form>
            )}
          </Card>
        </section>
      )}

      {!filterInvoicePending && (
        <div className="space-y-7">
          <section>
            <SectionTitle>1. To prepare: field data from technicians ({toPrepare.length})</SectionTitle>
            <List>
              {toPrepare.map((insp) => (
                <ListRow
                  key={insp.id}
                  tone="wait"
                  title={
                    <div className="flex flex-wrap items-center gap-2">
                      <Mono>{insp.jobs?.job_no ?? "Job"}</Mono>
                      <span className="font-normal text-ink-2">
                        {getMethodLabel(insp.method)} · {insp.jobs?.customers?.name ?? "Customer"}
                      </span>
                    </div>
                  }
                  detail={`Submitted ${insp.submitted_at ? shortDate(insp.submitted_at.slice(0, 10)) : ""}${
                    insp.missing_fields?.length ? ` · Missing: ${insp.missing_fields.join(", ")}` : ""
                  }`}
                  action={
                    <ButtonLink href={`/review/new?inspectionId=${insp.id}`} size="sm">
                      Create report
                    </ButtonLink>
                  }
                />
              ))}
              {toPrepare.length === 0 && (
                <EmptyRow>Nothing to prepare. Use + Create report to start a report on its own.</EmptyRow>
              )}
            </List>
          </section>

          <section>
            <SectionTitle>2. Being prepared or returned ({drafts.data?.length ?? 0})</SectionTitle>
            <List>
              {(drafts.data ?? []).map((r) => (
                <ListRow
                  key={r.id}
                  tone={r.status === "returned" ? "bad" : "none"}
                  title={
                    <div className="flex flex-wrap items-center gap-2">
                      <Mono>{r.report_no}</Mono>
                      <Status tone={r.status === "returned" ? "bad" : "none"}>
                        {r.status === "returned" ? "Returned" : "Draft"}
                      </Status>
                      {!r.jobs && <Status tone="wait">No job linked</Status>}
                    </div>
                  }
                  detail={`${getMethodLabel(r.method)}${r.jobs ? ` · ${r.jobs.job_no} · ${r.jobs.customers?.name ?? ""}` : ""}`}
                  action={
                    <ButtonLink href={`/review/${r.id}`} variant="secondary" size="sm">
                      Open
                    </ButtonLink>
                  }
                />
              ))}
              {(drafts.data?.length ?? 0) === 0 && <EmptyRow>No reports being prepared.</EmptyRow>}
            </List>
          </section>

          <section>
            <SectionTitle>
              3. Waiting for approval ({waiting.length}
              {waiting.length ? `, oldest ${oldest === 0 ? "today" : `${oldest} days`}` : ""})
            </SectionTitle>
            <List>
              {waiting.map((r) => {
                const missing = r.inspections?.missing_fields ?? [];
                return (
                  <ListRow
                    key={r.id}
                    tone={missing.length ? "wait" : "bad"}
                    title={
                      <div className="flex flex-wrap items-center gap-2">
                        <Mono>{r.report_no}</Mono>
                        <span className="font-normal text-ink-2">
                          {getMethodLabel(r.method)} · {r.jobs?.customers?.name}
                        </span>
                      </div>
                    }
                    detail={
                      missing.length
                        ? `Job ${r.jobs?.job_no ?? "—"} · Missing: ${missing.join(", ")}`
                        : `Job ${r.jobs?.job_no ?? "—"} · Field data complete`
                    }
                    action={
                      <ButtonLink href={`/review/${r.id}`} variant={missing.length ? "secondary" : "primary"} size="sm">
                        Review
                      </ButtonLink>
                    }
                  />
                );
              })}
              {waiting.length === 0 && <EmptyRow>No reports waiting for approval.</EmptyRow>}
            </List>
            <p className="mt-3 text-xs text-ink-3">
              Signatures and the company seal are added only after a reviewer approves.
            </p>
          </section>

          <section>
            <SectionTitle>4. Approved</SectionTitle>
            <List>
              {approvedReports.slice(0, 12).map((r) => {
                const invLink = activeInvoiceMap.get(r.id);
                const pending = isReportInvoicePending(r, activeInvoiceMap);
                return (
                  <ListRow
                    key={r.id}
                    tone={pending ? "wait" : "ok"}
                    title={
                      <div className="flex flex-wrap items-center gap-2">
                        <Mono>{r.report_no}</Mono>
                        <Status tone="ok">{r.status === "sent" ? "Sent" : "Approved"}</Status>
                        {pending ? (
                          <Status tone="wait">Invoice pending</Status>
                        ) : invLink ? (
                          <Badge>{invLink.invoice_no}</Badge>
                        ) : null}
                      </div>
                    }
                    detail={`${getMethodLabel(r.method)} · ${r.jobs?.customers?.name ?? ""}${
                      r.approved_at ? ` · ${shortDate(r.approved_at.slice(0, 10))}` : ""
                    }`}
                    action={
                      <ButtonLink href={`/review/${r.id}`} variant="secondary" size="sm">
                        View
                      </ButtonLink>
                    }
                  />
                );
              })}
              {approvedReports.length === 0 && <EmptyRow>No approved reports yet.</EmptyRow>}
            </List>
          </section>
        </div>
      )}
    </>
  );
}
