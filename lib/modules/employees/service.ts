import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "../../db/types";
import { checkCanDelete } from "../settings/service";
import {
  type EmployeeInput,
  type MonthlyAttendanceCounts,
  type QualificationInput,
  computeMonthlyAttendance,
  getMonthDates,
  todayIST,
} from "./schema";

export type EmployeeQualificationItem = {
  id: string;
  person_id: string;
  method: Enums<"test_method">;
  level: string;
  scheme: string | null;
  certifying_body: string | null;
  certificate_no: string | null;
  issued_on: string | null;
  valid_until: string | null;
  certificate_path: string | null;
  is_expired: boolean;
};

export type EmployeeDeviceItem = {
  id: string;
  device_name: string | null;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type EmployeeWithSummary = {
  id: string;
  full_name: string;
  initials: string | null;
  position: string | null;
  mobile: string | null;
  email: string | null;
  roles: Enums<"app_role">[];
  active: boolean;
  monthly_salary: number | null;
  per_job_allowance: number | null;
  qualifications: EmployeeQualificationItem[];
  active_devices_count: number;
  devices: EmployeeDeviceItem[];
  attendance: MonthlyAttendanceCounts;
};

export async function loadHolidayDates(
  supabase: SupabaseClient<Database>
): Promise<string[]> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "holidays")
    .maybeSingle();

  const val = data?.value as Record<string, unknown> | null;
  if (val && Array.isArray(val.dates)) {
    return val.dates.filter((d): d is string => typeof d === "string");
  }
  return [];
}

