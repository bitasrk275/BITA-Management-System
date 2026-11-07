import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  List,
  ListRow,
  Mono,
  PageHeader,
  SavedNote,
  SectionTitle,
  Select,
  Status,
  Textarea,
  type Tone,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  getEquipment,
  listEquipmentMovements,
  listEquipmentTypes,
} from "@/lib/modules/equipment/service";
import { createClient } from "@/lib/supabase/server";
import {
  deleteEquipmentAction,
  recordMovementAction,
  updateEquipmentAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function EquipmentDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; moved?: string }>;
}) {
  await requireStaff();
  const supabase = await createClient();
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const [equipment, movements, types, jobsRes] = await Promise.all([
    getEquipment(supabase, id),
    listEquipmentMovements(supabase, id),
    listEquipmentTypes(supabase),
    supabase
      .from("jobs")
      .select("id, job_no, customer:customers(name), site")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (!equipment) {
    notFound();
  }

  // Generate signed URL for certificate if available
  let certSignedUrl: string | null = null;
  if (equipment.certificate_path) {
    const { data } = await supabase.storage
      .from("documents")
      .createSignedUrl(equipment.certificate_path, 600);
    certSignedUrl = data?.signedUrl ?? null;
  }

  // Generate signed URLs for delivery challans
  const movementsWithUrls = await Promise.all(
    movements.map(async (m) => {
      let challanUrl: string | null = null;
      if (m.delivery_challan_path) {
        const { data } = await supabase.storage
          .from("documents")
          .createSignedUrl(m.delivery_challan_path, 600);
        challanUrl = data?.signedUrl ?? null;
      }
      return { ...m, challanUrl };
    })
  );

  const statusTone: Tone =
    equipment.status === "at_site"
      ? "info"
      : equipment.status === "out_for_calibration"
      ? "wait"
      : "ok";

  const statusLabel =
    equipment.status === "at_site"
      ? "At site"
      : equipment.status === "out_for_calibration"
      ? "Out for calibration"
      : "In office";

  const calTone: Tone =
    equipment.calibration.status === "expired"
      ? "bad"
      : equipment.calibration.status === "due_soon"
      ? "wait"
      : "ok";

  const titleText = `${equipment.make || ""} ${equipment.model || ""}`.trim() || equipment.serial_no || "Instrument";

  const jobs = jobsRes.data ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title={titleText}
        subtitle={
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {equipment.serial_no && (
              <span className="text-xs">
                <Mono>{equipment.serial_no}</Mono>
              </span>
            )}
            {equipment.equipment_types && <Badge>{equipment.equipment_types.name}</Badge>}
            <Status tone={statusTone}>{statusLabel}</Status>
            <Status tone={calTone}>{equipment.calibration.label}</Status>
            <span>·</span>
            <span>
              Location: <strong className="text-neutral-900">{equipment.current_location || "In office"}</strong>
            </span>
            {equipment.jobs && (
              <>
                <span>·</span>
                <span>
                  Job:{" "}
                  <Link href={`/jobs/${equipment.jobs.id}`} className="font-mono text-neutral-900 underline">
                    {equipment.jobs.job_no}
                  </Link>
                </span>
              </>
            )}
          </div>
        }
        action={
          <ButtonLink href="/equipment" variant="secondary">
            ← Back to equipment
          </ButtonLink>
        }
      />

      {searchParams.saved && <SavedNote />}
      {searchParams.moved && (
        <Card className="border-green-200 bg-green-50 p-4 text-xs text-green-900">
          Equipment movement recorded and current location updated.
        </Card>
      )}

      {/* Calibration Alert Banner */}
      {equipment.calibration.status === "expired" && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-xs text-red-900 flex items-center justify-between">
          <div>
            <strong>Calibration expired!</strong> This instrument expired {Math.abs(equipment.calibration.daysRemaining || 0)} days ago ({equipment.calibration_due}). Please calibrate before deploying to customer sites.
          </div>
        </div>
      )}

      {equipment.calibration.status === "due_soon" && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 flex items-center justify-between">
          <div>
            <strong>Calibration due soon!</strong> Calibration is due in {equipment.calibration.daysRemaining} days ({equipment.calibration_due}).
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: Overview & Edit */}
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <SectionTitle>Equipment specifications</SectionTitle>

            <form action={updateEquipmentAction.bind(null, equipment.id)} className="space-y-4">
              <Field label="Equipment type">
                <Select name="equipment_type_id" defaultValue={equipment.equipment_type_id || ""}>
                  <option value="">(Select category)</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Make">
                  <Input name="make" defaultValue={equipment.make || ""} />
                </Field>
                <Field label="Model">
                  <Input name="model" defaultValue={equipment.model || ""} />
                </Field>
              </div>

              <Field label="Serial number">
                <Input name="serial_no" defaultValue={equipment.serial_no || ""} required />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Calibrated on">
                  <Input type="date" name="calibrated_on" defaultValue={equipment.calibrated_on || ""} />
                </Field>
                <Field label="Calibration due">
                  <Input type="date" name="calibration_due" defaultValue={equipment.calibration_due || ""} />
                </Field>
              </div>

              <Field label="Calibration certificate">
                {certSignedUrl ? (
                  <div className="flex items-center gap-2 mb-2">
                    <a
                      href={certSignedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-neutral-900 underline font-medium hover:text-neutral-700"
                    >
                      View certificate document ↗
                    </a>
                  </div>
                ) : (
                  <span className="text-xs text-neutral-400 block mb-1">No certificate attached</span>
                )}
                <input
                  type="file"
                  name="certificate_file"
                  accept=".pdf,image/*"
                  className="w-full text-xs text-neutral-600 file:mr-3 file:py-1 file:px-2.5 file:rounded file:border file:border-neutral-300 file:text-xs file:bg-neutral-50 file:text-neutral-800"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <Select name="status" defaultValue={equipment.status}>
                    <option value="in_office">In office</option>
                    <option value="at_site">At site</option>
                    <option value="out_for_calibration">Out for calibration</option>
                  </Select>
                </Field>
                <Field label="Location">
                  <Input name="current_location" defaultValue={equipment.current_location || "In office"} />
                </Field>
              </div>

              <Field label="Notes">
                <Textarea name="notes" defaultValue={equipment.notes || ""} rows={2} />
              </Field>

              <div className="pt-2 flex items-center justify-between">
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          </Card>

          {/* Delete Equipment Card */}
          <Card className="p-4 border-red-100 bg-red-50/30 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-red-900">Delete this equipment</div>
              <div className="text-[11px] text-red-700">Moves item to the recycle bin; can be restored later.</div>
            </div>
            <form action={deleteEquipmentAction.bind(null, equipment.id)}>
              <button
                type="submit"
                onClick={(e) => {
                  if (!confirm("Are you sure you want to move this equipment to the recycle bin?")) {
                    e.preventDefault();
                  }
                }}
                className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 font-medium"
              >
                Delete
              </button>
            </form>
          </Card>
        </div>

        {/* Right column: Movement Log & Delivery Challans */}
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <SectionTitle>Record movement & Delivery challan</SectionTitle>
            <form action={recordMovementAction.bind(null, equipment.id)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="New status">
                  <Select name="status" defaultValue="at_site">
                    <option value="at_site">Dispatch to site</option>
                    <option value="in_office">Return to office</option>
                    <option value="out_for_calibration">Send for calibration</option>
                  </Select>
                </Field>
                <Field label="Date moved">
                  <Input
                    type="date"
                    name="moved_on"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    required
                  />
                </Field>
              </div>

              <Field label="Destination location" hint="Site name or lab address">
                <Input name="to_location" placeholder="e.g. Jigani Plant Shop 2, Apex Calibration" required />
              </Field>

              <Field label="Associated Job (if dispatched to client)">
                <Select name="job_id" defaultValue={equipment.current_job_id || ""}>
                  <option value="">(No job / Routine movement)</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.job_no} — {j.customer?.name} ({j.site || "site"})
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Delivery challan no." hint="e.g. DC-2026-089">
                  <Input name="delivery_challan_no" placeholder="DC-2026-089" />
                </Field>
                <Field label="Challan document">
                  <input
                    type="file"
                    name="challan_file"
                    accept=".pdf,image/*"
                    className="w-full text-xs text-neutral-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-neutral-300 file:text-xs file:bg-neutral-50 file:text-neutral-800"
                  />
                </Field>
              </div>

              <input type="hidden" name="from_location" value={equipment.current_location || "In office"} />

              <Field label="Dispatch / transit notes">
                <Input name="notes" placeholder="Handed to technician Ravi / Courier details" />
              </Field>

              <div className="pt-2">
                <Button type="submit">Record movement</Button>
              </div>
            </form>
          </Card>

          {/* Movement history */}
          <section className="space-y-2">
            <SectionTitle>Movement history ({movementsWithUrls.length})</SectionTitle>
            <List>
              {movementsWithUrls.length === 0 ? (
                <div className="p-4 text-center text-xs text-neutral-400">
                  No movements recorded yet.
                </div>
              ) : (
                movementsWithUrls.map((m) => (
                  <ListRow
                    key={m.id}
                    title={
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-neutral-900">{m.moved_on}</span>
                        <span>·</span>
                        <span>
                          {m.from_location || "Office"} → <strong>{m.to_location}</strong>
                        </span>
                        {m.delivery_challan_no && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-mono text-neutral-800">
                            DC: {m.delivery_challan_no}
                          </span>
                        )}
                      </div>
                    }
                    detail={
                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-neutral-600 mt-0.5">
                        <Status tone={m.status === "at_site" ? "info" : m.status === "out_for_calibration" ? "wait" : "ok"}>
                          {m.status === "at_site" ? "At site" : m.status === "out_for_calibration" ? "Calibration" : "In office"}
                        </Status>
                        {m.job && (
                          <span>
                            Job:{" "}
                            <Link href={`/jobs/${m.job.id}`} className="font-mono underline text-neutral-800">
                              {m.job.job_no}
                            </Link>
                          </span>
                        )}
                        {m.moved_by_person && (
                          <span>By: {m.moved_by_person.full_name}</span>
                        )}
                        {m.notes && <span>— {m.notes}</span>}
                      </div>
                    }
                    action={
                      m.challanUrl ? (
                        <a
                          href={m.challanUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-800 hover:bg-neutral-50"
                        >
                          View Challan ↗
                        </a>
                      ) : null
                    }
                  />
                ))
              )}
            </List>
          </section>
        </div>
      </div>
    </div>
  );
}
