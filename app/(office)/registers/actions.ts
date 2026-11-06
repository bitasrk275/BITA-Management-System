"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendlyError } from "@/lib/forms";
import { createPairingCode } from "../../../lib/field/pairing";
import { equipmentFields, isId, isRegister, personFields, qualificationFields, type Register } from "./fields";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function errorMessage(error: { message: string }) {
  if (error.message.includes("people_initials_key")) return "Another person already uses these initials.";
  if (error.message.includes("equipment_serial_no_key")) return "Another equipment record already uses this serial number.";
  return friendlyError(error.message);
}

export async function saveRegister(register: Register, recordId: string, fd: FormData) {
  if (!isRegister(register) || (recordId !== "new" && !isId(recordId))) redirect("/registers");
  const path = `/registers/${register}/${recordId}`;
  const { supabase, person } = await requireStaff();
  if (!person?.roles.includes("management")) fail("/registers", "Only management can change registers.");
  const isNew = recordId === "new";
  const id = isNew ? randomUUID() : recordId;

  let payload;
  try {
    payload = register === "people" ? personFields(fd)
      : register === "qualifications" ? qualificationFields(fd) : equipmentFields(fd);
  } catch (error) {
    fail(path, error instanceof Error ? error.message : "Check the form fields.");
  }

  if (register === "people") {
    const fields = payload as ReturnType<typeof personFields>;
    // Avoid locking the manager out of their own account while editing the staff register.
    if (id === person.id && (!fields.active || !fields.roles?.includes("management"))) {
      fail(path, "You cannot deactivate yourself or remove your own management role.");
    }
    const query = isNew ? supabase.from("people").insert({ ...fields, id })
      : supabase.from("people").update(fields).eq("id", id);
    const { data, error } = await query.select("id").single();
    if (error || !data) fail(path, error ? errorMessage(error) : "Person not found or permission denied.");
  } else if (register === "qualifications") {
    const fields = payload as ReturnType<typeof qualificationFields>;
    if (!isNew) {
      const { data: existing, error } = await supabase.from("qualifications").select("person_id").eq("id", id).maybeSingle();
      if (error || !existing) fail(path, error ? errorMessage(error) : "Qualification not found.");
      if (fields.person_id !== existing.person_id) fail(path, "A qualification stays with its original person. Add a new qualification for another person.");
    }
    const query = isNew ? supabase.from("qualifications").insert({ ...fields, id })
      : supabase.from("qualifications").update(fields).eq("id", id);
    const { data, error } = await query.select("id").single();
    if (error || !data) fail(path, error ? errorMessage(error) : "Qualification not found or permission denied.");
  } else {
    const fields = payload as ReturnType<typeof equipmentFields>;
    const query = isNew ? supabase.from("equipment").insert({ ...fields, id })
      : supabase.from("equipment").update(fields).eq("id", id);
    const { data, error } = await query.select("id").single();
    if (error || !data) fail(path, error ? errorMessage(error) : "Equipment not found or permission denied.");
  }

  const savedPath = `/registers/${register}/${id}`;
  revalidatePath("/registers", "layout");
  redirect(`${savedPath}?saved=1`);
}

export async function createPhonePairingCode(personId: string) {
  const { supabase, person } = await requireStaff();
  if (!person?.roles.includes("management")) {
    fail(`/registers/people/${personId}`, "Only management can link phones.");
  }
  const result = await createPairingCode(supabase, {
    personId,
    createdBy: person.id,
  });
  revalidatePath(`/registers/people/${personId}`);
  redirect(`/registers/people/${personId}?pairingCode=${result.code}&expiresAt=${encodeURIComponent(result.expiresAt)}`);
}

export async function revokeTechnicianDevice(personId: string, deviceId: string) {
  const { supabase, person } = await requireStaff();
  if (!person?.roles.includes("management")) {
    fail(`/registers/people/${personId}`, "Only management can revoke phones.");
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("technician_devices")
    .update({ revoked_at: now })
    .eq("id", deviceId)
    .eq("person_id", personId);

  if (error) {
    fail(`/registers/people/${personId}`, error.message);
  }
  revalidatePath(`/registers/people/${personId}`);
  redirect(`/registers/people/${personId}?saved=1`);
}
