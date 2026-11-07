import type { Enums } from "../../db/types";

export type CalendarDayStatus = "free" | "busy" | "leave";

export type CalendarAssignment = {
  id: string;
  jobId: string;
  jobNo: string;
  customerName: string;
  site: string | null;
  testMethods: Enums<"test_method">[];
  workDate: string;
  endDate: string | null;
  status: Enums<"job_status">;
  technicianId: string;
  technicianName: string;
  equipment: Array<{
    id: string;
    make: string | null;
    model: string | null;
    serialNo: string | null;
    calibrationDue: string | null;
    isOverdue: boolean;
  }>;
  notes: string | null;
  acknowledgedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type CalendarLeaveDay = {
  id: string;
  personId: string;
  personName: string;
  leaveDate: string;
  reason: string | null;
};

export type CalendarDayCell = {
  date: string;
  status: CalendarDayStatus;
  assignments: CalendarAssignment[];
  leave: CalendarLeaveDay | null;
};

export type CalendarTechnicianRow = {
  personId: string;
  fullName: string;
  initials: string | null;
  mobile: string | null;
  qualifications: Array<{
    method: Enums<"test_method">;
    level: string;
    isExpired: boolean;
    validUntil: string | null;
  }>;
  days: Record<string, CalendarDayCell>;
};

export type CalendarViewData = {
  startDate: string;
  endDate: string;
  dates: string[];
  technicians: CalendarTechnicianRow[];
  totalTechnicians: number;
  totalAssignments: number;
  totalLeaves: number;
};

export type ConflictCheckResult = {
  hasConflicts: boolean;
  hasWarnings: boolean;
  equipmentConflicts: Array<{
    equipmentId: string;
    equipmentLabel: string;
    conflictingJobNo: string;
    startDate: string;
    endDate: string;
  }>;
  technicianLeaveConflicts: Array<{
    date: string;
    reason: string | null;
  }>;
  technicianAssignmentConflicts: Array<{
    assignmentId: string;
    jobNo: string;
    startDate: string;
    endDate: string;
  }>;
  calibrationWarnings: Array<{
    equipmentId: string;
    equipmentLabel: string;
    dueDate: string | null;
  }>;
  qualificationWarnings: string[];
};

export type AssignJobInput = {
  jobId: string;
  technicianId: string;
  workDate: string;
  endDate?: string | null;
  equipmentIds?: string[];
  notes?: string | null;
  force?: boolean;
};

export type MoveAssignmentInput = {
  assignmentId: string;
  newWorkDate: string;
  newEndDate?: string | null;
  newTechnicianId?: string;
  force?: boolean;
};

export type CreateLeaveDayInput = {
  personId: string;
  leaveDate: string;
  reason?: string | null;
};

// ---------------------------------------------------------------------------
// Date Utilities (Asia/Kolkata timezone aware)
// ---------------------------------------------------------------------------

export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isValidDateStr(str: string | null | undefined): str is string {
  if (!str) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

export function parseDateRange(startStr?: string | null, endStr?: string | null): { startDate: string; endDate: string } {
  const ref = todayIST();
  let start = startStr && isValidDateStr(startStr) ? startStr : ref;
  let end = endStr && isValidDateStr(endStr) ? endStr : start;

  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  return { startDate: start, endDate: end };
}

export function getDaysInRange(startDateStr: string, endDateStr: string): string[] {
  const days: string[] = [];
  const curr = new Date(startDateStr + "T00:00:00Z");
  const end = new Date(endDateStr + "T00:00:00Z");

  // Safety ceiling: at most 62 days (2 months)
  let count = 0;
  while (curr <= end && count < 62) {
    days.push(curr.toISOString().split("T")[0]!);
    curr.setUTCDate(curr.getUTCDate() + 1);
    count++;
  }
  return days;
}

export function getWeekRange(refDateStr: string = todayIST()): { startDate: string; endDate: string } {
  const ref = new Date(refDateStr + "T00:00:00Z");
  // Calculate Monday of the week (assuming Monday = start of week)
  const day = ref.getUTCDay(); // 0 is Sunday, 1 is Monday...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    startDate: monday.toISOString().split("T")[0]!,
    endDate: sunday.toISOString().split("T")[0]!,
  };
}

export function getMonthRange(year: number, month: number): { startDate: string; endDate: string } {
  // month is 1-indexed (1 = Jan, 12 = Dec)
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const startDate = `${y}-${m}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

export function isDatesOverlapping(
  startA: string,
  endA: string | null | undefined,
  startB: string,
  endB: string | null | undefined
): boolean {
  const effectiveEndA = endA && endA >= startA ? endA : startA;
  const effectiveEndB = endB && endB >= startB ? endB : startB;
  return effectiveEndA >= startB && effectiveEndB >= startA;
}

export function isDateInsideRange(date: string, rangeStart: string, rangeEnd?: string | null): boolean {
  const effectiveEnd = rangeEnd && rangeEnd >= rangeStart ? rangeEnd : rangeStart;
  return date >= rangeStart && date <= effectiveEnd;
}
