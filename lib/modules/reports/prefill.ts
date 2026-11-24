import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@/lib/db/types";
import {
  extractCustomerRememberedDefaults,
  type ReportReadings,
  type TechnicianReadings,
} from "@/lib/reports/fields";

// Report autofill (agreed with BITA on 6 Nov): client, project, site, inspection date, the
// technicians with their qualification and certificate, and the booked equipment with its
// serial number and calibration, plus the settings this customer used last time.
// Autofill only fills blanks: anything already typed is kept.

type Supabase = SupabaseClient<Database>;

export type TechnicianLookup = {
  name: string;
  qualification: string;
  certificate_no: string;
  issued_on: string;
  valid_until: string;
};

export type EquipmentLookup = {
  label: string;
  serial: string;
  calibration: string;
};

export type ReportLookups = {
  technicians: TechnicianLookup[];
  equipment: EquipmentLookup[];
};

type QualificationRow = {
  method: string;
  level: string;
  scheme: string | null;
  certifying_body: string | null;
  certificate_no: string | null;
  issued_on: string | null;
  valid_until: string | null;
};

export function formatQualification(q: Pick<QualificationRow, "method" | "level" | "scheme" | "certifying_body">): string {
  const body = (q.certifying_body || q.scheme || "").trim();
  return [body, q.level?.trim(), `(${q.method})`].filter(Boolean).join(" ");
}

/** The qualification for this method that stays valid longest (a person may hold ISNT and ISO for UT). */
export function pickQualification(quals: readonly QualificationRow[], method: string): QualificationRow | null {
  const forMethod = quals.filter((q) => q.method === method);
  if (forMethod.length === 0) return null;
  return [...forMethod].sort((a, b) => (b.valid_until ?? "").localeCompare(a.valid_until ?? ""))[0]!;
}

export function technicianLookup(name: string, quals: readonly QualificationRow[], method: string): TechnicianLookup {
  const q = pickQualification(quals, method);
  return {
    name,
    qualification: q ? formatQualification(q) : "",
    certificate_no: q?.certificate_no ?? "",
    issued_on: q?.issued_on ?? "",
    valid_until: q?.valid_until ?? "",
  };
}

export function equipmentLookup(e: {
  make: string | null;
  model: string | null;
  serial_no: string | null;
  calibration_due: string | null;
}): EquipmentLookup {
  return {
    label: [e.make, e.model].filter(Boolean).join(" ").trim() || "Equipment",
    serial: e.serial_no ?? "",
    calibration: e.calibration_due ? `Valid upto ${e.calibration_due}` : "",
  };
}

function blank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function rowIsBlank(row: Record<string, unknown> | undefined): boolean {
  return !row || Object.values(row).every(blank);
}

/** Fills blank fields of `current` from `prefill`; never overwrites a typed value. */
export function mergePrefill(
  current: ReportReadings,
  prefill: ReportReadings,
  technicians: readonly TechnicianLookup[] = [],
): ReportReadings {
  const out: Record<string, unknown> = { ...(current as Record<string, unknown>) };
  for (const [k, v] of Object.entries(prefill)) {
    if (k === "technicians" || k === "items") continue;
    if (blank(out[k]) && !blank(v)) out[k] = v;
  }

  // Technician rows: use the job's technicians when none were entered; otherwise complete the
  // qualification details of any row whose name matches a known technician.
  const curTechs = (current.technicians ?? []) as TechnicianReadings[];
  if (curTechs.every((r) => rowIsBlank(r as Record<string, unknown>)) && prefill.technicians?.length) {
    out.technicians = prefill.technicians;
  } else if (curTechs.length) {
    out.technicians = curTechs.map((row) => {
      const match = technicians.find(
        (t) => typeof row.name === "string" && t.name.toLowerCase() === row.name.trim().toLowerCase(),
      );
      if (!match) return row;
      const filled: Record<string, unknown> = { ...row };
      for (const key of ["qualification", "certificate_no", "issued_on", "valid_until"] as const) {
        if (blank(filled[key]) && match[key]) filled[key] = match[key];
      }
      return filled;
    });
  }

  if (prefill.items?.length && ((current.items ?? []) as Record<string, unknown>[]).every(rowIsBlank)) {
    out.items = prefill.items;
  }
  return out as ReportReadings;
}

