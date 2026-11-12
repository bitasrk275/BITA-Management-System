import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "../../db/types";
import { checkCanDelete } from "../settings/service";
import {
  type EquipmentItemInput,
  type EquipmentMovementInput,
  type EquipmentStatus,
  type EquipmentTypeInput,
  type CalibrationStatus,
  type CalibrationCheckResult,
  checkEquipmentCalibration,
  sanitizeSearchTerm,
} from "./schema";

export type EquipmentWithDetails = Database["public"]["Tables"]["equipment"]["Row"] & {
  equipment_types: { id: string; name: string } | null;
  jobs: { id: string; job_no: string; customer: { id: string; name: string } | null } | null;
  calibration: CalibrationCheckResult;
};

export type EquipmentMovementRecord = Database["public"]["Tables"]["equipment_movements"]["Row"] & {
  moved_by_person: { id: string; full_name: string } | null;
  job: { id: string; job_no: string } | null;
};

type EquipmentQueryRow = Database["public"]["Tables"]["equipment"]["Row"] & {
  equipment_types: { id: string; name: string } | null;
  jobs: { id: string; job_no: string; customer: { id: string; name: string } | null } | null;
};

// ---------------------------------------------------------------------------
// Equipment Types
// ---------------------------------------------------------------------------

export async function listEquipmentTypes(
  supabase: SupabaseClient<Database>,
  options: { includeDeleted?: boolean } = {}
) {
  let query = supabase
    .from("equipment_types")
    .select("id, name, description, created_at, deleted_at")
    .order("name", { ascending: true });

  if (!options.includeDeleted) {
    query = query.is("deleted_at", null);
  }

  const { data, error } = await query;
  if (error) throw new Error("Failed to list equipment types: " + error.message);
  return data ?? [];
}

export async function getEquipmentType(
  supabase: SupabaseClient<Database>,
  id: string
) {
  const { data, error } = await supabase
    .from("equipment_types")
    .select("id, name, description, created_at, deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error("Failed to get equipment type: " + error.message);
  return data;
}

export async function createEquipmentType(
  supabase: SupabaseClient<Database>,
  input: EquipmentTypeInput
) {
  const { data, error } = await supabase
    .from("equipment_types")
    .insert({
      name: input.name,
      description: input.description,
    })
    .select("id, name, description, created_at")
    .single();

  if (error) throw new Error("Failed to create equipment type: " + error.message);
  return data;
}

export async function updateEquipmentType(
  supabase: SupabaseClient<Database>,
  id: string,
  input: Partial<EquipmentTypeInput>
) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;

  const { data, error } = await supabase
    .from("equipment_types")
    .update(patch)
    .eq("id", id)
    .select("id, name, description, created_at")
    .single();

  if (error) throw new Error("Failed to update equipment type: " + error.message);
  return data;
}

export async function deleteEquipmentType(
  supabase: SupabaseClient<Database>,
  id: string,
  callerRoles?: readonly Enums<"app_role">[],
) {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) throw new Error(perm.error);

  // Uses soft_delete_record RPC
  const { error } = await supabase.rpc("soft_delete_record", {
    p_table: "equipment_types",
    p_id: id,
  });

  if (error) throw new Error("Failed to delete equipment type: " + error.message);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Equipment Items
// ---------------------------------------------------------------------------

export async function listEquipment(
  supabase: SupabaseClient<Database>,
  options: {
    status?: EquipmentStatus | "all";
    typeId?: string;
    search?: string;
    calibrationStatus?: CalibrationStatus;
    includeDeleted?: boolean;
    refDateStr?: string;
    thresholdDays?: number;
    limit?: number;
    offset?: number;
  } = {}
) {
  let query = supabase
    .from("equipment")
    .select(`
      id,
      equipment_type_id,
      kind,
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
      created_at,
      deleted_at,
      deleted_by,
      equipment_types(id, name),
      jobs:current_job_id(id, job_no, customer:customers(id, name))
    `)
    .order("created_at", { ascending: false });

  if (!options.includeDeleted) {
    query = query.is("deleted_at", null);
  }

  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }

  if (options.typeId) {
    query = query.eq("equipment_type_id", options.typeId);
  }

  const sanitized = sanitizeSearchTerm(options.search);
  if (sanitized) {
    query = query.or(
      `serial_no.ilike.%${sanitized}%,make.ilike.%${sanitized}%,model.ilike.%${sanitized}%`
    );
  }

  if (options.limit) {
    const from = options.offset || 0;
    query = query.range(from, from + options.limit - 1);
  }

  const { data, error } = await query;
  if (error) throw new Error("Failed to list equipment: " + error.message);

  const threshold = options.thresholdDays ?? 30;

  const queryRows = (data as unknown as EquipmentQueryRow[]) ?? [];
  const items: EquipmentWithDetails[] = queryRows.map((row) => {
    const calibration = checkEquipmentCalibration(row.calibration_due, options.refDateStr, threshold);
    return {
      ...row,
      equipment_types: row.equipment_types ?? null,
      jobs: row.jobs ?? null,
      calibration,
    };
  });

  if (options.calibrationStatus) {
    return items.filter((item) => item.calibration.status === options.calibrationStatus);
  }

  return items;
}

