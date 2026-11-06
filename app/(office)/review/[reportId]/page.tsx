import { notFound, redirect } from "next/navigation";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  ErrorNote,
  Field,
  Input,
  List,
  ListRow,
  Mono,
  PageHeader,
  SavedNote,
  SecondaryButton,
  SectionTitle,
  Select,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { shortDate } from "@/lib/dates";
import {
  fieldsForMethod,
  REPEATING_GROUPS,
  type ItemReadings,
  type TechnicianReadings,
} from "@/lib/reports/fields";
import { loadReportApprovalAssets } from "@/lib/reports/branding.server";
import {
  checkReportReadiness,
  extractReadings,
  fieldLabelFor,
  supportedMethod,
  validUuid,
} from "@/lib/reports/review";
import { homeFor } from "@/lib/roles";
import { ReportTemplate } from "@/templates/reports/report";
import type { ReportDocument } from "@/templates/reports/types";
import { METHOD_LABEL } from "../../jobs/labels";
import {
  approveReport,
  markReportSent,
  refreshReportFromInspection,
  returnReportToTechnician,
  sendReportForReview,
  updateReportContent,
} from "../actions";
import { generateInvoiceFromReport } from "../../invoices/actions";
import { PrintButton } from "@/app/(reports)/report-preview/[method]/print-button";
import { ReportEditor } from "./report-editor";
import "@/templates/reports/report.css";

export const metadata = { title: "Technical report review – BITA" };

function displayVal(val: unknown): string {
  if (val === null || val === undefined || String(val).trim() === "") return "—";
  return String(val);
}