/** Technicians (with their qualification for this method) and BITA's equipment register, for the report form. */
export async function loadReportLookups(supabase: Supabase, method: Enums<"test_method">): Promise<ReportLookups> {
  const [peopleRes, equipmentRes] = await Promise.all([
    supabase
      .from("people")
      .select("full_name, qualifications(method, level, scheme, certifying_body, certificate_no, issued_on, valid_until)")
      .contains("roles", ["technician"])
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("equipment")
      .select("make, model, serial_no, calibration_due")
      .is("deleted_at", null)
      .eq("active", true)
      .order("make"),
  ]);
  return {
    technicians: (peopleRes.data ?? []).map((p) =>
      technicianLookup(p.full_name, (p.qualifications ?? []) as QualificationRow[], method),
    ),
    equipment: (equipmentRes.data ?? []).map(equipmentLookup),
  };
}

/** Everything the job already knows, in report-field form. */
export async function buildJobReportPrefill(
  supabase: Supabase,
  jobId: string,
  method: Enums<"test_method">,
): Promise<ReportReadings> {
  const [jobRes, assignRes] = await Promise.all([
    supabase.from("jobs").select("customer_id, site, scope, po_number, customers(name)").eq("id", jobId).maybeSingle(),
    supabase
      .from("assignments")
      .select(
        "work_date, people!assignments_person_id_fkey(full_name, qualifications(method, level, scheme, certifying_body, certificate_no, issued_on, valid_until)), assignment_equipment(equipment:equipment!assignment_equipment_equipment_id_fkey(make, model, serial_no, calibration_due))",
      )
      .eq("job_id", jobId)
      .order("work_date", { ascending: true }),
  ]);
  const job = jobRes.data;
  if (!job) return {};
  const assignments = assignRes.data ?? [];

  // Settings this customer used last time (standard, acceptance, probe, couplant…).
  const { data: lastReport } = await supabase
    .from("reports")
    .select("content, jobs!inner(customer_id)")
    .eq("method", method)
    .eq("jobs.customer_id", job.customer_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const remembered = lastReport ? extractCustomerRememberedDefaults(lastReport.content) : {};

  const seen = new Set<string>();
  const technicians: TechnicianReadings[] = [];
  const equipment: EquipmentLookup[] = [];
  for (const a of assignments) {
    const person = a.people as unknown as { full_name: string; qualifications: QualificationRow[] } | null;
    if (person && !seen.has(person.full_name)) {
      seen.add(person.full_name);
      technicians.push(technicianLookup(person.full_name, person.qualifications ?? [], method));
    }
    for (const ae of (a.assignment_equipment ?? []) as unknown as { equipment: Parameters<typeof equipmentLookup>[0] | null }[]) {
      if (ae.equipment) equipment.push(equipmentLookup(ae.equipment));
    }
  }

  const customerName = (job.customers as unknown as { name?: string } | null)?.name ?? "";
  const prefill: Record<string, unknown> = {
    ...remembered,
    client: customerName,
    project: job.po_number ? `PO ${job.po_number}` : (job.scope ?? "").split("\n")[0]?.trim() ?? "",
    inspection_site: job.site ?? "",
    inspection_date: assignments[0]?.work_date ?? "",
  };
  if (equipment.length) {
    prefill.equipment = equipment[0]!.label;
    prefill.equipment_serial = equipment.map((e) => e.serial).filter(Boolean).join(", ");
    prefill.equipment_calibration = equipment[0]!.calibration;
  }
  if (technicians.length) prefill.technicians = technicians;
  return prefill as ReportReadings;
}