export async function getEquipment(
  supabase: SupabaseClient<Database>,
  id: string,
  options: { refDateStr?: string; thresholdDays?: number } = {}
): Promise<EquipmentWithDetails | null> {
  const { data, error } = await supabase
    .from("equipment")
    .select(`
      id,
      equipment_type_id,
      kind,
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
      created_at,
      deleted_at,
      deleted_by,
      equipment_types(id, name),
      jobs:current_job_id(id, job_no, customer:customers(id, name))
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error("Failed to get equipment: " + error.message);
  if (!data) return null;

  const threshold = options.thresholdDays ?? 30;
  const row = data as unknown as EquipmentQueryRow;
  const calibration = checkEquipmentCalibration(row.calibration_due, options.refDateStr, threshold);

  return {
    ...row,
    equipment_types: row.equipment_types ?? null,
    jobs: row.jobs ?? null,
    calibration,
  };
}

export async function createEquipment(
  supabase: SupabaseClient<Database>,
  input: EquipmentItemInput
) {
  const insertPayload = {
    equipment_type_id: input.equipment_type_id || null,
    kind: input.kind || null,
    make: input.make || null,
    model: input.model || null,
    serial_no: input.serial_no || null,
    calibrated_on: input.calibrated_on || null,
    calibration_due: input.calibration_due || null,
    certificate_path: input.certificate_path || null,
    status: input.status,
    current_location: input.current_location || "In office",
    current_job_id: input.current_job_id || null,
    notes: input.notes || null,
    active: input.active,
  };

  const { data, error } = await supabase
    .from("equipment")
    .insert(insertPayload)
    .select("id, make, model, serial_no, status, current_location, calibration_due")
    .single();

  if (error) throw new Error("Failed to create equipment: " + error.message);

  // If status is not in_office or has a destination location, create initial movement entry
  if (input.current_location && input.current_location !== "In office") {
    await supabase.from("equipment_movements").insert({
      equipment_id: data.id,
      job_id: input.current_job_id || null,
      from_location: "In office",
      to_location: input.current_location,
      status: input.status,
      notes: "Initial deployment",
    });
  }

  return data;
}

export async function updateEquipment(
  supabase: SupabaseClient<Database>,
  id: string,
  input: Partial<EquipmentItemInput>
) {
  const patch: Record<string, unknown> = {};
  if (input.equipment_type_id !== undefined) patch.equipment_type_id = input.equipment_type_id;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.make !== undefined) patch.make = input.make;
  if (input.model !== undefined) patch.model = input.model;
  if (input.serial_no !== undefined) patch.serial_no = input.serial_no;
  if (input.calibrated_on !== undefined) patch.calibrated_on = input.calibrated_on;
  if (input.calibration_due !== undefined) patch.calibration_due = input.calibration_due;
  if (input.certificate_path !== undefined) patch.certificate_path = input.certificate_path;
  if (input.status !== undefined) patch.status = input.status;
  if (input.current_location !== undefined) patch.current_location = input.current_location;
  if (input.current_job_id !== undefined) patch.current_job_id = input.current_job_id;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.active !== undefined) patch.active = input.active;

  const { data, error } = await supabase
    .from("equipment")
    .update(patch)
    .eq("id", id)
    .select("id, make, model, serial_no, status, current_location, calibration_due")
    .single();

  if (error) throw new Error("Failed to update equipment: " + error.message);
  return data;
}

export async function deleteEquipment(
  supabase: SupabaseClient<Database>,
  id: string,
  callerRoles?: readonly Enums<"app_role">[],
) {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) throw new Error(perm.error);

  const { error } = await supabase.rpc("soft_delete_record", {
    p_table: "equipment",
    p_id: id,
  });

  if (error) throw new Error("Failed to delete equipment: " + error.message);
  return { success: true };
}

export async function restoreEquipment(
  supabase: SupabaseClient<Database>,
  id: string
) {
  const { error } = await supabase.rpc("restore_record", {
    p_table: "equipment",
    p_id: id,
  });

  if (error) throw new Error("Failed to restore equipment: " + error.message);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Movements & Challans
// ---------------------------------------------------------------------------

export async function recordEquipmentMovement(
  supabase: SupabaseClient<Database>,
  input: EquipmentMovementInput
) {
  // 1. Insert movement record
  const { data: movement, error: moveError } = await supabase
    .from("equipment_movements")
    .insert({
      equipment_id: input.equipment_id,
      job_id: input.job_id || null,
      delivery_challan_no: input.delivery_challan_no || null,
      delivery_challan_path: input.delivery_challan_path || null,
      from_location: input.from_location || null,
      to_location: input.to_location,
      status: input.status,
      moved_on: input.moved_on,
      moved_by: input.moved_by || null,
      notes: input.notes || null,
    })
    .select()
    .single();

  if (moveError) {
    throw new Error("Failed to record equipment movement: " + moveError.message);
  }

  // 2. Update equipment current status, location, and job_id
  const { error: updateError } = await supabase
    .from("equipment")
    .update({
      status: input.status,
      current_location: input.to_location,
      current_job_id: input.job_id || null,
    })
    .eq("id", input.equipment_id);

  if (updateError) {
    throw new Error("Movement recorded but failed to update equipment status: " + updateError.message);
  }

  return movement;
}

export async function listEquipmentMovements(
  supabase: SupabaseClient<Database>,
  equipmentId: string
): Promise<EquipmentMovementRecord[]> {
  const { data, error } = await supabase
    .from("equipment_movements")
    .select(`
      id,
      equipment_id,
      job_id,
      delivery_challan_no,
      delivery_challan_path,
      from_location,
      to_location,
      status,
      moved_on,
      moved_by,
      notes,
      created_at,
      moved_by_person:people!equipment_movements_moved_by_fkey(id, full_name),
      job:jobs(id, job_no)
    `)
    .eq("equipment_id", equipmentId)
    .order("moved_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error("Failed to list equipment movements: " + error.message);
  return (data as unknown as EquipmentMovementRecord[]) ?? [];
}

// ---------------------------------------------------------------------------
// Calibration Alerts
// ---------------------------------------------------------------------------

export async function getCalibrationAlerts(
  supabase: SupabaseClient<Database>,
  options: { refDateStr?: string; thresholdDays?: number } = {}
) {
  let threshold = options.thresholdDays;

  if (threshold === undefined) {
    // Read from settings reminder_timings or default to 30
    const { data: settingRow } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "reminder_timings")
      .maybeSingle();

    const timings = settingRow?.value as Record<string, unknown> | null;
    if (typeof timings?.calibration_days_before_due === "number") {
      threshold = timings.calibration_days_before_due;
    } else {
      threshold = 30;
    }
  }

  const { data, error } = await supabase
    .from("equipment")
    .select(`
      id,
      equipment_type_id,
      kind,
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
      created_at,
      equipment_types(id, name),
      jobs:current_job_id(id, job_no)
    `)
    .is("deleted_at", null)
    .eq("active", true)
    .not("calibration_due", "is", null);

  if (error) throw new Error("Failed to fetch equipment for calibration check: " + error.message);

  const expired: EquipmentWithDetails[] = [];
  const dueSoon: EquipmentWithDetails[] = [];

  type AlertQueryRow = Database["public"]["Tables"]["equipment"]["Row"] & {
    equipment_types: { id: string; name: string } | null;
    jobs: { id: string; job_no: string } | null;
  };

  for (const row of (data as unknown as AlertQueryRow[]) ?? []) {
    const calibration = checkEquipmentCalibration(row.calibration_due, options.refDateStr, threshold);
    const item: EquipmentWithDetails = {
      ...row,
      equipment_types: row.equipment_types ?? null,
      jobs: row.jobs ? { ...row.jobs, customer: null } : null,
      calibration,
    };

    if (calibration.status === "expired") {
      expired.push(item);
    } else if (calibration.status === "due_soon") {
      dueSoon.push(item);
    }
  }

  // Sort expired by overdue severity (most overdue first)
  expired.sort((a, b) => (a.calibration.daysRemaining ?? 0) - (b.calibration.daysRemaining ?? 0));
  // Sort dueSoon by closest to expiry
  dueSoon.sort((a, b) => (a.calibration.daysRemaining ?? 0) - (b.calibration.daysRemaining ?? 0));

  return {
    expired,
    dueSoon,
    totalAlerts: expired.length + dueSoon.length,
    thresholdDays: threshold,
  };
}
