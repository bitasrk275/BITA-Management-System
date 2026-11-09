import type { Enums } from "../../db/types";

export const APP_ROLES = ["management", "office", "reviewer", "technician"] as const satisfies readonly Enums<"app_role">[];
export const TEST_METHODS = [
  "UT",
  "MPT",
  "DPT",
  "RT",
  "VT",
  "hardness",
  "metallography",
  "RLA",
  "certification",
  "general_inspection",
] as const satisfies readonly Enums<"test_method">[];

export interface EmployeeInput {
  full_name: string;
  initials: string | null;
  position: string | null;
  mobile: string | null;
  email: string | null;
  roles: Enums<"app_role">[];
  active: boolean;
  monthly_salary?: number | null;
  per_job_allowance?: number | null;
}

export interface QualificationInput {
  person_id: string;
  method: Enums<"test_method">;
  level: string;
  scheme: string | null;
  certifying_body: string | null;
  certificate_no: string | null;
  issued_on: string | null;
  valid_until: string | null;
  certificate_path?: string | null;
}

export interface MonthlyAttendanceCounts {
  month: string;
  totalCalendarDays: number;
  sundaysAndHolidays: number;
  workingDays: number;
  workedDays: number;
  leaveDays: number;
  idleDays: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function isValidDateStr(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value.trim())) return false;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value.trim();
}

export function todayIST(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function currentMonthIST(now = new Date()): string {
  return todayIST(now).slice(0, 7);
}

export function getMonthDates(monthStr?: string | null): {
  month: string;
  startDate: string;
  endDate: string;
  dates: string[];
} {
  const m =
    monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim())
      ? monthStr.trim()
      : currentMonthIST();

  const [yStr, mStr] = m.split("-");
  const year = Number(yStr);
  const monthIdx = Number(mStr); // 1..12
  if (!Number.isFinite(year) || monthIdx < 1 || monthIdx > 12) {
    return getMonthDates(currentMonthIST());
  }

  const lastDay = new Date(Date.UTC(year, monthIdx, 0)).getUTCDate();
  const dates: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    dates.push(`${yStr}-${mStr}-${String(d).padStart(2, "0")}`);
  }

  return {
    month: m,
    startDate: dates[0]!,
    endDate: dates[dates.length - 1]!,
    dates,
  };
}

export function isSundayDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCDay() === 0;
}

/**
 * Computes worked, leave, and idle days for a person in a given month (YYYY-MM).
 * Rules (Phase 2 A5):
 * - Sundays and BITA holidays (from settings 'holidays') are non-working days.
 * - Any date covered by an assignment [work_date, coalesce(end_date, work_date)] counts as worked.
 * - Any date in leave_days (that is not worked) counts as leave.
 * - Idle = a working day (not Sunday and not holiday) with no job and no leave.
 */
export function computeMonthlyAttendance(params: {
  month: string;
  assignments: ReadonlyArray<{ work_date: string; end_date?: string | null }>;
  leaveDates: ReadonlyArray<string>;
  holidayDates?: ReadonlyArray<string>;
}): MonthlyAttendanceCounts {
  const { month, dates } = getMonthDates(params.month);
  const holidaySet = new Set(params.holidayDates ?? []);
  const leaveSet = new Set(params.leaveDates);

  // Build set of worked dates in this month
  const workedSet = new Set<string>();
  for (const d of dates) {
    for (const a of params.assignments) {
      const start = a.work_date;
      const end = a.end_date && a.end_date >= start ? a.end_date : start;
      if (d >= start && d <= end) {
        workedSet.add(d);
        break;
      }
    }
  }

  let sundaysAndHolidays = 0;
  let workingDays = 0;
  let workedDays = 0;
  let leaveDays = 0;
  let idleDays = 0;

  for (const d of dates) {
    const isOff = isSundayDate(d) || holidaySet.has(d);
    const isWorked = workedSet.has(d);
    const isLeave = leaveSet.has(d);

    if (isWorked) {
      workedDays++;
    } else if (isLeave) {
      leaveDays++;
    }

    if (isOff) {
      sundaysAndHolidays++;
    } else {
      workingDays++;
      if (!isWorked && !isLeave) {
        idleDays++;
      }
    }
  }

  return {
    month,
    totalCalendarDays: dates.length,
    sundaysAndHolidays,
    workingDays,
    workedDays,
    leaveDays,
    idleDays,
  };
}