export async function listEmployees(
  supabase: SupabaseClient<Database>,
  options: {
    month?: string | null;
    role?: Enums<"app_role"> | "all" | null;
    status?: "active" | "inactive" | "all" | null;
    search?: string | null;
    canViewSalaries?: boolean;
  } = {}
): Promise<{
  month: string;
  holidayDates: string[];
  employees: EmployeeWithSummary[];
}> {
  const { month, startDate, endDate } = getMonthDates(options.month);
  const refToday = todayIST();
  const canViewSalaries = Boolean(options.canViewSalaries);

  let peopleQuery = supabase
    .from("people")
    .select(`
      id,
      full_name,
      initials,
      position,
      mobile,
      email,
      roles,
      active,
      monthly_salary,
      per_job_allowance
    `)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  if (options.status === "active") {
    peopleQuery = peopleQuery.eq("active", true);
  } else if (options.status === "inactive") {
    peopleQuery = peopleQuery.eq("active", false);
  }

  if (options.role && options.role !== "all") {
    peopleQuery = peopleQuery.contains("roles", [options.role]);
  }

  const [peopleRes, qualsRes, devicesRes, assignmentsRes, leavesRes, holidayDates] =
    await Promise.all([
      peopleQuery,
      supabase
        .from("qualifications")
        .select("*")
        .order("valid_until", { ascending: true, nullsFirst: false }),
      supabase
        .from("technician_devices")
        .select("id, person_id, device_name, paired_at, last_seen_at, revoked_at")
        .order("paired_at", { ascending: false }),
      supabase
        .from("assignments")
        .select("person_id, work_date, end_date")
        .lte("work_date", endDate),
      supabase
        .from("leave_days")
        .select("person_id, leave_date")
        .gte("leave_date", startDate)
        .lte("leave_date", endDate),
      loadHolidayDates(supabase),
    ]);

  if (peopleRes.error) {
    throw new Error("Failed to list employees: " + peopleRes.error.message);
  }

  const qualsByPerson = new Map<string, EmployeeQualificationItem[]>();
  for (const q of qualsRes.data ?? []) {
    const isExpired = q.valid_until ? q.valid_until < refToday : false;
    const list = qualsByPerson.get(q.person_id) ?? [];
    list.push({
      id: q.id,
      person_id: q.person_id,
      method: q.method,
      level: q.level,
      scheme: q.scheme,
      certifying_body: q.certifying_body,
      certificate_no: q.certificate_no,
      issued_on: q.issued_on,
      valid_until: q.valid_until,
      certificate_path: q.certificate_path,
      is_expired: isExpired,
    });
    qualsByPerson.set(q.person_id, list);
  }

  const devicesByPerson = new Map<string, EmployeeDeviceItem[]>();
  for (const dev of devicesRes.data ?? []) {
    const list = devicesByPerson.get(dev.person_id) ?? [];
    list.push({
      id: dev.id,
      device_name: dev.device_name,
      paired_at: dev.paired_at,
      last_seen_at: dev.last_seen_at,
      revoked_at: dev.revoked_at,
    });
    devicesByPerson.set(dev.person_id, list);
  }

  const assignsByPerson = new Map<
    string,
    Array<{ work_date: string; end_date: string | null }>
  >();
  for (const a of assignmentsRes.data ?? []) {
    const aEnd = a.end_date && a.end_date >= a.work_date ? a.end_date : a.work_date;
    if (aEnd < startDate) continue;
    const list = assignsByPerson.get(a.person_id) ?? [];
    list.push({ work_date: a.work_date, end_date: a.end_date });
    assignsByPerson.set(a.person_id, list);
  }

  const leavesByPerson = new Map<string, string[]>();
  for (const l of leavesRes.data ?? []) {
    const list = leavesByPerson.get(l.person_id) ?? [];
    list.push(l.leave_date);
    leavesByPerson.set(l.person_id, list);
  }

  const term = options.search?.trim().toLowerCase() ?? "";

  const employees: EmployeeWithSummary[] = [];
  for (const p of peopleRes.data ?? []) {
    const quals = qualsByPerson.get(p.id) ?? [];

    if (term) {
      const hay = [
        p.full_name,
        p.initials,
        p.position,
        p.mobile,
        p.email,
        ...p.roles,
        ...quals.map((q) => `${q.method} ${q.level} ${q.certificate_no ?? ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(term)) continue;
    }

    const devs = devicesByPerson.get(p.id) ?? [];
    const activeDevs = devs.filter((d) => !d.revoked_at).length;

    const attendance = computeMonthlyAttendance({
      month,
      assignments: assignsByPerson.get(p.id) ?? [],
      leaveDates: leavesByPerson.get(p.id) ?? [],
      holidayDates,
    });

    employees.push({
      id: p.id,
      full_name: p.full_name,
      initials: p.initials,
      position: p.position,
      mobile: p.mobile,
      email: p.email,
      roles: p.roles,
      active: p.active,
      monthly_salary: canViewSalaries ? p.monthly_salary : null,
      per_job_allowance: canViewSalaries ? p.per_job_allowance : null,
      qualifications: quals,
      active_devices_count: activeDevs,
      devices: devs,
      attendance,
    });
  }

  return {
    month,
    holidayDates,
    employees,
  };
}

export async function getEmployeeDetail(
  supabase: SupabaseClient<Database>,
  personId: string,
  options: { month?: string | null; canViewSalaries?: boolean } = {}
): Promise<EmployeeWithSummary | null> {
  const { month, startDate, endDate } = getMonthDates(options.month);
  const refToday = todayIST();
  const canViewSalaries = Boolean(options.canViewSalaries);

  const [personRes, qualsRes, devicesRes, assignmentsRes, leavesRes, holidayDates] =
    await Promise.all([
      supabase
        .from("people")
        .select(`
          id,
          full_name,
          initials,
          position,
          mobile,
          email,
          roles,
          active,
          monthly_salary,
          per_job_allowance
        `)
        .eq("id", personId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("qualifications")
        .select("*")
        .eq("person_id", personId)
        .order("valid_until", { ascending: true, nullsFirst: false }),
      supabase
        .from("technician_devices")
        .select("id, person_id, device_name, paired_at, last_seen_at, revoked_at")
        .eq("person_id", personId)
        .order("paired_at", { ascending: false }),
      supabase
        .from("assignments")
        .select("person_id, work_date, end_date")
        .eq("person_id", personId)
        .lte("work_date", endDate),
      supabase
        .from("leave_days")
        .select("person_id, leave_date")
        .eq("person_id", personId)
        .gte("leave_date", startDate)
        .lte("leave_date", endDate),
      loadHolidayDates(supabase),
    ]);

  if (personRes.error) {
    throw new Error("Failed to load employee: " + personRes.error.message);
  }
  const p = personRes.data;
  if (!p) return null;

  const quals: EmployeeQualificationItem[] = (qualsRes.data ?? []).map((q) => ({
    id: q.id,
    person_id: q.person_id,
    method: q.method,
    level: q.level,
    scheme: q.scheme,
    certifying_body: q.certifying_body,
    certificate_no: q.certificate_no,
    issued_on: q.issued_on,
    valid_until: q.valid_until,
    certificate_path: q.certificate_path,
    is_expired: q.valid_until ? q.valid_until < refToday : false,
  }));

  const devs: EmployeeDeviceItem[] = (devicesRes.data ?? []).map((d) => ({
    id: d.id,
    device_name: d.device_name,
    paired_at: d.paired_at,
    last_seen_at: d.last_seen_at,
    revoked_at: d.revoked_at,
  }));

  const assigns = (assignmentsRes.data ?? []).filter((a) => {
    const aEnd = a.end_date && a.end_date >= a.work_date ? a.end_date : a.work_date;
    return aEnd >= startDate;
  });

  const attendance = computeMonthlyAttendance({
    month,
    assignments: assigns,
    leaveDates: (leavesRes.data ?? []).map((l) => l.leave_date),
    holidayDates,
  });

  return {
    id: p.id,
    full_name: p.full_name,
    initials: p.initials,
    position: p.position,
    mobile: p.mobile,
    email: p.email,
    roles: p.roles,
    active: p.active,
    monthly_salary: canViewSalaries ? p.monthly_salary : null,
    per_job_allowance: canViewSalaries ? p.per_job_allowance : null,
    qualifications: quals,
    active_devices_count: devs.filter((d) => !d.revoked_at).length,
    devices: devs,
    attendance,
  };
}

export async function createEmployee(
  supabase: SupabaseClient<Database>,
  input: EmployeeInput
) {
  const payload: Database["public"]["Tables"]["people"]["Insert"] = {
    full_name: input.full_name,
    initials: input.initials,
    position: input.position,
    mobile: input.mobile,
    email: input.email,
    roles: input.roles,
    active: input.active,
    ...(input.monthly_salary !== undefined ? { monthly_salary: input.monthly_salary } : {}),
    ...(input.per_job_allowance !== undefined
      ? { per_job_allowance: input.per_job_allowance }
      : {}),
  };

  const { data, error } = await supabase
    .from("people")
    .insert(payload)
    .select("id, full_name")
    .single();

  if (error) {
    if (error.message.includes("people_initials_key")) {
      throw new Error("Another employee already uses these initials.");
    }
    throw new Error("Failed to create employee: " + error.message);
  }
  return data;
}

export async function updateEmployee(
  supabase: SupabaseClient<Database>,
  personId: string,
  input: Partial<EmployeeInput>
) {
  const patch: Database["public"]["Tables"]["people"]["Update"] = {};
  if (input.full_name !== undefined) patch.full_name = input.full_name;
  if (input.initials !== undefined) patch.initials = input.initials;
  if (input.position !== undefined) patch.position = input.position;
  if (input.mobile !== undefined) patch.mobile = input.mobile;
  if (input.email !== undefined) patch.email = input.email;
  if (input.roles !== undefined) patch.roles = input.roles;
  if (input.active !== undefined) patch.active = input.active;
  if (input.monthly_salary !== undefined) patch.monthly_salary = input.monthly_salary;
  if (input.per_job_allowance !== undefined) patch.per_job_allowance = input.per_job_allowance;

  const { data, error } = await supabase
    .from("people")
    .update(patch)
    .eq("id", personId)
    .select("id, full_name")
    .single();

  if (error) {
    if (error.message.includes("people_initials_key")) {
      throw new Error("Another employee already uses these initials.");
    }
    throw new Error("Failed to update employee: " + error.message);
  }
  return data;
}

export async function deleteEmployee(
  supabase: SupabaseClient<Database>,
  personId: string,
  callerRoles?: readonly Enums<"app_role">[],
) {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) {
    throw new Error(perm.error);
  }

  const { error } = await supabase.rpc("soft_delete_record", {
    p_table: "people",
    p_id: personId,
  });

  if (error) {
    throw new Error("Failed to delete employee: " + error.message);
  }
  return { success: true };
}

export async function createEmployeeQualification(
  supabase: SupabaseClient<Database>,
  input: QualificationInput
) {
  const { data, error } = await supabase
    .from("qualifications")
    .insert({
      person_id: input.person_id,
      method: input.method,
      level: input.level,
      scheme: input.scheme,
      certifying_body: input.certifying_body,
      certificate_no: input.certificate_no,
      issued_on: input.issued_on,
      valid_until: input.valid_until,
      certificate_path: input.certificate_path ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error("Failed to add qualification: " + error.message);
  }
  return data;
}

export async function deleteEmployeeQualification(
  supabase: SupabaseClient<Database>,
  qualificationId: string,
  callerRoles?: readonly Enums<"app_role">[],
) {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) {
    throw new Error(perm.error);
  }

  const { error } = await supabase
    .from("qualifications")
    .delete()
    .eq("id", qualificationId);

  if (error) {
    throw new Error("Failed to delete qualification: " + error.message);
  }
  return { success: true };
}
