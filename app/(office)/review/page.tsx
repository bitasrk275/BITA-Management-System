import { redirect } from "next/navigation";
import {
  Button,
  ButtonLink,
  Card,
  EmptyRow,
  ErrorNote,
  Field,
  Input,
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
import { homeFor } from "@/lib/roles";
import { METHOD_LABEL } from "../jobs/labels";
import { prepareReport } from "./actions";

export const metadata = { title: "Reports to review – BITA" };

// Reviewer home: the report queue (R26). Signatures and seal are added only after approval (R27).
export default async function ReviewQueue({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; inspectionId?: string }>;
}) {
  const { error: actionError, inspectionId: preselectedInspectionId } = await searchParams;
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "reviewer" || r === "management" || r === "office")) {
    redirect(homeFor(person?.roles));
  }

  const [queue, drafts, recent, inspectionsRes, signatoriesRes] = await Promise.all([
    supabase
      .from("reports")
      .select("id, report_no, method, created_at, jobs(id, job_no, customers(name)), inspections(missing_fields, submitted_at)")
      .eq("status", "in_review")
      .order("created_at"),
    supabase
      .from("reports")
      .select("id, report_no, method, status, jobs(id, job_no, customers(name)), inspections(missing_fields, submitted_at)")
      .in("status", ["draft", "returned"])
      .order("created_at"),
    supabase
      .from("reports")
      .select("id, report_no, method, status, approved_at, pdf_path, jobs(id, job_no, customers(name))")
      .in("status", ["approved", "sent"])
      .order("approved_at", { ascending: false })
      .limit(8),
    supabase
      .from("inspections")
      .select("id, job_id, method, submitted_at, missing_fields, jobs(job_no, customers(name))")
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(50),
    supabase
      .from("people")
      .select("id, full_name, position")
      .eq("active", true)
      .contains("roles", ["reviewer"])
      .order("full_name"),
  ]);

  const today = todayIST();
  const waiting = queue.data ?? [];
  const oldest = waiting[0] ? daysBetween(waiting[0].created_at.slice(0, 10), today) : 0;
  const inspections = inspectionsRes.data ?? [];
  const signatories = signatoriesRes.data ?? [];

  return (
    <>
      <PageHeader
        title="Reports to review"
        subtitle={
          waiting.length
            ? `${waiting.length} waiting · oldest ${oldest === 0 ? "today" : `${oldest} days`}`
            : "Nothing waiting for review"
        }
        action={
          <ButtonLink href="/report-preview/UT" variant="secondary" size="sm">
            Paper format preview
          </ButtonLink>
        }
      />

      <ErrorNote message={actionError} />

      <section className="mb-7">
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
                      {METHOD_LABEL[r.method]} · {r.jobs?.customers?.name}
                    </span>
                  </div>
                }
                detail={
                  missing.length
                    ? `Job ${r.jobs?.job_no ?? "—"} · Missing: ${missing.join(", ")}`
                    : `Job ${r.jobs?.job_no ?? "—"} · Field data complete`
                }
                action={
                  <ButtonLink
                    href={`/review/${r.id}`}
                    variant={missing.length ? "secondary" : "primary"}
                    size="sm"
                  >
                    Review
                  </ButtonLink>
                }
              />
            );
          })}
          {waiting.length === 0 && (
            <EmptyRow>No reports waiting. New ones appear here as soon as field data is in.</EmptyRow>
          )}
        </List>
        <p className="mt-3 text-xs text-ink-3">
          Signatures and the company seal are added only after a reviewer approves (R26, R27).
        </p>
      </section>

      <div className="mb-7 grid gap-7 lg:grid-cols-2">
        <section className="min-w-0">
          <SectionTitle>Being prepared & returned</SectionTitle>
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
                  </div>
                }
                detail={`${METHOD_LABEL[r.method]} · ${r.jobs?.job_no ?? ""} · ${r.jobs?.customers?.name ?? ""}`}
                action={
                  <ButtonLink href={`/review/${r.id}`} variant="secondary" size="sm">
                    Open
                  </ButtonLink>
                }
              />
            ))}
            {drafts.data?.length === 0 && <EmptyRow>No drafts or returned reports.</EmptyRow>}
          </List>
        </section>

        <section className="min-w-0">
          <SectionTitle>Recently approved</SectionTitle>
          <List>
            {(recent.data ?? []).map((r) => (
              <ListRow
                key={r.id}
                tone="ok"
                title={
                  <div className="flex flex-wrap items-center gap-2">
                    <Mono>{r.report_no}</Mono>
                    <Status tone="ok">{r.status === "sent" ? "Sent" : "Approved"}</Status>
                  </div>
                }
                detail={`${METHOD_LABEL[r.method]} · ${r.jobs?.customers?.name ?? ""}${
                  r.approved_at ? ` · ${shortDate(r.approved_at.slice(0, 10))}` : ""
                }`}
                action={
                  <ButtonLink href={`/review/${r.id}`} variant="secondary" size="sm">
                    View
                  </ButtonLink>
                }
              />
            ))}
            {recent.data?.length === 0 && <EmptyRow>No approved reports yet.</EmptyRow>}
          </List>
        </section>
      </div>

      <section className="mb-7">
        <SectionTitle>Prepare report from submitted field data</SectionTitle>
        <Card>
          <form action={prepareReport} className="space-y-4">
            <Field
              label="Submitted field inspection *"
              hint="Only submitted inspections with complete mandatory readings can be prepared into a report (R25, X2)."
            >
              <Select
                name="inspection_id"
                required
                defaultValue={preselectedInspectionId ?? ""}
              >
                <option value="" disabled>
                  Select submitted field inspection...
                </option>
                {inspections.map((insp) => {
                  const hasMissing = (insp.missing_fields ?? []).length > 0;
                  return (
                    <option key={insp.id} value={insp.id}>
                      {insp.jobs?.job_no ?? insp.job_id.slice(0, 8)} ·{" "}
                      {insp.jobs?.customers?.name ?? "Customer"} · {METHOD_LABEL[insp.method]}
                      {hasMissing
                        ? ` (Missing ${insp.missing_fields.length} reading${insp.missing_fields.length === 1 ? "" : "s"})`
                        : " (Complete)"}
                    </option>
                  );
                })}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="BITA report number *"
                hint="Typed in per BITA's numbering (R16)."
              >
                <Input
                  name="report_no"
                  required
                  maxLength={120}
                  placeholder="e.g. FAKE/UT/26-27/0105"
                />
              </Field>
              <Field label="Report date *">
                <Input name="report_date" type="date" required defaultValue={today} />
              </Field>
              <Field label="Technical signatory">
                <Select name="signatory_id" defaultValue="">
                  <option value="">Approving reviewer (default)</option>
                  {signatories.map((sig) => (
                    <option key={sig.id} value={sig.id}>
                      {sig.full_name}
                      {sig.position ? ` (${sig.position})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={inspections.length === 0}>
                Prepare report draft
              </Button>
            </div>
          </form>
        </Card>
      </section>
    </>
  );
}