export default async function ReportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ error?: string; saved?: string; edit?: string }>;
}) {
  const { reportId } = await params;
  const { error, saved, edit } = await searchParams;

  if (!validUuid(reportId)) notFound();

  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "reviewer" || r === "management" || r === "office")) {
    redirect(homeFor(person?.roles));
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) notFound();

  const [inspectionRes, jobRes, signatoriesRes, approverRes] = await Promise.all([
    report.inspection_id
      ? supabase.from("inspections").select("*").eq("id", report.inspection_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("jobs")
      .select("id, job_no, status, customers(name)")
      .eq("id", report.job_id)
      .maybeSingle(),
    supabase
      .from("people")
      .select("id, full_name, position")
      .eq("active", true)
      .contains("roles", ["reviewer"])
      .order("full_name"),
    report.approved_by
      ? supabase.from("people").select("full_name").eq("id", report.approved_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const inspection = inspectionRes.data;
  const job = jobRes.data;
  const signatories = signatoriesRes.data ?? [];
  const approverName = approverRes.data?.full_name ?? null;

  const readings = extractReadings(report.content, inspection?.readings);
  const readiness = checkReportReadiness(report.method, inspection, readings);
  const isApproved = (report.status === "approved" || report.status === "sent") && !!report.approved_at;
  const isReviewer = person.roles.includes("reviewer");
  const canBill = person.roles.some((r) => r === "management" || r === "office");

  const assets = await loadReportApprovalAssets(supabase, {
    approved: isApproved,
    approvedAt: report.approved_at,
    signatoryId: report.signatory_id,
    approvedBy: report.approved_by,
  });

  const paperDoc: ReportDocument = {
    reportNumber: report.report_no,
    reportDate: report.report_date,
    letterhead: assets.letterhead,
    readings,
    approval: assets.approval,
  };

  const statusTone =
    report.status === "approved" || report.status === "sent"
      ? "ok"
      : report.status === "returned"
        ? "bad"
        : "wait";

  const statusLabel: Record<string, string> = {
    draft: "Draft",
    in_review: "Waiting for review",
    returned: "Returned to technician",
    approved: "Approved · signed PDF ready",
    sent: "Sent to customer",
  };

  const technicians = (readings.technicians ?? []) as readonly TechnicianReadings[];
  const items = (readings.items ?? []) as readonly ItemReadings[];

  return (
    <>
      <div className="report-preview-controls space-y-6">
        <PageHeader
          title={report.report_no}
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-3">
              <Status tone={statusTone}>{statusLabel[report.status] ?? report.status}</Status>
              <span>
                {job?.job_no ?? "Job"} · {METHOD_LABEL[report.method]} ·{" "}
                {job?.customers?.name ?? String(readings.client ?? "Customer")} · Report date{" "}
                {shortDate(report.report_date)}
              </span>
            </span>
          }
          action={
            <>
              <ButtonLink href="/review" variant="secondary" size="sm">
                Review queue
              </ButtonLink>
              {job && (
                <ButtonLink href={`/jobs/${job.id}`} variant="secondary" size="sm">
                  Job {job.job_no}
                </ButtonLink>
              )}
              <ButtonLink href={`/review/${report.id}/history`} variant="secondary" size="sm">
                Correction history
              </ButtonLink>
              {supportedMethod(report.method) && (
                <ButtonLink href={`/review/${report.id}/docx`} variant="secondary" size="sm">
                  Download Word (.docx)
                </ButtonLink>
              )}
              <ButtonLink
                href={`/review/${report.id}/pdf`}
                variant={isApproved ? "primary" : "secondary"}
                size="sm"
              >
                {isApproved ? "Download signed PDF" : "Download PDF"}
              </ButtonLink>
              <PrintButton />
            </>
          }
        />

        <ErrorNote message={error} />
        {saved && <SavedNote />}

        {!readiness.ready && (
          <Card>
            <div className="space-y-2">
              <Status tone="bad">
                Mandatory field readings are incomplete — approval is blocked (R25, X2)
              </Status>
              <ul className="list-disc pl-5 text-[13px] text-ink-2">
                {readiness.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        {/* Workflow Actions */}
        <div className="grid gap-5 lg:grid-cols-2">
          {["draft", "returned"].includes(report.status) && (
            <Card className="space-y-4">
              <SectionTitle>1. Draft & review submission</SectionTitle>
              <p className="text-[13px] text-ink-2">
                Verify the readings below. When all mandatory readings are present, send this report to the technical reviewer queue.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <form action={sendReportForReview.bind(null, report.id)}>
                  <Button type="submit" disabled={!readiness.ready}>
                    Send for review
                  </Button>
                </form>
                {report.inspection_id && (
                  <form action={refreshReportFromInspection.bind(null, report.id)}>
                    <SecondaryButton type="submit">
                      Refresh from field data
                    </SecondaryButton>
                  </form>
                )}
              </div>
            </Card>
          )}

          {["in_review", "draft"].includes(report.status) && (
            <Card className="space-y-4">
              <SectionTitle>Technical reviewer approval (R26, R27)</SectionTitle>
              <p className="text-[13px] text-ink-2">
                Approving attaches the signatory&apos;s signature and company seal and generates the signed PDF in <Mono>reports/{report.job_id}/</Mono>.
              </p>
              <form action={approveReport.bind(null, report.id)} className="space-y-3">
                <Field label="Signatory on report">
                  <Select
                    name="signatory_id"
                    defaultValue={report.signatory_id ?? person.id}
                  >
                    {signatories.map((sig) => (
                      <option key={sig.id} value={sig.id}>
                        {sig.full_name}
                        {sig.position ? ` (${sig.position})` : ""}
                      </option>
                    ))}
                    {!signatories.some((s) => s.id === person.id) && (
                      <option value={person.id}>{person.full_name}</option>
                    )}
                  </Select>
                </Field>
                <div className="flex items-center justify-between gap-3">
                  {!isReviewer && (
                    <span className="text-xs text-bad">
                      Reviewer role required to approve (AGENTS.md rule 6).
                    </span>
                  )}
                  <Button type="submit" disabled={!readiness.ready || !isReviewer}>
                    Approve & generate signed PDF
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {report.status !== "sent" && (
            <Card className="space-y-4">
              <SectionTitle>Return to technician for correction</SectionTitle>
              <form action={returnReportToTechnician.bind(null, report.id)} className="space-y-3">
                <Field
                  label="Correction note for technician *"
                  hint="Sets report status to Returned and sends this note to the technician's assignment."
                >
                  <Input
                    name="note"
                    required
                    maxLength={2000}
                    placeholder="e.g. Please re-check probe angle and couplant batch on Item 1"
                  />
                </Field>
                <SecondaryButton type="submit">Return to technician</SecondaryButton>
              </form>
            </Card>
          )}

          {isApproved && (
            <Card className="space-y-4">
              <SectionTitle>Approval & delivery status</SectionTitle>
              <div className="space-y-1.5 text-[13px] text-ink-2">
                <p>
                  Approved by <strong className="text-ink">{approverName ?? "Technical Reviewer"}</strong> on{" "}
                  <strong className="text-ink">
                    {report.approved_at
                      ? new Date(report.approved_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "—"}
                  </strong>{" "}
                  IST
                </p>
                {report.pdf_path && (
                  <p>
                    Signed PDF path: <Mono>{report.pdf_path}</Mono>
                  </p>
                )}
                {report.sent_at && (
                  <p>
                    Marked sent on{" "}
                    <strong className="text-ink">
                      {new Date(report.sent_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </strong>{" "}
                    to <Mono>{report.sent_to.join(", ")}</Mono>
                  </p>
                )}
              </div>

              <form action={markReportSent.bind(null, report.id)} className="space-y-3 border-t border-line pt-3">
                <Field
                  label="Customer recipient email(s) *"
                  hint="Comma-separated emails. Records manual send and advances Job status to Report sent."
                >
                  <Input
                    name="sent_to"
                    required
                    defaultValue={report.sent_to.join(", ")}
                    placeholder="qa@customer.test, purchase@customer.test"
                  />
                </Field>
                <Button type="submit">
                  {report.status === "sent" ? "Update sent recipients" : "Mark as sent"}
                </Button>
              </form>

              {canBill && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <p className="text-[12.5px] text-ink-2">
                    Ready to bill? Generate or open the prefilled GST invoice draft from this report&apos;s quantities and the accepted quotation.
                  </p>
                  <form action={generateInvoiceFromReport.bind(null, report.id)}>
                    <Button type="submit">Generate invoice</Button>
                  </form>
                </div>
              )}
            </Card>
          )}
        </div>

        {supportedMethod(report.method) && (
          <ReportEditor
            method={report.method}
            reportDate={report.report_date}
            readings={readings}
            isApproved={isApproved}
            defaultOpen={edit === "1"}
            action={updateReportContent.bind(null, report.id)}
          />
        )}

        <SectionTitle>
          BITA paper report preview ({isApproved ? "Approved with signature & seal" : "Draft — signature & seal withheld"})
        </SectionTitle>
      </div>

      {/* Exact BITA A4 Report Paper Layout */}
      {supportedMethod(report.method) ? (
        <div className="report-preview-paper my-5">
          <ReportTemplate method={report.method} document={paperDoc} />
        </div>
      ) : (
        <Card className="my-5">
          <p className="text-sm text-ink-2">
            Paper layout template for <Mono>{report.method}</Mono> uses the structured field table below.
          </p>
        </Card>
      )}

      {/* Field Data Checklist (X2) */}
      <div className="report-preview-controls mt-8 space-y-6">
        <SectionTitle>Field readings & mandatory check (X2)</SectionTitle>

        {supportedMethod(report.method) && (
          <List>
            {fieldsForMethod(report.method).map((f) => {
              const isMissing = readiness.missing.includes(f.key);
              const val = readings[f.key as keyof typeof readings];
              return (
                <ListRow
                  key={f.key}
                  tone={isMissing ? "bad" : "ok"}
                  title={
                    <span className="flex items-center gap-2">
                      <span>{f.label}</span>
                      {f.required && <Badge>Mandatory</Badge>}
                    </span>
                  }
                  detail={<Mono>{ f.key }</Mono>}
                  action={
                    isMissing ? (
                      <Status tone="bad">Missing</Status>
                    ) : (
                      <span className="text-[13.5px] font-medium text-ink">{displayVal(val)}</span>
                    )
                  }
                />
              );
            })}
          </List>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="min-w-0">
            <SectionTitle>Testing carried out by ({technicians.length})</SectionTitle>
            <List>
              {technicians.map((t, idx) => {
                const rowMissing = REPEATING_GROUPS[0].fields.some((f) =>
                  readiness.missing.includes(`technicians.${idx}.${f.key}`)
                );
                return (
                  <ListRow
                    key={idx}
                    tone={rowMissing ? "bad" : "ok"}
                    title={`${t.name ?? "Unnamed technician"} · ${t.qualification ?? "No qualification"}`}
                    detail={`Cert: ${t.certificate_no ?? "—"} · Issued: ${t.issued_on ?? "—"} · Valid until: ${t.valid_until ?? "—"}`}
                    action={
                      rowMissing ? (
                        <Status tone="bad">Incomplete</Status>
                      ) : (
                        <Status tone="ok">Complete</Status>
                      )
                    }
                  />
                );
              })}
              {technicians.length === 0 && (
                <ListRow
                  tone="bad"
                  title="No technician qualification rows recorded"
                  detail={fieldLabelFor(report.method, "technicians")}
                  action={<Status tone="bad">Missing</Status>}
                />
              )}
            </List>
          </section>

          <section className="min-w-0">
            <SectionTitle>Inspected items & observations ({items.length})</SectionTitle>
            <List>
              {items.map((item, idx) => {
                const rowMissing = REPEATING_GROUPS[1].fields.some((f) =>
                  readiness.missing.includes(`items.${idx}.${f.key}`)
                );
                return (
                  <ListRow
                    key={idx}
                    tone={rowMissing ? "bad" : "ok"}
                    title={`Item ${idx + 1} (Qty: ${item.quantity ?? "—"}): ${item.description ?? "—"}`}
                    detail={`Observations: ${item.observations ?? "—"}`}
                    action={
                      rowMissing ? (
                        <Status tone="bad">Incomplete</Status>
                      ) : (
                        <Status tone="ok">Complete</Status>
                      )
                    }
                  />
                );
              })}
              {items.length === 0 && (
                <ListRow
                  tone="bad"
                  title="No inspected items recorded"
                  detail={fieldLabelFor(report.method, "items")}
                  action={<Status tone="bad">Missing</Status>}
                />
              )}
            </List>
          </section>
        </div>
      </div>
    </>
  );
}
