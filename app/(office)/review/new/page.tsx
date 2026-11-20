import { redirect } from "next/navigation";
import { Button, Card, ErrorNote, Field, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { Constants } from "@/lib/db/types";
import { homeFor } from "@/lib/roles";
import { getMethodLabel } from "../../jobs/labels";
import { createBlankReport, prepareReport } from "../actions";

export const metadata = { title: "Create report – BITA" };

// Create a report: from a technician's submitted field data, or on its own (job optional, linkable later).
export default async function CreateReportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; inspectionId?: string; job?: string }>;
}) {
  const { error, inspectionId, job: jobParam } = await searchParams;
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "reviewer" || r === "management" || r === "office")) {
    redirect(homeFor(person?.roles));
  }

  const [inspectionsRes, reportedRes, jobsRes, signatoriesRes] = await Promise.all([
    supabase
      .from("inspections")
      .select("id, job_id, method, submitted_at, missing_fields, jobs(job_no, customers(name))")
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(100),
    supabase.from("reports").select("inspection_id").not("inspection_id", "is", null),
    supabase
      .from("jobs")
      .select("id, job_no, customers(name)")
      .is("deleted_at", null)
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("people")
      .select("id, full_name, position")
      .eq("active", true)
      .contains("roles", ["reviewer"])
      .order("full_name"),
  ]);

  const reported = new Set((reportedRes.data ?? []).map((r) => r.inspection_id));
  const inspections = (inspectionsRes.data ?? []).filter(
    (i) => !reported.has(i.id) || i.id === inspectionId,
  );
  const jobs = jobsRes.data ?? [];
  const signatories = signatoriesRes.data ?? [];
  const today = todayIST();

  const commonFields = (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="BITA report number" hint="As per BITA's numbering">
        <Input name="report_no" required maxLength={120} placeholder="e.g. UT/26-27/0105" />
      </Field>
      <Field label="Report date">
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
  );

  return (
    <>
      <PageHeader
        title="Create report"
        subtitle="Start from the technician's field data, or create a report on its own and link it to a job now or later."
      />
      <ErrorNote message={error} />

      <section className="mb-7">
        <SectionTitle>From the technician&apos;s field data ({inspections.length})</SectionTitle>
        <Card>
          {inspections.length === 0 ? (
            <p className="text-sm text-ink-3">
              No field data waiting. When a technician submits a job from the phone, it appears here.
            </p>
          ) : (
            <form action={prepareReport} className="space-y-4">
              <Field label="Submitted field data">
                <Select name="inspection_id" required defaultValue={inspectionId ?? ""}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {inspections.map((insp) => {
                    const missing = insp.missing_fields?.length ?? 0;
                    return (
                      <option key={insp.id} value={insp.id}>
                        {insp.jobs?.job_no ?? "Job"} · {insp.jobs?.customers?.name ?? "Customer"} ·{" "}
                        {getMethodLabel(insp.method)}
                        {missing ? ` (${missing} reading${missing === 1 ? "" : "s"} missing)` : ""}
                      </option>
                    );
                  })}
                </Select>
              </Field>
              {commonFields}
              <div className="flex justify-end">
                <Button type="submit">Create report</Button>
              </div>
            </form>
          )}
        </Card>
      </section>

      <section className="mb-7">
        <SectionTitle>Report on its own</SectionTitle>
        <Card>
          <form action={createBlankReport} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Test method">
                <Select name="method" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {Constants.public.Enums.test_method.map((m) => (
                    <option key={m} value={m}>
                      {getMethodLabel(m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Job (optional)" hint="Can be linked later from the report">
                <Select name="job_id" defaultValue={jobParam ?? ""}>
                  <option value="">No job yet</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.job_no} · {j.customers?.name ?? "Customer"}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {commonFields}
            <p className="text-[12.5px] text-ink-3">
              You fill in the readings on the next screen. A report must be linked to a job before it is sent for review.
            </p>
            <div className="flex justify-end">
              <Button type="submit">Create report</Button>
            </div>
          </form>
        </Card>
      </section>
    </>
  );
}