export function parseEmployeeInput(
  raw: Record<string, unknown>,
  options: { includeCompensation?: boolean } = {}
): EmployeeInput {
  const fullName = typeof raw.full_name === "string" ? raw.full_name.trim() : "";
  if (!fullName) {
    throw new Error("Employee full name is required.");
  }

  const initialsRaw = typeof raw.initials === "string" ? raw.initials.trim().toUpperCase() : "";
  const positionRaw = typeof raw.position === "string" ? raw.position.trim() : "";
  const mobileRaw = typeof raw.mobile === "string" ? raw.mobile.trim() : "";
  const emailRaw = typeof raw.email === "string" ? raw.email.trim() : "";

  let rawRoles: string[] = [];
  if (Array.isArray(raw.roles)) {
    rawRoles = raw.roles.map(String);
  } else if (typeof raw.roles === "string" && raw.roles.trim() !== "") {
    rawRoles = raw.roles.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const roles: Enums<"app_role">[] = [];
  for (const r of rawRoles) {
    if (!(APP_ROLES as readonly string[]).includes(r)) {
      throw new Error(`Invalid role: ${r}`);
    }
    if (!roles.includes(r as Enums<"app_role">)) {
      roles.push(r as Enums<"app_role">);
    }
  }

  const active =
    raw.active === undefined
      ? true
      : raw.active === true || raw.active === "true" || raw.active === "on" || raw.active === "1";

  const out: EmployeeInput = {
    full_name: fullName,
    initials: initialsRaw || null,
    position: positionRaw || null,
    mobile: mobileRaw || null,
    email: emailRaw || null,
    roles,
    active,
  };

  if (options.includeCompensation) {
    if (raw.monthly_salary !== undefined) {
      if (raw.monthly_salary === null || String(raw.monthly_salary).trim() === "") {
        out.monthly_salary = null;
      } else {
        const sal = Number(raw.monthly_salary);
        if (!Number.isFinite(sal) || sal < 0) {
          throw new Error("Enter a valid non-negative monthly salary.");
        }
        out.monthly_salary = Math.round(sal * 100) / 100;
      }
    }

    if (raw.per_job_allowance !== undefined) {
      if (raw.per_job_allowance === null || String(raw.per_job_allowance).trim() === "") {
        out.per_job_allowance = null;
      } else {
        const allow = Number(raw.per_job_allowance);
        if (!Number.isFinite(allow) || allow < 0) {
          throw new Error("Enter a valid non-negative per-job allowance.");
        }
        out.per_job_allowance = Math.round(allow * 100) / 100;
      }
    }
  }

  return out;
}

export function parseQualificationInput(raw: Record<string, unknown>): QualificationInput {
  const personId = typeof raw.person_id === "string" ? raw.person_id.trim() : "";
  if (!isValidUuid(personId)) {
    throw new Error("A valid employee is required for the qualification.");
  }

  const methodRaw = typeof raw.method === "string" ? raw.method.trim() : "";
  if (!(TEST_METHODS as readonly string[]).includes(methodRaw)) {
    throw new Error("Choose a valid test method.");
  }

  const level = typeof raw.level === "string" ? raw.level.trim() : "";
  if (!level) {
    throw new Error("Qualification level (e.g. Level II) is required.");
  }

  const scheme = typeof raw.scheme === "string" && raw.scheme.trim() ? raw.scheme.trim() : null;
  const certifyingBody =
    typeof raw.certifying_body === "string" && raw.certifying_body.trim()
      ? raw.certifying_body.trim()
      : null;
  const certificateNo =
    typeof raw.certificate_no === "string" && raw.certificate_no.trim()
      ? raw.certificate_no.trim()
      : null;

  const issuedOnRaw = typeof raw.issued_on === "string" ? raw.issued_on.trim() : "";
  const issuedOn = issuedOnRaw ? issuedOnRaw : null;
  if (issuedOn && !isValidDateStr(issuedOn)) {
    throw new Error("Enter a valid issue date (YYYY-MM-DD).");
  }

  const validUntilRaw = typeof raw.valid_until === "string" ? raw.valid_until.trim() : "";
  const validUntil = validUntilRaw ? validUntilRaw : null;
  if (validUntil && !isValidDateStr(validUntil)) {
    throw new Error("Enter a valid expiry date (YYYY-MM-DD).");
  }

  if (issuedOn && validUntil && validUntil < issuedOn) {
    throw new Error("Expiry date cannot be earlier than the issue date.");
  }

  const certPath =
    typeof raw.certificate_path === "string" && raw.certificate_path.trim()
      ? raw.certificate_path.trim()
      : undefined;

  return {
    person_id: personId,
    method: methodRaw as Enums<"test_method">,
    level,
    scheme,
    certifying_body: certifyingBody,
    certificate_no: certificateNo,
    issued_on: issuedOn,
    valid_until: validUntil,
    ...(certPath !== undefined ? { certificate_path: certPath } : {}),
  };
}
