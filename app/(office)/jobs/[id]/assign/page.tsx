import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  SecondaryButton,
  Textarea,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatIST } from "../../../enquiries/labels";
import { JOB_STATUS_LABEL, METHOD_LABEL } from "../../labels";
import { assignTechnician, removeAssignment, updateAssignment } from "./actions";
import { AssignForm } from "./assign-form";
import {
  type EquipmentRecord,
  evaluateTechnicianForJob,
  formatEquipmentLabel,
  isCalibrationOverdue,
  type QualificationRecord,
  todayIST,
} from "./warnings";

export default async function AssignTechnicianPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const { supabase } = await requireStaff();

  const { data: job } = await supabase
    .from("jobs")
    .select("*, customers(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  const [peopleRes, qualRes, equipRes, assignmentsRes] = await Promise.all([
    supabase
      .from("people")
      .select("id, full_name, mobile, position, roles, active")
      .eq("active", true)
      .contains("roles", ["technician"])
      .order("full_name"),
    supabase
      .from("qualification_status")
      .select("person_id, method, level, scheme, certificate_no, valid_until, is_expired"),
    supabase
      .from("equipment")
      .select("id, kind, make, model, serial_no, calibration_due, active")
      .eq("active", true)
      .order("kind")
      .order("serial_no"),
    supabase
      .from("assignments")
      .select(
        "id, person_id, work_date, notes, notified_at, acknowledged_at, completed_at, people(full_name, mobile), assignment_equipment(equipment_id, equipment(id, kind, make, model, serial_no, calibration_due))",
      )
      .eq("job_id", id)
      .order("work_date"),
  ]);

  const technicians = (peopleRes.data ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    mobile: p.mobile,
    position: p.position,
  }));

  const qualifications: QualificationRecord[] = (qualRes.data ?? []).flatMap((q) => {
    if (!q.person_id || !q.method || !q.level) return [];
    return [
      {
        person_id: q.person_id,
        method: q.method,
        level: q.level,
        scheme: q.scheme,
        certificate_no: q.certificate_no,
        valid_until: q.valid_until,
        is_expired: Boolean(q.is_expired),
      },
    ];
  });

  const equipmentList: EquipmentRecord[] = (equipRes.data ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    make: e.make,
    model: e.model,
    serial_no: e.serial_no,
    calibration_due: e.calibration_due,
  }));

  const refDate = todayIST();

  return (
    <>
      <PageHeader
        title={`Assign technician · ${job.job_no}`}
        action={
          <div className="flex items-center gap-2">
            <ButtonLink href={`/calendar?jobId=${job.id}`}>Open in Calendar →</ButtonLink>
            <ButtonLink href={`/jobs/${job.id}`} variant="secondary">Back to job</ButtonLink>
          </div>
        }
      />
      <ErrorNote message={error} />
      {saved && <p className="mb-4 text-sm font-medium">Saved.</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge>{JOB_STATUS_LABEL[job.status]}</Badge>
        {job.test_methods.map((m) => (
          <Badge key={m}>{METHOD_LABEL[m]}</Badge>
        ))}
        {job.customers && (
          <Link href={`/customers/${job.customers.id}`} className="text-sm underline">
            {job.customers.name}
          </Link>
        )}
        {job.site && <span className="text-sm">· {job.site}</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Current assignments</h2>
            {(assignmentsRes.data ?? []).length === 0 ? (
              <p className="text-sm">No technician assigned to this job yet.</p>
            ) : (
              <div className="space-y-4">
                {(assignmentsRes.data ?? []).map((a) => {
                  const techQuals = qualifications.filter((q) => q.person_id === a.person_id);
                  const evalResult = evaluateTechnicianForJob(job.test_methods, techQuals);
                  const assignedEqIds = a.assignment_equipment.map((ae) => ae.equipment_id);
                  const statusLabel = a.completed_at
                    ? `Completed ${formatIST(a.completed_at)}`
                    : a.acknowledged_at
                      ? `Acknowledged ${formatIST(a.acknowledged_at)}`
                      : "Not acknowledged yet";

                  return (
                    <Card key={a.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">
                            {a.work_date} · {a.people?.full_name ?? "Technician"}
                          </p>
                          <p className="text-xs">
                            {[a.people?.mobile, statusLabel].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <form action={removeAssignment.bind(null, job.id, a.id)}>
                          <SecondaryButton type="submit">Remove</SecondaryButton>
                        </form>
                      </div>

                      {evalResult.warnings.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {evalResult.warnings.map((w) => (
                            <ErrorNote key={w} message={`Warning (R20): ${w}`} />
                          ))}
                        </div>
                      )}

                      {a.assignment_equipment.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium">Assigned equipment:</p>
                          <ul className="mt-1 list-disc pl-5 text-xs">
                            {a.assignment_equipment.map((ae) => {
                              const eq = ae.equipment;
                              if (!eq) return null;
                              const overdue = isCalibrationOverdue(eq.calibration_due, refDate);
                              return (
                                <li key={ae.equipment_id}>
                                  {formatEquipmentLabel(eq)}
                                  {eq.calibration_due
                                    ? overdue
                                      ? ` · Calibration overdue (due ${eq.calibration_due})`
                                      : ` · due ${eq.calibration_due}`
                                    : ""}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer text-xs underline">
                          Edit work date, notes or equipment
                        </summary>
                        <form
                          action={updateAssignment.bind(null, job.id, a.id)}
                          className="mt-3 space-y-3"
                        >
                          <Field label="Work date *">
                            <Input type="date" name="work_date" required defaultValue={a.work_date} />
                          </Field>
                          <div>
                            <span className="text-sm font-medium">Equipment</span>
                            <div className="mt-1 space-y-1">
                              {equipmentList.map((eq) => {
                                const overdue = isCalibrationOverdue(eq.calibration_due, refDate);
                                return (
                                  <Checkbox
                                    key={eq.id}
                                    name="equipment_ids"
                                    value={eq.id}
                                    defaultChecked={assignedEqIds.includes(eq.id)}
                                    label={`${formatEquipmentLabel(eq)}${
                                      eq.calibration_due
                                        ? overdue
                                          ? ` (Calibration overdue: ${eq.calibration_due})`
                                          : ` (due ${eq.calibration_due})`
                                        : ""
                                    }`}
                                  />
                                );
                              })}
                            </div>
                          </div>
                          <Field label="Notes">
                            <Textarea name="notes" defaultValue={a.notes ?? ""} />
                          </Field>
                          <Button type="submit">Save assignment</Button>
                        </form>
                      </details>
                    </Card>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Qualification matrix for this job (R20)</h2>
              <Link href="/registers" className="text-xs underline">
                Open registers
              </Link>
            </div>
            {job.test_methods.length === 0 ? (
              <p className="text-sm">
                This job has no test methods selected yet. Edit the job to add test methods.
              </p>
            ) : technicians.length === 0 ? (
              <p className="text-sm">No active technicians in the register.</p>
            ) : (
              <div className="space-y-3 text-sm">
                {technicians.map((t) => {
                  const techQuals = qualifications.filter((q) => q.person_id === t.id);
                  const evalResult = evaluateTechnicianForJob(job.test_methods, techQuals);
                  return (
                    <div key={t.id} className="space-y-1">
                      <p className="font-medium">
                        {t.full_name}
                        {t.position ? ` (${t.position})` : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {evalResult.checks.map((c) => (
                          <Badge key={c.method}>{c.summary}</Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <Card>
          <h2 className="mb-3 font-semibold">Assign a technician</h2>
          <AssignForm
            action={assignTechnician.bind(null, job.id)}
            jobMethods={job.test_methods}
            technicians={technicians}
            qualifications={qualifications}
            equipmentList={equipmentList}
            defaultWorkDate={refDate}
            referenceDateIST={refDate}
          />
        </Card>
      </div>
    </>
  );
}
