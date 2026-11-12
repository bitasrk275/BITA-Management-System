import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, ButtonLink, Card, ErrorNote, PageHeader, SavedNote, SecondaryButton, Status } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { checkPoUtilization } from "@/lib/modules/po/service";
import { formatIST } from "../../enquiries/labels";
import { closeJob, reopenJob, updateJob } from "../actions";
import { generateInvoiceFromJob } from "../../invoices/actions";
import { isJobReadyToClose } from "../closure";
import { JobForm } from "../job-form";
import { formatINR, JOB_STATUS_LABEL, METHOD_LABEL } from "../labels";
import { jobFormOptions } from "../options";

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

  const [customer, contacts, enquiry, quotation, assignments, inspections, reports, attachments, invoices, options] = await Promise.all([
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

  return (
    <>
      <PageHeader
        title={job.job_no}
        action={
          job.status === "closed" ? (
            isManagement ? (
              <form action={reopenJob.bind(null, job.id)}>
                <SecondaryButton type="submit">
                  Reopen job
                </SecondaryButton>
              </form>
            ) : undefined
          ) : isManagement || (readyToClose && canWriteJob) ? (
            <form action={closeJob.bind(null, job.id)}>
              <Button type="submit">Close job</Button>
            </form>
          ) : undefined
        }
      />
      <ErrorNote message={error} />
      {saved && <SavedNote />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge>{JOB_STATUS_LABEL[job.status]}</Badge>
        {readyToClose && <Status tone="ok">Ready to close</Status>}
        {job.closed_at && <span className="text-xs text-ink-3">Closed {formatIST(job.closed_at)}</span>}
        {job.test_methods.map((m) => (
          <Badge key={m}>{METHOD_LABEL[m]}</Badge>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-2 font-semibold">Customer</h2>
            {customer.data && (
              <>
                <Link href={`/customers/${customer.data.id}`} className="font-medium text-ink underline">
                  {customer.data.name}
                </Link>
                <p className="mt-1 text-sm text-ink-2">
                  {[customer.data.gstin, customer.data.uses_proforma ? "Proforma first" : null, `${customer.data.payment_terms_days} days`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {contacts.data?.map((c) => (
                    <li key={c.name} className="break-words">
                      {c.name}
                      <span className="text-xs text-ink-3">
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
            <h2 className="mb-2 font-semibold">Enquiry, quotation and PO</h2>
            <dl className="space-y-2 text-sm">
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
                      <ul className="mt-1 list-disc pl-5 text-xs text-ink-2">
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

          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Technicians and inspections</h2>
              <ButtonLink href={`/jobs/${job.id}/assign`} variant="secondary" size="sm">
                Assign technician
              </ButtonLink>
            </div>
            <ul className="space-y-1 text-sm">
              {assignments.data?.map((a) => (
                <li key={a.id}>
                  {a.work_date}: {a.people?.full_name}
                  <span className="text-xs text-ink-3">
                    {a.completed_at ? " · completed" : a.acknowledged_at ? " · acknowledged" : " · not acknowledged"}
                  </span>
                </li>
              ))}
              {assignments.data?.length === 0 && <li className="text-ink-3">No technician assigned yet.</li>}
            </ul>
            <ul className="mt-3 space-y-1 text-sm">
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
            <h2 className="mb-2 font-semibold">Reports</h2>
            <ul className="space-y-1 text-sm">
              {reports.data?.map((r) => (
                <li key={r.id}>
                  <Link href={`/review/${r.id}`} className="font-medium text-ink underline">
                    {r.report_no}
                  </Link>{" "}
                  · {METHOD_LABEL[r.method]} · {r.status}
                  {r.sent_at && <span className="text-xs text-ink-3"> · sent {formatIST(r.sent_at)}</span>}
                </li>
              ))}
              {reports.data?.length === 0 && <li className="text-ink-3">No reports yet.</li>}
            </ul>
            {attachments.data && attachments.data.length > 0 && (
              <>
                <h3 className="mt-3 text-sm font-semibold">Drawings and documents</h3>
                <ul className="space-y-1 text-sm">
                  {attachments.data.map((a) => (
                    <li key={a.id}>
                      {a.caption ?? a.storage_path.split("/").pop()} <span className="text-xs text-ink-3">({a.kind})</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Invoices and payments</h2>
              <form action={generateInvoiceFromJob.bind(null, job.id)}>
                <Button type="submit">Generate invoice</Button>
              </form>
            </div>
            <p className="mb-2 text-xs text-ink-3">
              Generated in-app from the approved report and accepted quotation (D-017).
            </p>
            <ul className="space-y-1 text-sm">
              {invoices.data?.map((i) => (
                <li key={i.id}>
                  <Link href={`/invoices/${i.id}`} className="font-medium text-ink underline">
                    {i.kind === "proforma" ? "Proforma" : "GST invoice"} {i.number ?? "Draft"}
                  </Link>{" "}
                  · {formatINR(i.total)} · balance {formatINR(i.balance)} · {i.status ?? ""}
                </li>
              ))}
              {invoices.data?.length === 0 && <li className="text-ink-3">No invoices yet.</li>}
            </ul>
            {invoices.data && invoices.data.length > 0 && (
              <p className="mt-2 text-sm font-semibold">Outstanding: {formatINR(outstanding)}</p>
            )}
          </Card>
        </div>

        <Card>
          <h2 className="mb-3 font-semibold">Edit job</h2>
          <JobForm action={updateJob.bind(null, id)} job={job} submitLabel="Save changes" {...options} />
        </Card>
      </div>
    </>
  );
}
