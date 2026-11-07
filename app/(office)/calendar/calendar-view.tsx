"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  Mono,
  SecondaryButton,
  Select,
  Status,
  Textarea,
} from "@/components/ui";
import type { Enums } from "@/lib/db/types";
import type { CalendarAssignment, CalendarViewData } from "@/lib/modules/calendar/schema";
import {
  assignJobFromCalendarAction,
  deleteAssignmentAction,
  deleteLeaveAction,
  moveAssignmentAction,
  recordLeaveAction,
} from "./actions";

type JobOption = {
  id: string;
  job_no: string;
  customerName: string;
  site: string | null;
  status: string;
  testMethods: Enums<"test_method">[];
};

type EquipmentOption = {
  id: string;
  make: string | null;
  model: string | null;
  serial_no: string | null;
  typeName: string | null;
  calibration_due: string | null;
  status: string;
};

export function CalendarInteractiveView({
  data,
  currentDate,
  viewMode,
  jobs,
  equipmentList,
  selectedJobId,
  selectedTechId,
}: {
  data: CalendarViewData;
  currentDate: string;
  viewMode: "week" | "month";
  jobs: JobOption[];
  equipmentList: EquipmentOption[];
  selectedJobId?: string | null;
  selectedTechId?: string | null;
}) {
  const router = useRouter();

  // Modal states
  const [assignOpen, setAssignOpen] = useState(Boolean(selectedJobId));
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [activeAssignment, setActiveAssignment] = useState<CalendarAssignment | null>(null);

  // Form states for Assign
  const [targetJobId, setTargetJobId] = useState(selectedJobId || (jobs[0]?.id ?? ""));
  const [targetTechId, setTargetTechId] = useState(selectedTechId || (data.technicians[0]?.personId ?? ""));
  const [assignWorkDate, setAssignWorkDate] = useState(currentDate);
  const [assignEndDate, setAssignEndDate] = useState("");
  const [assignEquipIds, setAssignEquipIds] = useState<string[]>([]);
  const [assignNotes, setAssignNotes] = useState("");

  // Navigation handlers
  const handleNav = (deltaDays: number) => {
    const d = new Date(currentDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + deltaDays);
    const nextDate = d.toISOString().split("T")[0];
    router.push(`/calendar?date=${nextDate}&view=${viewMode}`);
  };

  const handleDateSelect = (newDate: string) => {
    router.push(`/calendar?date=${newDate}&view=${viewMode}`);
  };

  const handleViewChange = (mode: "week" | "month") => {
    router.push(`/calendar?date=${currentDate}&view=${mode}`);
  };

  const openAssignModal = (techId?: string, date?: string) => {
    if (techId) setTargetTechId(techId);
    if (date) {
      setAssignWorkDate(date);
      setAssignEndDate("");
    }
    setAssignOpen(true);
  };

  const toggleEquipment = (id: string) => {
    setAssignEquipIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-4">
      {/* Calendar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-3.5">
        <div className="flex items-center gap-2">
          <SecondaryButton type="button" onClick={() => handleNav(viewMode === "week" ? -7 : -30)}>
            ← Previous
          </SecondaryButton>
          <SecondaryButton type="button" onClick={() => handleDateSelect(new Date().toISOString().split("T")[0]!)}>
            Today
          </SecondaryButton>
          <SecondaryButton type="button" onClick={() => handleNav(viewMode === "week" ? 7 : 30)}>
            Next →
          </SecondaryButton>
          <span className="ml-2 font-semibold text-ink text-sm">
            {data.startDate} to {data.endDate}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Toggle */}
          <div className="inline-flex rounded-lg border border-line p-0.5 bg-side">
            <button
              type="button"
              onClick={() => handleViewChange("week")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === "week" ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:text-ink"
              }`}
            >
              Week (7 days)
            </button>
            <button
              type="button"
              onClick={() => handleViewChange("month")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === "month" ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:text-ink"
              }`}
            >
              Month (30 days)
            </button>
          </div>

          <SecondaryButton type="button" onClick={() => setLeaveOpen(true)}>
            + Record Leave
          </SecondaryButton>

          <Button type="button" onClick={() => openAssignModal()}>
            + Schedule Job
          </Button>
        </div>
      </div>

      {/* Main Grid View */}
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[700px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-[#fcfcfc]">
              <th className="sticky left-0 z-10 w-48 border-r border-line bg-[#fcfcfc] p-3 font-semibold text-ink">
                Technician
              </th>
              {data.dates.map((d) => {
                const isCurrent = d === currentDate;
                const dayName = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
                  new Date(d + "T00:00:00Z")
                );
                return (
                  <th
                    key={d}
                    className={`min-w-[120px] p-2 text-center font-medium border-r border-line last:border-r-0 ${
                      isCurrent ? "bg-info/10 text-info font-bold" : "text-ink-2"
                    }`}
                  >
                    <div>{dayName}</div>
                    <div className="text-[11px] opacity-80">{d.slice(5)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.technicians.length === 0 ? (
              <tr>
                <td colSpan={data.dates.length + 1} className="p-8 text-center text-ink-3">
                  No active technicians found. Add technicians in Employees/Registers.
                </td>
              </tr>
            ) : (
              data.technicians.map((tech) => (
                <tr key={tech.personId} className="border-b border-line last:border-b-0 hover:bg-[#fafafa]/50">
                  {/* Technician Header Column */}
                  <td className="sticky left-0 z-10 border-r border-line bg-white p-3 shadow-[1px_0_0_0_#ebebeb]">
                    <div className="font-medium text-ink">{tech.fullName}</div>
                    {tech.mobile && <div className="text-[11px] text-ink-3 font-mono">{tech.mobile}</div>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {tech.qualifications.map((q) => (
                        <span
                          key={q.method}
                          className={`rounded px-1 text-[10px] ${
                            q.isExpired ? "bg-bad/10 text-bad font-semibold" : "bg-side text-ink-2"
                          }`}
                        >
                          {q.method} ({q.level})
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Day Cells */}
                  {data.dates.map((d) => {
                    const cell = tech.days[d];
                    const isToday = d === currentDate;

                    if (!cell) {
                      return <td key={d} className="border-r border-line p-2 text-center text-ink-3" />;
                    }

                    if (cell.status === "leave" && cell.leave) {
                      return (
                        <td
                          key={d}
                          className="border-r border-line p-2 align-top bg-amber-50/50"
                        >
                          <div className="rounded border border-amber-200 bg-amber-100/70 p-1.5 text-[11px] text-amber-900">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">On Leave</span>
                              <form action={deleteLeaveAction}>
                                <input type="hidden" name="leave_id" value={cell.leave.id} />
                                <button
                                  type="submit"
                                  title="Cancel Leave"
                                  className="text-amber-700 hover:text-amber-950 ml-1 text-xs"
                                >
                                  ×
                                </button>
                              </form>
                            </div>
                            {cell.leave.reason && (
                              <div className="mt-0.5 text-[10px] text-amber-800 line-clamp-2">
                                {cell.leave.reason}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    }

                    if (cell.status === "busy" && cell.assignments.length > 0) {
                      return (
                        <td
                          key={d}
                          className={`border-r border-line p-1.5 align-top ${
                            isToday ? "bg-info/5" : ""
                          }`}
                        >
                          <div className="space-y-1.5">
                            {cell.assignments.map((a) => (
                              <div
                                key={a.id}
                                onClick={() => setActiveAssignment(a)}
                                className="cursor-pointer rounded border border-line bg-white p-1.5 shadow-sm transition hover:border-ink hover:shadow"
                              >
                                <div className="flex items-center justify-between font-mono font-medium text-ink">
                                  <span>{a.jobNo}</span>
                                  <Status tone={a.status === "scheduled" ? "wait" : "ok"}>
                                    {""}
                                  </Status>
                                </div>
                                <div className="text-[11px] font-medium text-neutral-800 truncate">
                                  {a.customerName}
                                </div>
                                {a.site && (
                                  <div className="text-[10px] text-ink-3 truncate">
                                    {a.site}
                                  </div>
                                )}
                                {a.equipment.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {a.equipment.map((eq) => (
                                      <span
                                        key={eq.id}
                                        className={`rounded px-1 text-[9px] ${
                                          eq.isOverdue
                                            ? "bg-bad/10 text-bad font-bold"
                                            : "bg-neutral-100 text-neutral-700"
                                        }`}
                                      >
                                        {eq.model || eq.make || "Eq"}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      );
                    }

                    // Free day
                    return (
                      <td
                        key={d}
                        className={`group border-r border-line p-2 text-center align-middle hover:bg-[#fafafa] ${
                          isToday ? "bg-info/5" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => openAssignModal(tech.personId, d)}
                          className="opacity-0 group-hover:opacity-100 transition rounded border border-dashed border-line px-2 py-1 text-[11px] text-ink-3 hover:border-ink hover:text-ink"
                        >
                          + Assign
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Assignment Detail / Move Modal */}
      {activeAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-w-lg w-full space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-ink">
                  Job Assignment · <Mono>{activeAssignment.jobNo}</Mono>
                </h3>
                <p className="text-xs text-ink-2 mt-0.5">
                  {activeAssignment.customerName} {activeAssignment.site ? `· ${activeAssignment.site}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveAssignment(null)}
                className="text-ink-3 hover:text-ink text-base"
              >
                ✕
              </button>
            </div>

            <div className="rounded-lg bg-side p-3 text-xs space-y-1">
              <div>
                <span className="text-ink-3">Technician:</span>{" "}
                <strong>{activeAssignment.technicianName}</strong>
              </div>
              <div>
                <span className="text-ink-3">Scheduled Dates:</span>{" "}
                <strong>
                  {activeAssignment.workDate}
                  {activeAssignment.endDate && activeAssignment.endDate !== activeAssignment.workDate
                    ? ` to ${activeAssignment.endDate}`
                    : ""}
                </strong>
              </div>
              <div>
                <span className="text-ink-3">Status:</span>{" "}
                <Badge>{activeAssignment.status}</Badge>
              </div>
              {activeAssignment.equipment.length > 0 && (
                <div>
                  <span className="text-ink-3">Booked Equipment:</span>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {activeAssignment.equipment.map((eq) => (
                      <li key={eq.id}>
                        {eq.make} {eq.model} {eq.serialNo ? `(#${eq.serialNo})` : ""}
                        {eq.isOverdue && (
                          <span className="ml-1 text-bad font-semibold">(Calibration overdue!)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Move Form */}
            <form action={moveAssignmentAction} className="space-y-3 border-t border-line pt-3">
              <input type="hidden" name="assignment_id" value={activeAssignment.id} />
              <div className="font-semibold text-xs text-ink">Move or Reassign Job</div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Start Date">
                  <Input
                    type="date"
                    name="new_work_date"
                    defaultValue={activeAssignment.workDate}
                    required
                  />
                </Field>
                <Field label="End Date (optional)">
                  <Input
                    type="date"
                    name="new_end_date"
                    defaultValue={activeAssignment.endDate || ""}
                  />
                </Field>
              </div>

              <Field label="Reassign Technician">
                <Select name="new_technician_id" defaultValue={activeAssignment.technicianId}>
                  {data.technicians.map((t) => (
                    <option key={t.personId} value={t.personId}>
                      {t.fullName}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="flex items-center justify-between pt-2">
                <form action={deleteAssignmentAction} className="inline">
                  <input type="hidden" name="assignment_id" value={activeAssignment.id} />
                  <button
                    type="submit"
                    className="text-xs text-bad hover:underline font-medium"
                    onClick={(e) => {
                      if (!confirm("Are you sure you want to unassign this job?")) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Unassign Job
                  </button>
                </form>

                <div className="flex items-center gap-2">
                  <ButtonLink href={`/jobs/${activeAssignment.jobId}`} variant="secondary" size="sm">
                    Open Job →
                  </ButtonLink>
                  <Button type="submit">Save Changes</Button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Assign Modal */}
      {assignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-w-lg w-full space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-ink">Schedule Job on Calendar</h3>
                <p className="text-xs text-ink-2 mt-0.5">
                  Pick date, technician, and equipment. Conflicts are automatically detected.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignOpen(false)}
                className="text-ink-3 hover:text-ink text-base"
              >
                ✕
              </button>
            </div>

            <form action={assignJobFromCalendarAction} className="space-y-3">
              <Field label="Select Job">
                <Select
                  name="job_id"
                  value={targetJobId}
                  onChange={(e) => setTargetJobId(e.target.value)}
                  required
                >
                  <option value="">-- Choose a Job --</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.job_no} · {j.customerName} ({j.testMethods.join(", ")})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Assign Technician">
                <Select
                  name="technician_id"
                  value={targetTechId}
                  onChange={(e) => setTargetTechId(e.target.value)}
                  required
                >
                  {data.technicians.map((t) => (
                    <option key={t.personId} value={t.personId}>
                      {t.fullName} ({t.qualifications.map((q) => q.method).join(", ") || "General"})
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Start Date">
                  <Input
                    type="date"
                    name="work_date"
                    value={assignWorkDate}
                    onChange={(e) => setAssignWorkDate(e.target.value)}
                    required
                  />
                </Field>
                <Field label="End Date (multi-day)">
                  <Input
                    type="date"
                    name="end_date"
                    value={assignEndDate}
                    onChange={(e) => setAssignEndDate(e.target.value)}
                  />
                </Field>
              </div>

              {/* Equipment Multi-select */}
              <div>
                <label className="text-[13px] font-medium text-ink-2 block mb-1">
                  Book Equipment (One item cannot be on two jobs same day)
                </label>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-line p-2 space-y-1 bg-side/30">
                  {equipmentList.length === 0 ? (
                    <div className="text-xs text-ink-3 p-2">No active equipment found.</div>
                  ) : (
                    equipmentList.map((eq) => {
                      const isChecked = assignEquipIds.includes(eq.id);
                      return (
                        <label
                          key={eq.id}
                          className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-white cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              name="equipment_ids"
                              value={eq.id}
                              checked={isChecked}
                              onChange={() => toggleEquipment(eq.id)}
                              className="h-3.5 w-3.5 accent-ink"
                            />
                            <span className="font-medium text-ink">
                              {eq.make} {eq.model} {eq.serial_no ? `(#${eq.serial_no})` : ""}
                            </span>
                            {eq.typeName && <Badge>{eq.typeName}</Badge>}
                          </div>
                          <span className="text-[11px] text-ink-3">
                            {eq.status === "in_office" ? "In office" : eq.status}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <Field label="Notes (optional)">
                <Textarea
                  name="notes"
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  placeholder="Special instructions or site contacts..."
                />
              </Field>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <SecondaryButton type="button" onClick={() => setAssignOpen(false)}>
                  Cancel
                </SecondaryButton>
                <Button type="submit">Schedule & Notify</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Record Leave Modal */}
      {leaveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-w-md w-full space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-ink">Record Technician Leave</h3>
                <p className="text-xs text-ink-2 mt-0.5">
                  Mark days when technician is unavailable for scheduling.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLeaveOpen(false)}
                className="text-ink-3 hover:text-ink text-base"
              >
                ✕
              </button>
            </div>

            <form action={recordLeaveAction} className="space-y-3">
              <Field label="Technician">
                <Select name="person_id" required defaultValue={data.technicians[0]?.personId}>
                  {data.technicians.map((t) => (
                    <option key={t.personId} value={t.personId}>
                      {t.fullName}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Leave Date">
                <Input type="date" name="leave_date" defaultValue={currentDate} required />
              </Field>

              <Field label="Reason (optional)">
                <Input
                  type="text"
                  name="reason"
                  placeholder="Sick leave, Personal, Off..."
                />
              </Field>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <SecondaryButton type="button" onClick={() => setLeaveOpen(false)}>
                  Cancel
                </SecondaryButton>
                <Button type="submit">Save Leave</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
