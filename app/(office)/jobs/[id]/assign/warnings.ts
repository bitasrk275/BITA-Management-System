import type { Enums } from "@/lib/db/types";
import { METHOD_LABEL } from "../../labels";

export const EQUIPMENT_KIND_LABEL: Record<Enums<"equipment_kind">, string> = {
  ut_flaw_detector: "UT flaw detector",
  mpi_yoke: "MPI yoke",
};

export type QualificationRecord = {
  person_id: string;
  method: Enums<"test_method">;
  level: string;
  scheme: string | null;
  certificate_no: string | null;
  valid_until: string | null;
  is_expired: boolean;
};

export type MethodQualificationCheck =
  | {
      method: Enums<"test_method">;
      status: "valid";
      record: QualificationRecord;
      summary: string;
    }
  | {
      method: Enums<"test_method">;
      status: "expired";
      record: QualificationRecord;
      summary: string;
      warning: string;
    }
  | {
      method: Enums<"test_method">;
      status: "not_qualified";
      record: null;
      summary: string;
      warning: string;
    };

export type EquipmentRecord = {
  id: string;
  kind: Enums<"equipment_kind"> | null;
  make: string | null;
  model: string | null;
  serial_no: string | null;
  calibration_due: string | null;
};

// Current date in Asia/Kolkata as YYYY-MM-DD.
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// R20: Check a technician's qualification for one test method from qualification_status rows.
// If a technician has multiple records for the same method, prefer a non-expired one with the latest valid_until.
export function checkMethodQualification(
  method: Enums<"test_method">,
  records: readonly QualificationRecord[],
): MethodQualificationCheck {
  const matching = records.filter((r) => r.method === method);
  const label = METHOD_LABEL[method];

  if (matching.length === 0) {
    return {
      method,
      status: "not_qualified",
      record: null,
      summary: `${label}: Not qualified`,
      warning: `Not qualified for ${label} (no certificate on file).`,
    };
  }

  const valid = matching
    .filter((r) => !r.is_expired)
    .sort((a, b) => (b.valid_until ?? "9999-12-31").localeCompare(a.valid_until ?? "9999-12-31"));

  if (valid.length > 0) {
    const best = valid[0];
    const details = [best.level, best.scheme, best.certificate_no].filter(Boolean).join(" · ");
    const expiry = best.valid_until ? `valid until ${best.valid_until}` : "no expiry date";
    return {
      method,
      status: "valid",
      record: best,
      summary: `${label}: ${details} (${expiry})`,
    };
  }

  const latestExpired = [...matching].sort((a, b) =>
    (b.valid_until ?? "").localeCompare(a.valid_until ?? ""),
  )[0];
  const details = [latestExpired.level, latestExpired.scheme, latestExpired.certificate_no]
    .filter(Boolean)
    .join(" · ");
  const expiredOn = latestExpired.valid_until ?? "past date";

  return {
    method,
    status: "expired",
    record: latestExpired,
    summary: `${label}: Expired (${details}, expired ${expiredOn})`,
    warning: `Expired qualification for ${label}: ${details} expired on ${expiredOn}.`,
  };
}

// R20: Evaluate a technician across all test methods required by a job.
export function evaluateTechnicianForJob(
  jobMethods: readonly Enums<"test_method">[],
  personRecords: readonly QualificationRecord[],
): {
  checks: MethodQualificationCheck[];
  warnings: string[];
  allValid: boolean;
} {
  const checks = jobMethods.map((m) => checkMethodQualification(m, personRecords));
  const warnings = checks.flatMap((c) => (c.status === "valid" ? [] : [c.warning]));
  return {
    checks,
    warnings,
    allValid: warnings.length === 0,
  };
}

export function isCalibrationOverdue(calibrationDue: string | null, referenceDateIST: string): boolean {
  if (!calibrationDue) return false;
  return calibrationDue < referenceDateIST;
}

export function formatEquipmentLabel(eq: EquipmentRecord): string {
  const kind = eq.kind ? EQUIPMENT_KIND_LABEL[eq.kind] : "Equipment";
  const model = [eq.make, eq.model].filter(Boolean).join(" ");
  const serial = eq.serial_no ? `#${eq.serial_no}` : null;
  return [kind, model || null, serial].filter(Boolean).join(" · ");
}
