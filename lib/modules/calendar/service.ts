import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "../../db/types";
import { notifyTechnician } from "../../field/notify";
import { checkCanDelete } from "../settings/service";
import {
  type AssignJobInput,
  type CalendarAssignment,
  type CalendarDayCell,
  type CalendarLeaveDay,
  type CalendarTechnicianRow,
  type CalendarViewData,
  type ConflictCheckResult,
  type CreateLeaveDayInput,
  type MoveAssignmentInput,
  getDaysInRange,
  isDateInsideRange,
  isDatesOverlapping,
  parseDateRange,
  todayIST,
} from "./schema";

// ---------------------------------------------------------------------------
// Calendar View
// ---------------------------------------------------------------------------

export async function getCalendarView(
  supabase: SupabaseClient<Database>,
  options: {
    startDate?: string | null;
    endDate?: string | null;
    technicianId?: string | null;
  } = {}
): Promise<CalendarViewData> {
  const { startDate, endDate } = parseDateRange(options.startDate, options.endDate);
  const dates = getDaysInRange(startDate, endDate);
  const refDate = todayIST();

  // 1. Fetch technicians
  let techQuery = supabase
    .from("people")
    .select(`
      id,
      full_name,
      initials,
      mobile,
      roles,
      active
    `)
    .contains("roles", ["technician"])
    .eq("active", true)
    .order("full_name", { ascending: true });

  if (options.technicianId) {
    techQuery = techQuery.eq("id", options.technicianId);
  }

  const { data: techRows, error: techError } = await techQuery;
  if (techError) {
    throw new Error("Failed to fetch technicians: " + techError.message);
  }

  const technicianIds = (techRows ?? []).map((t) => t.id);

  // 2. Fetch qualifications for these technicians
  const { data: qualRows } = await supabase
    .from("qualifications")
    .select("person_id, method, level, valid_until")
    .in("person_id", technicianIds.length > 0 ? technicianIds : ["00000000-0000-0000-0000-000000000000"]);

  const qualMap = new Map<
    string,
    Array<{ method: Enums<"test_method">; level: string; isExpired: boolean; validUntil: string | null }>
  >();

  for (const q of qualRows ?? []) {
    const isExpired = q.valid_until ? q.valid_until < refDate : false;
    const list = qualMap.get(q.person_id) ?? [];
    list.push({
      method: q.method,
      level: q.level,
      isExpired,
      validUntil: q.valid_until,
    });
    qualMap.set(q.person_id, list);
  }

  // 3. Fetch leave days in range
  const { data: leaveRows, error: leaveError } = await supabase
    .from("leave_days")
    .select(`
      id,
      person_id,
      leave_date,
      reason,
      people:person_id(full_name)
    `)
    .in("person_id", technicianIds.length > 0 ? technicianIds : ["00000000-0000-0000-0000-000000000000"])
    .gte("leave_date", startDate)
    .lte("leave_date", endDate);

  if (leaveError) {
    throw new Error("Failed to fetch leave days: " + leaveError.message);
  }

  const leaveMap = new Map<string, CalendarLeaveDay>();
  for (const l of leaveRows ?? []) {
    const key = `${l.person_id}_${l.leave_date}`;
    leaveMap.set(key, {
      id: l.id,
      personId: l.person_id,
      personName: (l.people as unknown as { full_name: string } | null)?.full_name ?? "Technician",
      leaveDate: l.leave_date,
      reason: l.reason,
    });
  }

  // 4. Fetch assignments in range (overlapping start/end)
  // An assignment overlaps [startDate, endDate] if:
  // work_date <= endDate AND coalesce(end_date, work_date) >= startDate
  const { data: assignRows, error: assignError } = await supabase
    .from("assignments")
    .select(`
      id,
      job_id,
      person_id,
      work_date,
      end_date,
      notes,
      acknowledged_at,
      started_at,
      completed_at,
      job:jobs!assignments_job_id_fkey(
        id,
        job_no,
        test_methods,
        site,
        status,
        customer:customers!jobs_customer_id_fkey(name)
      ),
      person:people!assignments_person_id_fkey(full_name),
      assignment_equipment(
        equipment:equipment!assignment_equipment_equipment_id_fkey(
          id,
          make,
          model,
          serial_no,
          calibration_due
        )
      )
    `)
    .lte("work_date", endDate);

  if (assignError) {
    throw new Error("Failed to fetch assignments: " + assignError.message);
  }

  // Filter overlapping and technician in JS
  type RawAssignRow = {
    id: string;
    job_id: string;
    person_id: string;
    work_date: string;
    end_date: string | null;
    notes: string | null;
    acknowledged_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    job: {
      id: string;
      job_no: string;
      test_methods: Enums<"test_method">[];
      site: string | null;
      status: Enums<"job_status">;
      customer: { name: string } | null;
    } | null;
    person: { full_name: string } | null;
    assignment_equipment: Array<{
      equipment: {
        id: string;
        make: string | null;
        model: string | null;
        serial_no: string | null;
        calibration_due: string | null;
      } | null;
    }>;
  };

  const relevantAssignments: CalendarAssignment[] = [];

  for (const raw of (assignRows as unknown as RawAssignRow[]) ?? []) {
    if (!raw.job) continue;
    const aEnd = raw.end_date && raw.end_date >= raw.work_date ? raw.end_date : raw.work_date;
    if (aEnd < startDate) continue;

    const equipList = (raw.assignment_equipment ?? []).flatMap((ae) => {
      if (!ae.equipment) return [];
      const eq = ae.equipment;
      const isOverdue = eq.calibration_due ? eq.calibration_due < refDate : false;
      return [
        {
          id: eq.id,
          make: eq.make,
          model: eq.model,
          serialNo: eq.serial_no,
          calibrationDue: eq.calibration_due,
          isOverdue,
        },
      ];
    });

    relevantAssignments.push({
      id: raw.id,
      jobId: raw.job.id,
      jobNo: raw.job.job_no,
      customerName: raw.job.customer?.name ?? "Customer",
      site: raw.job.site,
      testMethods: raw.job.test_methods ?? [],
      workDate: raw.work_date,
      endDate: raw.end_date,
      status: raw.job.status,
      technicianId: raw.person_id,
      technicianName: raw.person?.full_name ?? "Technician",
      equipment: equipList,
      notes: raw.notes,
      acknowledgedAt: raw.acknowledged_at,
      startedAt: raw.started_at,
      completedAt: raw.completed_at,
    });
  }

  // 5. Build Technician Rows
  const technicianRows: CalendarTechnicianRow[] = [];

  for (const tech of techRows ?? []) {
    const days: Record<string, CalendarDayCell> = {};

    for (const d of dates) {
      const leaveKey = `${tech.id}_${d}`;
      const leave = leaveMap.get(leaveKey) ?? null;

      // Find any assignment active on this day
      const dayAssignments = relevantAssignments.filter(
        (a) => a.technicianId === tech.id && isDateInsideRange(d, a.workDate, a.endDate)
      );

      let status: "free" | "busy" | "leave" = "free";
      if (leave) {
        status = "leave";
      } else if (dayAssignments.length > 0) {
        status = "busy";
      }

      days[d] = {
        date: d,
        status,
        assignments: dayAssignments,
        leave,
      };
    }

    technicianRows.push({
      personId: tech.id,
      fullName: tech.full_name,
      initials: tech.initials,
      mobile: tech.mobile,
      qualifications: qualMap.get(tech.id) ?? [],
      days,
    });
  }

  return {
    startDate,
    endDate,
    dates,
    technicians: technicianRows,
    totalTechnicians: technicianRows.length,
    totalAssignments: relevantAssignments.length,
    totalLeaves: leaveRows?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Conflict Detection
// ---------------------------------------------------------------------------

export async function checkCalendarConflicts(
  supabase: SupabaseClient<Database>,
  params: {
    technicianId: string;
    workDate: string;
    endDate?: string | null;
    equipmentIds?: string[];
    excludeAssignmentId?: string | null;
    jobMethods?: Enums<"test_method">[];
  }
): Promise<ConflictCheckResult> {
  const { technicianId, workDate, equipmentIds = [], excludeAssignmentId, jobMethods = [] } = params;
  const effectiveEnd = params.endDate && params.endDate >= workDate ? params.endDate : workDate;

  const equipmentConflicts: ConflictCheckResult["equipmentConflicts"] = [];
  const technicianLeaveConflicts: ConflictCheckResult["technicianLeaveConflicts"] = [];
  const technicianAssignmentConflicts: ConflictCheckResult["technicianAssignmentConflicts"] = [];
  const calibrationWarnings: ConflictCheckResult["calibrationWarnings"] = [];
  const qualificationWarnings: string[] = [];

  // 1. Check Technician Leave Days
  const { data: leaves } = await supabase
    .from("leave_days")
    .select("leave_date, reason")
    .eq("person_id", technicianId)
    .gte("leave_date", workDate)
    .lte("leave_date", effectiveEnd);

  for (const l of leaves ?? []) {
    technicianLeaveConflicts.push({
      date: l.leave_date,
      reason: l.reason,
    });
  }

  // 2. Check Technician Overlapping Assignments
  const { data: techAssignments } = await supabase
    .from("assignments")
    .select("id, work_date, end_date, job:jobs!assignments_job_id_fkey(job_no, status)")
    .eq("person_id", technicianId)
    .lte("work_date", effectiveEnd);

  for (const a of techAssignments ?? []) {
    if (excludeAssignmentId && a.id === excludeAssignmentId) continue;
    const aEnd = a.end_date && a.end_date >= a.work_date ? a.end_date : a.work_date;
    if (aEnd >= workDate) {
      const job = a.job as unknown as { job_no: string; status: string } | null;
      if (job && job.status !== "closed") {
        technicianAssignmentConflicts.push({
          assignmentId: a.id,
          jobNo: job.job_no,
          startDate: a.work_date,
          endDate: aEnd,
        });
      }
    }
  }

  // 3. Check Equipment Conflicts (One equipment cannot be on two jobs on the same day)
  if (equipmentIds.length > 0) {
    const { data: eqBookings } = await supabase
      .from("assignment_equipment")
      .select(`
        equipment_id,
        assignment:assignments!assignment_equipment_assignment_id_fkey(
          id,
          work_date,
          end_date,
          job:jobs!assignments_job_id_fkey(id, job_no, status)
        ),
        equipment:equipment!assignment_equipment_equipment_id_fkey(
          id,
          make,
          model,
          serial_no,
          calibration_due
        )
      `)
      .in("equipment_id", equipmentIds);

    type EqBookingRow = {
      equipment_id: string;
      assignment: {
        id: string;
        work_date: string;
        end_date: string | null;
        job: { id: string; job_no: string; status: string } | null;
      } | null;
      equipment: {
        id: string;
        make: string | null;
        model: string | null;
        serial_no: string | null;
        calibration_due: string | null;
      } | null;
    };

    const checkedEqIds = new Set<string>();

    for (const row of (eqBookings as unknown as EqBookingRow[]) ?? []) {
      if (!row.assignment || !row.equipment) continue;
      if (excludeAssignmentId && row.assignment.id === excludeAssignmentId) continue;
      if (row.assignment.job?.status === "closed") continue;

      const aStart = row.assignment.work_date;
      const aEnd = row.assignment.end_date && row.assignment.end_date >= aStart ? row.assignment.end_date : aStart;

      if (isDatesOverlapping(workDate, effectiveEnd, aStart, aEnd)) {
        const label = [row.equipment.make, row.equipment.model, row.equipment.serial_no ? `#${row.equipment.serial_no}` : null]
          .filter(Boolean)
          .join(" ") || "Instrument";

        equipmentConflicts.push({
          equipmentId: row.equipment_id,
          equipmentLabel: label,
          conflictingJobNo: row.assignment.job?.job_no ?? "Another job",
          startDate: aStart,
          endDate: aEnd,
        });
      }

      // Calibration check (record once per equipment)
      if (!checkedEqIds.has(row.equipment_id)) {
        checkedEqIds.add(row.equipment_id);
        if (row.equipment.calibration_due && row.equipment.calibration_due < effectiveEnd) {
          const label = [row.equipment.make, row.equipment.model, row.equipment.serial_no ? `#${row.equipment.serial_no}` : null]
            .filter(Boolean)
            .join(" ") || "Instrument";

          calibrationWarnings.push({
            equipmentId: row.equipment_id,
            equipmentLabel: label,
            dueDate: row.equipment.calibration_due,
          });
        }
      }
    }

    // Also check calibration for equipment that didn't have other bookings
    const uncheckedEq = equipmentIds.filter((id) => !checkedEqIds.has(id));
    if (uncheckedEq.length > 0) {
      const { data: rawEqList } = await supabase
        .from("equipment")
        .select("id, make, model, serial_no, calibration_due")
        .in("id", uncheckedEq);

      for (const eq of rawEqList ?? []) {
        if (eq.calibration_due && eq.calibration_due < effectiveEnd) {
          const label = [eq.make, eq.model, eq.serial_no ? `#${eq.serial_no}` : null].filter(Boolean).join(" ") || "Instrument";
          calibrationWarnings.push({
            equipmentId: eq.id,
            equipmentLabel: label,
            dueDate: eq.calibration_due,
          });
        }
      }
    }
  }

  // 4. Check Technician Qualifications
  if (jobMethods.length > 0) {
    const { data: quals } = await supabase
      .from("qualifications")
      .select("method, level, valid_until")
      .eq("person_id", technicianId)
      .in("method", jobMethods);

    const validMethods = new Set<string>();
    for (const q of quals ?? []) {
      const isValid = !q.valid_until || q.valid_until >= workDate;
      if (isValid) {
        validMethods.add(q.method);
      }
    }

    for (const m of jobMethods) {
      if (!validMethods.has(m)) {
        qualificationWarnings.push(`Technician has no valid certificate for ${m} on ${workDate}.`);
      }
    }
  }

  const hasConflicts = equipmentConflicts.length > 0 || technicianLeaveConflicts.length > 0;
  const hasWarnings = technicianAssignmentConflicts.length > 0 || calibrationWarnings.length > 0 || qualificationWarnings.length > 0;

  return {
    hasConflicts,
    hasWarnings,
    equipmentConflicts,
    technicianLeaveConflicts,
    technicianAssignmentConflicts,
    calibrationWarnings,
    qualificationWarnings,
  };
}

// ---------------------------------------------------------------------------
// Assignment Actions
// ---------------------------------------------------------------------------

export async function assignCalendarJob(
  supabase: SupabaseClient<Database>,
  input: AssignJobInput
) {
  const { jobId, technicianId, workDate, notes } = input;
  const endDate = input.endDate && input.endDate >= workDate ? input.endDate : null;
  const equipmentIds = input.equipmentIds ?? [];

  // 1. Conflict checks
  const conflicts = await checkCalendarConflicts(supabase, {
    technicianId,
    workDate,
    endDate,
    equipmentIds,
  });

  if (!input.force && conflicts.hasConflicts) {
    if (conflicts.technicianLeaveConflicts.length > 0) {
      const l = conflicts.technicianLeaveConflicts[0]!;
      throw new Error(`Technician is on leave on ${l.date}${l.reason ? ` (${l.reason})` : ""}.`);
    }
    if (conflicts.equipmentConflicts.length > 0) {
      const eq = conflicts.equipmentConflicts[0]!;
      throw new Error(`Equipment ${eq.equipmentLabel} is already booked on ${eq.conflictingJobNo} (${eq.startDate} to ${eq.endDate}).`);
    }
  }

  // 2. Insert assignment
  const { data: assignment, error: assignError } = await supabase
    .from("assignments")
    .insert({
      job_id: jobId,
      person_id: technicianId,
      work_date: workDate,
      end_date: endDate,
      notes: notes || null,
      notified_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (assignError || !assignment) {
    throw new Error("Failed to create assignment: " + (assignError?.message ?? "Unknown error"));
  }

  // 3. Link equipment
  if (equipmentIds.length > 0) {
    const rows = equipmentIds.map((equipment_id) => ({
      assignment_id: assignment.id,
      equipment_id,
    }));

    const { error: eqError } = await supabase.from("assignment_equipment").insert(rows);
    if (eqError) {
      throw new Error("Assignment created, but failed to attach equipment: " + eqError.message);
    }

    // Update equipment current job and location
    await supabase
      .from("equipment")
      .update({
        current_job_id: jobId,
        status: "at_site",
      })
      .in("id", equipmentIds);
  }

  // 4. Update job status to scheduled if awaiting approval or enquiry received
  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, job_no, customer:customers!jobs_customer_id_fkey(name)")
    .eq("id", jobId)
    .maybeSingle();

  if (job && (job.status === "enquiry_received" || job.status === "awaiting_approval")) {
    await supabase.from("jobs").update({ status: "scheduled" }).eq("id", jobId);
  }

  // 5. Push notification to technician
  const custName = (job?.customer as unknown as { name?: string } | null)?.name ?? "Customer";
  const dateRangeStr = endDate ? `${workDate} to ${endDate}` : workDate;
  await notifyTechnician(supabase, technicianId, {
    title: "New Job Assigned",
    body: `New job: ${job?.job_no ?? "BITA"} · ${custName} · ${dateRangeStr}`,
    data: { jobId, assignmentId: assignment.id },
  }).catch(() => null);

  return assignment;
}

export async function moveCalendarAssignment(
  supabase: SupabaseClient<Database>,
  input: MoveAssignmentInput
) {
  const { assignmentId, newWorkDate } = input;
  const newEndDate = input.newEndDate && input.newEndDate >= newWorkDate ? input.newEndDate : null;

  // 1. Fetch current assignment and its equipment
  const { data: current, error: fetchErr } = await supabase
    .from("assignments")
    .select(`
      id,
      job_id,
      person_id,
      work_date,
      end_date,
      job:jobs!assignments_job_id_fkey(job_no, customer:customers!jobs_customer_id_fkey(name)),
      assignment_equipment(equipment_id)
    `)
    .eq("id", assignmentId)
    .single();

  if (fetchErr || !current) {
    throw new Error("Assignment not found: " + (fetchErr?.message ?? "Unknown"));
  }

  const targetTechId = input.newTechnicianId || current.person_id;
  const equipmentIds = (current.assignment_equipment ?? []).map((ae) => ae.equipment_id);

  // 2. Check conflicts
  const conflicts = await checkCalendarConflicts(supabase, {
    technicianId: targetTechId,
    workDate: newWorkDate,
    endDate: newEndDate,
    equipmentIds,
    excludeAssignmentId: assignmentId,
  });

  if (!input.force && conflicts.hasConflicts) {
    if (conflicts.technicianLeaveConflicts.length > 0) {
      const l = conflicts.technicianLeaveConflicts[0]!;
      throw new Error(`Technician is on leave on ${l.date}${l.reason ? ` (${l.reason})` : ""}.`);
    }
    if (conflicts.equipmentConflicts.length > 0) {
      const eq = conflicts.equipmentConflicts[0]!;
      throw new Error(`Equipment ${eq.equipmentLabel} is already booked on ${eq.conflictingJobNo} (${eq.startDate} to ${eq.endDate}).`);
    }
  }

  // 3. Update assignment
  const { data: updated, error: updateErr } = await supabase
    .from("assignments")
    .update({
      work_date: newWorkDate,
      end_date: newEndDate,
      person_id: targetTechId,
      notified_at: new Date().toISOString(),
    })
    .eq("id", assignmentId)
    .select()
    .single();

  if (updateErr) {
    throw new Error("Failed to update assignment: " + updateErr.message);
  }

  // 4. Send notification
  const custName = (current.job as unknown as { customer: { name?: string } | null } | null)?.customer?.name ?? "Customer";
  const dateRangeStr = newEndDate ? `${newWorkDate} to ${newEndDate}` : newWorkDate;
  await notifyTechnician(supabase, targetTechId, {
    title: "Job Schedule Updated",
    body: `Schedule updated: ${custName} · ${dateRangeStr}`,
    data: { jobId: current.job_id, assignmentId },
  }).catch(() => null);

  return updated;
}

export async function deleteCalendarAssignment(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  callerRoles?: readonly Enums<"app_role">[],
) {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) {
    throw new Error(perm.error);
  }

  // Release equipment current_job_id if linked
  const { data: aeList } = await supabase
    .from("assignment_equipment")
    .select("equipment_id")
    .eq("assignment_id", assignmentId);

  const eqIds = (aeList ?? []).map((ae) => ae.equipment_id);
  if (eqIds.length > 0) {
    await supabase
      .from("equipment")
      .update({ current_job_id: null, status: "in_office" })
      .in("id", eqIds);
  }

  // Delete assignment (assignment_equipment cascade deletes)
  const { error } = await supabase.from("assignments").delete().eq("id", assignmentId);
  if (error) {
    throw new Error("Failed to delete assignment: " + error.message);
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Leave Days
// ---------------------------------------------------------------------------

export async function createLeaveDay(
  supabase: SupabaseClient<Database>,
  input: CreateLeaveDayInput,
  createdByUserId?: string | null
) {
  const { data, error } = await supabase
    .from("leave_days")
    .insert({
      person_id: input.personId,
      leave_date: input.leaveDate,
      reason: input.reason || null,
      created_by: createdByUserId || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`Leave is already recorded for this technician on ${input.leaveDate}.`);
    }
    throw new Error("Failed to record leave day: " + error.message);
  }
  return data;
}

export async function deleteLeaveDay(
  supabase: SupabaseClient<Database>,
  leaveDayId: string,
  callerRoles?: readonly Enums<"app_role">[],
) {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) {
    throw new Error(perm.error);
  }

  const { error } = await supabase.from("leave_days").delete().eq("id", leaveDayId);
  if (error) {
    throw new Error("Failed to delete leave day: " + error.message);
  }
  return { success: true };
}

export async function listLeaveDays(
  supabase: SupabaseClient<Database>,
  options: {
    startDate?: string | null;
    endDate?: string | null;
    personId?: string | null;
  } = {}
) {
  let query = supabase
    .from("leave_days")
    .select(`
      id,
      person_id,
      leave_date,
      reason,
      created_at,
      people:person_id(id, full_name, mobile)
    `)
    .order("leave_date", { ascending: false });

  if (options.startDate) {
    query = query.gte("leave_date", options.startDate);
  }
  if (options.endDate) {
    query = query.lte("leave_date", options.endDate);
  }
  if (options.personId) {
    query = query.eq("person_id", options.personId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error("Failed to list leave days: " + error.message);
  }
  return data ?? [];
}
