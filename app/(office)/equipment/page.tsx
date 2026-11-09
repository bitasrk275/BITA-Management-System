import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyRow,
  List,
  ListRow,
  Mono,
  PageHeader,
  SavedNote,
  SectionTitle,
  Stats,
  Status,
  type Tone,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { EquipmentStatus } from "@/lib/modules/equipment/schema";
import { getCalibrationAlerts, listEquipment, listEquipmentTypes } from "@/lib/modules/equipment/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function EquipmentPage(props: {
  searchParams: Promise<{
    status?: string;
    type_id?: string;
    q?: string;
    saved?: string;
    deleted?: string;
  }>;
}) {
  await requireStaff();
  const supabase = await createClient();
  const searchParams = await props.searchParams;

  const currentStatus = (searchParams.status || "all") as EquipmentStatus | "all" | "calibration_due";
  const typeId = searchParams.type_id || undefined;
  const searchTerm = searchParams.q || undefined;

  const [types, allEquipment, alerts] = await Promise.all([
    listEquipmentTypes(supabase),
    listEquipment(supabase, {
      status: currentStatus === "calibration_due" ? "all" : currentStatus,
      typeId,
      search: searchTerm,
      calibrationStatus: currentStatus === "calibration_due" ? undefined : undefined,
    }),
    getCalibrationAlerts(supabase),
  ]);

  const displayedEquipment =
    currentStatus === "calibration_due"
      ? allEquipment.filter(
          (item) => item.calibration.status === "expired" || item.calibration.status === "due_soon"
        )
      : allEquipment;

  // Counts for summary stats
  const totalCount = allEquipment.length;
  const inOfficeCount = allEquipment.filter((e) => e.status === "in_office").length;
  const atSiteCount = allEquipment.filter((e) => e.status === "at_site").length;
  const outForCalCount = allEquipment.filter((e) => e.status === "out_for_calibration").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipment register"
        subtitle="Testing instruments, calibration records, site locations, and delivery challans."
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/equipment/types" variant="secondary">
              Manage types
            </ButtonLink>
            <ButtonLink href="/equipment/new" variant="primary">
              + Add equipment
            </ButtonLink>
          </div>
        }
      />

      {searchParams.saved && <SavedNote />}
      {searchParams.deleted && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          Equipment item moved to{" "}
          <Link href="/recycle-bin" className="underline font-medium">
            Recycle bin
          </Link>
          .
        </Card>
      )}

      {/* Summary stats */}
      <Stats
        items={[
          { label: "Total items", value: totalCount },
          { label: "In office", value: inOfficeCount },
          { label: "At site", value: atSiteCount },
          { label: "Out for calibration", value: outForCalCount },
          {
            label: "Calibration alerts",
            value: (
              <span
                className={
                  alerts.totalAlerts > 0
                    ? alerts.expired.length > 0
                      ? "text-red-700 font-bold"
                      : "text-amber-700 font-bold"
                    : "text-neutral-900"
                }
              >
                {alerts.totalAlerts}
              </span>
            ),
            note:
              alerts.expired.length > 0
                ? `${alerts.expired.length} expired`
                : alerts.dueSoon.length > 0
                ? `${alerts.dueSoon.length} due soon`
                : "All calibrations valid",
          },
        ]}
      />

      {/* Filter Tabs & Search */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5 text-xs font-medium">
            <Link
              href={`/equipment?${new URLSearchParams({
                ...(typeId ? { type_id: typeId } : {}),
                ...(searchTerm ? { q: searchTerm } : {}),
                status: "all",
              }).toString()}`}
              className={`rounded px-2.5 py-1 transition ${
                currentStatus === "all" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              All ({totalCount})
            </Link>
            <Link
              href={`/equipment?${new URLSearchParams({
                ...(typeId ? { type_id: typeId } : {}),
                ...(searchTerm ? { q: searchTerm } : {}),
                status: "in_office",
              }).toString()}`}
              className={`rounded px-2.5 py-1 transition ${
                currentStatus === "in_office" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              In office ({inOfficeCount})
            </Link>
            <Link
              href={`/equipment?${new URLSearchParams({
                ...(typeId ? { type_id: typeId } : {}),
                ...(searchTerm ? { q: searchTerm } : {}),
                status: "at_site",
              }).toString()}`}
              className={`rounded px-2.5 py-1 transition ${
                currentStatus === "at_site" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              At site ({atSiteCount})
            </Link>
            <Link
              href={`/equipment?${new URLSearchParams({
                ...(typeId ? { type_id: typeId } : {}),
                ...(searchTerm ? { q: searchTerm } : {}),
                status: "out_for_calibration",
              }).toString()}`}
              className={`rounded px-2.5 py-1 transition ${
                currentStatus === "out_for_calibration"
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              Out for calibration ({outForCalCount})
            </Link>
            <Link
              href={`/equipment?${new URLSearchParams({
                ...(typeId ? { type_id: typeId } : {}),
                ...(searchTerm ? { q: searchTerm } : {}),
                status: "calibration_due",
              }).toString()}`}
              className={`rounded px-2.5 py-1 transition flex items-center gap-1 ${
                currentStatus === "calibration_due"
                  ? "bg-red-700 text-white"
                  : alerts.totalAlerts > 0
                  ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              <span>Calibration alerts</span>
              <span className="rounded-full bg-red-100 px-1.5 py-0.2 text-[10px] text-red-800 font-bold">
                {alerts.totalAlerts}
              </span>
            </Link>
          </div>

          <form method="GET" action="/equipment" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="status" value={currentStatus} />
            <select
              name="type_id"
              defaultValue={typeId || ""}
              className="rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800 bg-white"
            >
              <option value="">All categories</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              name="q"
              defaultValue={searchTerm}
              placeholder="Search serial, make, model..."
              className="rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none w-48 sm:w-64"
            />
            <button
              type="submit"
              className="rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Filter
            </button>
            {(searchTerm || typeId) && (
              <Link
                href={`/equipment?status=${currentStatus}`}
                className="text-xs text-neutral-500 hover:text-neutral-800 underline"
              >
                Clear
              </Link>
            )}
          </form>
        </div>
      </Card>

      {/* Equipment List */}
      <section className="space-y-2">
        <SectionTitle>Equipment list ({displayedEquipment.length})</SectionTitle>

        <List>
          {displayedEquipment.length === 0 ? (
            <EmptyRow>
              No equipment found matching the selected filter.
              <span className="block mt-1">
                <Link href="/equipment/new" className="text-neutral-900 underline font-medium">
                  + Add equipment item
                </Link>
              </span>
            </EmptyRow>
          ) : (
            displayedEquipment.map((item) => {
              const statusTone: Tone =
                item.status === "at_site"
                  ? "info"
                  : item.status === "out_for_calibration"
                  ? "wait"
                  : "ok";

              const statusLabel =
                item.status === "at_site"
                  ? "At site"
                  : item.status === "out_for_calibration"
                  ? "Out for calibration"
                  : "In office";

              const calTone: Tone =
                item.calibration.status === "expired"
                  ? "bad"
                  : item.calibration.status === "due_soon"
                  ? "wait"
                  : "ok";

              const titleText = `${item.make || ""} ${item.model || ""}`.trim() || item.serial_no || "Instrument";

              return (
                <ListRow
                  key={item.id}
                  tone={item.calibration.status === "expired" ? "bad" : statusTone}
                  title={
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/equipment/${item.id}`}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {titleText}
                      </Link>
                      {item.serial_no && (
                        <span className="text-xs">
                          <Mono>{item.serial_no}</Mono>
                        </span>
                      )}
                      {item.equipment_types && (
                        <Badge>{item.equipment_types.name}</Badge>
                      )}
                    </div>
                  }
                  detail={
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600 mt-0.5">
                      <Status tone={statusTone}>{statusLabel}</Status>
                      <span>
                        <span className="text-neutral-400">Location:</span>{" "}
                        <span className="font-medium text-neutral-800">
                          {item.current_location || "In office"}
                        </span>
                      </span>
                      {item.jobs && (
                        <span>
                          <span className="text-neutral-400">Job:</span>{" "}
                          <Link
                            href={`/jobs/${item.jobs.id}`}
                            className="font-mono text-neutral-800 underline hover:text-neutral-950"
                          >
                            {item.jobs.job_no}
                          </Link>
                          {item.jobs.customer && ` (${item.jobs.customer.name})`}
                        </span>
                      )}
                      <span>
                        <span className="text-neutral-400">Calibration:</span>{" "}
                        <Status tone={calTone}>{item.calibration.label}</Status>
                      </span>
                    </div>
                  }
                  action={
                    <div className="flex items-center gap-2">
                      <ButtonLink href={`/equipment/${item.id}`} variant="secondary" size="sm">
                        Details & Movement →
                      </ButtonLink>
                    </div>
                  }
                />
              );
            })
          )}
        </List>
      </section>
    </div>
  );
}
