import { checked, text } from "../../forms";

export type EquipmentStatus = "in_office" | "at_site" | "out_for_calibration";

export type CalibrationStatus = "valid" | "due_soon" | "expired" | "unknown";

export type EquipmentTypeInput = {
  name: string;
  description: string | null;
};

export type EquipmentItemInput = {
  equipment_type_id: string | null;
  kind?: "ut_flaw_detector" | "mpi_yoke" | null;
  make: string | null;
  model: string | null;
  serial_no: string | null;
  calibrated_on: string | null;
  calibration_due: string | null;
  certificate_path: string | null;
  status: EquipmentStatus;
  current_location: string | null;
  current_job_id: string | null;
  notes: string | null;
  active: boolean;
};

export type EquipmentMovementInput = {
  equipment_id: string;
  job_id: string | null;
  delivery_challan_no: string | null;
  delivery_challan_path: string | null;
  from_location: string | null;
  to_location: string;
  status: EquipmentStatus;
  moved_on: string;
  moved_by: string | null;
  notes: string | null;
};

export type CalibrationCheckResult = {
  status: CalibrationStatus;
  daysRemaining: number | null;
  isOverdue: boolean;
  isDueSoon: boolean;
  label: string;
};

function isFormData(input: unknown): input is FormData {
  return typeof FormData !== "undefined" && input instanceof FormData;
}

function readString(raw: FormData | Record<string, unknown>, key: string): string | null {
  if (isFormData(raw)) {
    return text(raw, key);
  }
  const val = raw[key];
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(raw: FormData | Record<string, unknown>, key: string, defaultValue = true): boolean {
  if (isFormData(raw)) {
    return checked(raw, key);
  }
  const val = raw[key];
  if (val === undefined || val === null) return defaultValue;
  return val === true || val === "true" || val === "on" || val === "1" || val === 1;
}

export function sanitizeSearchTerm(q?: string | null): string {
  if (!q) return "";
  return q.replace(/[,()%*]/g, " ").trim();
}

export function parseEquipmentTypeInput(raw: FormData | Record<string, unknown>): EquipmentTypeInput {
  const name = readString(raw, "name");
  if (!name) {
    throw new Error("Equipment type name is required");
  }
  const description = readString(raw, "description");
  return { name, description };
}

export function parseEquipmentItemInput(raw: FormData | Record<string, unknown>): EquipmentItemInput {
  const equipment_type_id = readString(raw, "equipment_type_id");
  const make = readString(raw, "make");
  const model = readString(raw, "model");
  const serial_no = readString(raw, "serial_no");
  const calibrated_on = readString(raw, "calibrated_on");
  const calibration_due = readString(raw, "calibration_due");
  const certificate_path = readString(raw, "certificate_path");
  const rawStatus = readString(raw, "status") || "in_office";
  const status: EquipmentStatus =
    rawStatus === "at_site" || rawStatus === "out_for_calibration" ? rawStatus : "in_office";
  const current_location = readString(raw, "current_location") || (status === "in_office" ? "In office" : null);
  const current_job_id = readString(raw, "current_job_id");
  const notes = readString(raw, "notes");
  const active = readBoolean(raw, "active", true);

  if (!serial_no && !model && !make) {
    throw new Error("Equipment must have at least a serial number, model, or make");
  }

  return {
    equipment_type_id,
    make,
    model,
    serial_no,
    calibrated_on,
    calibration_due,
    certificate_path,
    status,
    current_location,
    current_job_id,
    notes,
    active,
  };
}

export function parseEquipmentMovementInput(raw: FormData | Record<string, unknown>): EquipmentMovementInput {
  const equipment_id = readString(raw, "equipment_id");
  if (!equipment_id) {
    throw new Error("Equipment ID is required for recording movement");
  }
  const to_location = readString(raw, "to_location");
  if (!to_location) {
    throw new Error("Destination location is required");
  }
  const rawStatus = readString(raw, "status") || "in_office";
  const status: EquipmentStatus =
    rawStatus === "at_site" || rawStatus === "out_for_calibration" ? rawStatus : "in_office";

  const todayIso = new Date().toISOString().slice(0, 10);
  const moved_on = readString(raw, "moved_on") || todayIso;

  return {
    equipment_id,
    job_id: readString(raw, "job_id"),
    delivery_challan_no: readString(raw, "delivery_challan_no"),
    delivery_challan_path: readString(raw, "delivery_challan_path"),
    from_location: readString(raw, "from_location"),
    to_location,
    status,
    moved_on,
    moved_by: readString(raw, "moved_by"),
    notes: readString(raw, "notes"),
  };
}

/**
 * Calculates calibration status against a reference date (YYYY-MM-DD in IST).
 */
export function checkEquipmentCalibration(
  calibrationDue: string | null | undefined,
  refDateStr?: string,
  thresholdDays = 30
): CalibrationCheckResult {
  if (!calibrationDue) {
    return {
      status: "unknown",
      daysRemaining: null,
      isOverdue: false,
      isDueSoon: false,
      label: "No calibration date",
    };
  }

  const today = refDateStr ? new Date(refDateStr + "T00:00:00Z") : new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dueDate = new Date(calibrationDue + "T00:00:00Z");
  const dueUtc = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = Math.round((dueUtc - todayUtc) / msPerDay);

  if (daysDiff < 0) {
    const overdueDays = Math.abs(daysDiff);
    return {
      status: "expired",
      daysRemaining: daysDiff,
      isOverdue: true,
      isDueSoon: false,
      label: overdueDays === 1 ? "Expired 1 day ago" : `Expired ${overdueDays} days ago`,
    };
  }

  if (daysDiff <= thresholdDays) {
    return {
      status: "due_soon",
      daysRemaining: daysDiff,
      isOverdue: false,
      isDueSoon: true,
      label: daysDiff === 0 ? "Due today" : daysDiff === 1 ? "Due tomorrow" : `Due in ${daysDiff} days`,
    };
  }

  return {
    status: "valid",
    daysRemaining: daysDiff,
    isOverdue: false,
    isDueSoon: false,
    label: `Valid until ${calibrationDue}`,
  };
}
