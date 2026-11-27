import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, ButtonLink, Card, ErrorNote, Fold, PageHeader, SavedNote, SecondaryButton, SignSymbol, Status, StepRoute, type RouteStep } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { checkPoUtilization } from "@/lib/modules/po/service";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";
import { formatIST } from "../../enquiries/labels";
import { closeJob, deleteJob, reopenJob, updateJob } from "../actions";
import { generateInvoiceFromJob } from "../../invoices/actions";
import { isJobReadyToClose } from "../closure";
import { JobForm } from "../job-form";
import { formatINR, JOB_STATUS_LABEL, METHOD_LABEL } from "../labels";
import { jobFormOptions } from "../options";
import { JobMoneyActions } from "./money-actions";
import { SiteFiles } from "./site-files";
import { SiteNotes } from "./site-notes";

// R18: one page shows everything for a Job ID.
export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const { supabase, person } = await requireStaff();

  const { data: job } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  if (!job) notFound();

  const [customer, contacts, enquiry, quotation, assignments, inspections, reports, attachments, invoices, options, canDelete] = await Promise.all([
    supabase.from("customers").select("*").eq("id", job.customer_id).maybeSingle(),
    supabase.from("customer_contacts").select("name, mobile, email, receives_reports, receives_invoices").eq("customer_id", job.customer_id),
    job.enquiry_id ? supabase.from("enquiries").select("id, subject, source, received_at").eq("id", job.enquiry_id).maybeSingle() : null,
    job.quotation_id
      ? supabase.from("quotations").select("id, ref_no, status, quote_date, quotation_items(description, basis, rate, minimum_charge)").eq("id", job.quotation_id).maybeSingle()
      : null,
    supabase.from("assignments").select("id, work_date, acknowledged_at, completed_at, people(full_name)").eq("job_id", id).order("work_date"),
    supabase.from("inspections").select("id, method, submitted_at, missing_fields").eq("job_id", id),
    supabase.from("reports").select("id, report_no, method, status, approved_at, sent_at").eq("job_id", id).order("report_no"),
    supabase.from("attachments").select("id, kind, caption, storage_path").eq("job_id", id).order("uploaded_at"),
    supabase.from("invoices").select("id, kind, number, invoice_date, due_date, total, balance, status").eq("job_id", id).order("invoice_date"),
    jobFormOptions(supabase),
    hasPermissionForRoles(supabase, person?.roles, "delete"),
  ]);

  const poUrl = job.po_path
    ? (await supabase.storage.from("documents").createSignedUrl(job.po_path, 600)).data?.signedUrl
    : null;
  const poCheck = await checkPoUtilization(supabase, {
    jobId: job.id,
    customerId: job.customer_id,
    poNumber: job.po_number,
    poValue: job.po_value,
  });
  // Outstanding is the balance of issued invoices only; drafts are not owed yet (D-017).
  const outstanding = (invoices.data ?? [])
    .filter((i) => i.status === "issued" || i.status === "partly_paid")
    .reduce((sum, i) => sum + (i.balance ?? 0), 0);
  const isManagement = !!person?.roles.includes("management");
  const canWriteJob = !!person?.roles.some((r) => r === "management" || r === "office");
  const readyToClose = isJobReadyToClose({
    status: job.status,
    reports: reports.data ?? [],
    invoices: invoices.data ?? [],
  });

  // The job route, Enquiry to Paid, and the one next thing to do.
  const reportRows = reports.data ?? [];
  const invoiceRows = invoices.data ?? [];
  const assignmentRows = assignments.data ?? [];
  const issued = invoiceRows.filter((i) => ["issued", "partly_paid", "paid"].includes(i.status ?? ""));
  const approvedReport = reportRows.find((r) => r.status === "approved" || r.status === "sent" || r.approved_at);
  const openReport = reportRows.find((r) => r.status === "draft" || r.status === "in_review");
  const siteDone =
    assignmentRows.some((a) => a.completed_at) || (inspections.data ?? []).some((i) => i.submitted_at) || reportRows.length > 0;
  const reached = {
    enquiry: true,
    quote: Boolean(quotation?.data || job.po_number || assignmentRows.length || reportRows.length),
    site: siteDone,
    report: Boolean(approvedReport),
    invoice: issued.length > 0,
    paid: issued.length > 0 && outstanding <= 0,
  };
  const order = ["enquiry", "quote", "site", "report", "invoice", "paid"] as const;
  const firstOpen = order.find((k) => !reached[k]);
  const stepLabels: Record<(typeof order)[number], string> = {
    enquiry: "Enquiry",
    quote: "Quote / PO",
    site: "On site",
    report: "Report",
    invoice: "Invoice",
    paid: "Paid",
  };
  const nextSiteDate = assignmentRows.map((a) => a.work_date).sort().at(-1);
  const showDate = (d?: string) => (d ? d.split("-").reverse().join("-") : undefined);
  const stepDetail: Partial<Record<(typeof order)[number], string>> = {
    quote: job.po_number ? `PO ${job.po_number}` : quotation?.data?.ref_no ?? undefined,
    site: showDate(nextSiteDate),
    report: approvedReport?.report_no ?? openReport?.report_no ?? undefined,
    invoice: issued[0]?.number ?? undefined,
    paid: issued.length ? (outstanding > 0 ? `${formatINR(outstanding)} due` : "Settled") : undefined,
  };
  const steps: RouteStep[] = order.map((k) => ({
    label: stepLabels[k],
    state: job.status === "closed" || reached[k] ? "done" : k === firstOpen ? "current" : "todo",
    detail: stepDetail[k],
  }));

  type Next = { text: string; detail?: string; href?: string; label: string; form?: "invoice" | "close"; waiting?: boolean };
  const submittedInspection = (inspections.data ?? []).find((i) => i.submitted_at);
  const isReviewerOnly = !canWriteJob;
  const nextAll: Next | null =
    job.status === "closed"
      ? null
      : !reached.site
        ? assignmentRows.length === 0
          ? { text: "Assign a technician", detail: "Pick who goes to site, the dates and the instruments.", href: `/jobs/${job.id}/assign`, label: "Assign technician" }
          : { text: "Waiting for site work", detail: `Booked for ${showDate(nextSiteDate)}. Field data shows here when the technician sends it.`, href: `/jobs/${job.id}/assign`, label: "Change booking", waiting: true }
        : !reached.report
          ? openReport
            ? {
                text: `Finish report ${openReport.report_no}`,
                detail: openReport.status === "in_review" ? "Waiting for technical approval." : "Complete the readings, then send it for approval.",
                href: `/review/${openReport.id}`,
                label: "Open report",
                waiting: openReport.status === "in_review",
              }
            : { text: "Prepare the inspection report", detail: "Most details fill in from this job automatically.", href: submittedInspection ? `/review/new?inspectionId=${submittedInspection.id}` : "/review/new", label: "Create report" }
          : !reached.invoice
            ? { text: "Make the invoice", detail: "Built from the approved report and the quotation rates.", label: "Generate invoice", form: "invoice" }
            : !reached.paid
              ? { text: `Collect payment: ${formatINR(outstanding)}`, detail: "When the money arrives, tick the job as paid.", href: issued[0] ? `/invoices/${issued[0].id}` : "/invoices", label: "Open invoice" }
              : readyToClose && canWriteJob
                ? { text: "Everything is done", detail: "Report sent and payment received. Close the job.", label: "Close job", form: "close" }
                : null;
  // Reviewers only act on reports; office steps are not theirs.
  const next = isReviewerOnly ? (nextAll && nextAll.href?.startsWith("/review") ? nextAll : null) : nextAll;

  return (
    <>
      <PageHeader
        title={job.job_no}
        subtitle={[customer.data?.name, job.site].filter(Boolean).join(" · ") || undefined}
        action={
          job.status === "closed" ? (
            isManagement ? (
              <form action={reopenJob.bind(null, job.id)}>
                <SecondaryButton type="submit">
                  Reopen job
                </SecondaryButton>
              </form>
            ) : undefined
          ) : readyToClose && canWriteJob ? (
            <form action={closeJob.bind(null, job.id)}>
              <SecondaryButton type="submit">Close job</SecondaryButton>
            </form>
          ) : undefined
        }
      />
      <ErrorNote message={error} />
      {saved && <SavedNote />}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge>{JOB_STATUS_LABEL[job.status]}</Badge>
        {job.closed_at && <span className="text-[14px] text-ink-3">Closed {formatIST(job.closed_at)}</span>}
        {job.test_methods.map((m) => (
          <Badge key={m}>{METHOD_LABEL[m]}</Badge>
        ))}
      </div>

      <StepRoute steps={steps} />

      {next ? (
        <section
          aria-label="Next step"
          className={`mb-8 mt-4 flex flex-col gap-4 rounded-lg border-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 ${next.waiting ? "border-caution bg-caution/[0.08]" : "border-sign bg-sign/[0.04]"}`}
        >
          <div className="flex min-w-0 items-start gap-3.5">
            <SignSymbol tone={next.form === "close" ? "ok" : next.waiting ? "wait" : "info"} size={32} />
            <div className="min-w-0">
              <p className={`font-sign text-[14px] font-bold uppercase tracking-[0.06em] ${next.waiting ? "text-ink" : "text-sign"}`}>{next.waiting ? "Waiting" : "Next step"}</p>
              <p className="font-sign text-[24px] font-bold leading-tight text-ink">{next.text}</p>
              {next.detail && <p className="mt-1 text-[15px] text-ink-2">{next.detail}</p>}
            </div>
          </div>
          {next.form === "invoice" ? (
            <form action={generateInvoiceFromJob.bind(null, job.id)} className="shrink-0">
              <Button type="submit" className="w-full sm:w-auto">
                {next.label}
              </Button>
            </form>
          ) : next.form === "close" ? (
            <form action={closeJob.bind(null, job.id)} className="shrink-0">
              <Button type="submit" className="w-full sm:w-auto">
                {next.label}
              </Button>
            </form>
          ) : (
            <div className="shrink-0 [&>a]:w-full sm:[&>a]:w-auto">
              <ButtonLink href={next.href!} variant={next.waiting ? "secondary" : "primary"}>
                {next.label}
              </ButtonLink>
            </div>
          )}
        </section>
      ) : (
        <div className="mb-8" />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div id="job-work" className="min-w-0 scroll-mt-24 space-y-6">
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-sign text-[20px] font-bold">Technicians and inspections</h2>
              <ButtonLink href={`/jobs/${job.id}/assign`} variant="secondary" size="sm">
                Assign technician
              </ButtonLink>
            </div>
            <ul className="space-y-1.5 text-[15px]">
              {assignments.data?.map((a) => (
                <li key={a.id}>
                  {a.work_date}: {a.people?.full_name}
                  <span className="text-[14px] text-ink-3">
                    {a.completed_at ? " · completed" : a.acknowledged_at ? " · acknowledged" : " · not acknowledged"}
                  </span>
                </li>
              ))}
              {assignments.data?.length === 0 && <li className="text-ink-3">No technician assigned yet.</li>}
            </ul>
            <ul className="mt-3 space-y-1.5 text-[15px]">
              {inspections.data?.map((i) => (
                <li key={i.id}>
                  {METHOD_LABEL[i.method]} field data:{" "}
                  {i.submitted_at ? `submitted ${formatIST(i.submitted_at)}` : "not submitted"}
                  {i.missing_fields.length > 0 && (
                    <span className="text-ink"> · missing {i.missing_fields.join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="mb-2.5 font-sign text-[20px] font-bold">Reports</h2>
            <ul className="space-y-1.5 text-[15px]">
              {reports.data?.map((r) => (
                <li key={r.id}>
                  <Link href={`/review/${r.id}`} className="font-medium text-ink underline">
                    {r.report_no}
                  </Link>{" "}
                  · {METHOD_LABEL[r.method]} · {r.status}
                  {r.sent_at && <span className="text-[14px] text-ink-3"> · sent {formatIST(r.sent_at)}</span>}
                </li>
              ))}
              {reports.data?.length === 0 && <li className="text-ink-3">No reports yet.</li>}
            </ul>
            {attachments.data && attachments.data.length > 0 && (
              <>
                <h3 className="mt-4 font-semibold">Drawings and documents</h3>
                <ul className="space-y-1.5 text-[15px]">
                  {attachments.data.map((a) => (
                    <li key={a.id}>
                      {a.caption ?? a.storage_path.split("/").pop()} <span className="text-[14px] text-ink-3">({a.kind})</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <SiteFiles jobId={job.id} />
          <SiteNotes jobId={job.id} />
          <JobMoneyActions job={job} customer={customer.data} reports={reports.data ?? []} invoices={invoices.data ?? []} />

        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <h2 className="mb-2.5 font-sign text-[20px] font-bold">Customer</h2>
            {customer.data && (
              <>
                <Link href={`/customers/${customer.data.id}`} className="font-medium text-ink underline">
                  {customer.data.name}
                </Link>
                <p className="mt-1 text-[15px] text-ink-2">
                  {[customer.data.gstin, customer.data.uses_proforma ? "Proforma first" : null, `${customer.data.payment_terms_days} days`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <ul className="mt-2 space-y-1.5 text-[15px]">
                  {contacts.data?.map((c) => (
                    <li key={c.name} className="break-words">
                      {c.name}
                      <span className="text-[14px] text-ink-3">
                        {" "}
                        {[c.mobile, c.email].filter(Boolean).join(" · ")}
                        {c.receives_reports ? " · reports" : ""}
                        {c.receives_invoices ? " · invoices" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <h2 className="mb-2.5 font-sign text-[20px] font-bold">Enquiry, quotation and PO</h2>
            <dl className="space-y-3 text-[15px]">
              <div>
                <dt className="text-ink-3">Enquiry</dt>
                <dd>
                  {enquiry?.data ? (
                    <Link href={`/enquiries/${enquiry.data.id}`} className="text-ink underline">
                      {enquiry.data.subject ?? "(no subject)"}
                    </Link>
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Quotation</dt>
                <dd>
                  {quotation?.data ? (
                    <>
                      <Link href={`/quotations/${quotation.data.id}`} className="text-ink underline">
                        {quotation.data.ref_no ?? "Draft"}
                      </Link>{" "}
                      ({quotation.data.status})
                      <ul className="mt-1 list-disc pl-5 text-[13px] text-ink-2">
                        {quotation.data.quotation_items.map((it, n) => (
                          <li key={n}>
                            {it.description}: {formatINR(it.rate)} {it.basis ?? ""}
                            {it.minimum_charge ? `, minimum ${formatINR(it.minimum_charge)}` : ""}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    "None yet"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">PO</dt>
                <dd>
                  {job.po_number ?? "Not received yet"}
                  {job.po_date && ` · ${job.po_date}`}
                  {job.po_value !== null && job.po_value !== undefined && (
                    <span> · Value {formatINR(job.po_value)}</span>
                  )}
                  {poUrl && (
                    <>
                      {" · "}
                      <a href={poUrl} target="_blank" rel="noreferrer" className="text-ink underline">
                        Open PO file
                      </a>
                    </>
                  )}
                </dd>
                {poCheck.exceedsPoValue && poCheck.warningMessage && (
                  <div className="mt-2">
                    <Status tone="wait">{poCheck.warningMessage}</Status>
                  </div>
                )}
              </div>
            </dl>
          </Card>

          <Fold title="Edit job details">
            <JobForm action={updateJob.bind(null, id)} job={job} submitLabel="Save changes" {...options} />
          </Fold>

          {canDelete && (
            <Card>
              <details>
                <summary className="cursor-pointer text-[15px] font-medium text-bad">
                  Delete job
                </summary>
                {(invoices.data ?? []).some(
                  (i) => i.status !== "cancelled" && ["issued", "partially_paid", "partly_paid", "paid"].includes(i.status)
                ) ? (
                  <p className="mt-2 text-[13px] text-bad">
                    Cannot delete this job: an issued invoice exists. Cancel the invoice with a credit note first before deleting.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-[13px] text-ink-3">
                      Deleting moves job <strong>{job.job_no}</strong> to the{" "}
                      <Link href="/recycle-bin" className="underline">
                        recycle bin
                      </Link>
                      , where management can restore it at any time.
                    </p>
                    <form action={deleteJob.bind(null, id)} className="mt-3">
                      <SecondaryButton type="submit">Confirm delete job</SecondaryButton>
                    </form>
                  </>
                )}
              </details>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
