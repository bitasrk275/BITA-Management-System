import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Json, Tables } from "../../db/types";
import {
  DEFAULT_PERMISSIONS_MATRIX,
  normalizePermissionsMatrix,
  type PermissionAction,
  type PermissionsMatrix,
  type SettingsOptionInput,
} from "./schema";

export type SettingRow = Tables<"settings">;
export type SettingsOptionRow = Tables<"settings_options">;

export async function listSettings(
  supabase: SupabaseClient<Database>,
): Promise<{ data: SettingRow[]; error: string | null }> {
  const { data, error } = await supabase.from("settings").select("*").order("key");
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

export async function getSetting(
  supabase: SupabaseClient<Database>,
  key: string,
): Promise<{ data: SettingRow | null; error: string | null }> {
  const { data, error } = await supabase.from("settings").select("*").eq("key", key).maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function upsertSetting(
  supabase: SupabaseClient<Database>,
  key: string,
  value: Json,
  description?: string | null,
  updatedBy?: string | null,
): Promise<{ data: SettingRow | null; error: string | null }> {
  const trimmedKey = key.trim();
  if (!trimmedKey) return { data: null, error: "Setting key is required." };

  const payload: Database["public"]["Tables"]["settings"]["Insert"] = {
    key: trimmedKey,
    value,
    updated_at: new Date().toISOString(),
    ...(description !== undefined ? { description } : {}),
    ...(updatedBy !== undefined ? { updated_by: updatedBy } : {}),
  };

  const { data, error } = await supabase
    .from("settings")
    .upsert(payload, { onConflict: "key" })
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function getPermissionsMatrix(
  supabase: SupabaseClient<Database>,
): Promise<PermissionsMatrix> {
  const { data } = await getSetting(supabase, "permissions");
  if (!data) return { ...DEFAULT_PERMISSIONS_MATRIX };
  return normalizePermissionsMatrix(data.value);
}

export async function hasPermissionForRoles(
  supabase: SupabaseClient<Database>,
  roles: readonly Enums<"app_role">[] | undefined,
  action: PermissionAction,
): Promise<boolean> {
  if (!roles || roles.length === 0) return false;
  const matrix = await getPermissionsMatrix(supabase);
  const allowed = matrix[action] ?? DEFAULT_PERMISSIONS_MATRIX[action];
  return roles.some((r) => allowed.includes(r));
}

export async function listSettingsOptions(
  supabase: SupabaseClient<Database>,
  opts?: { listKey?: string; activeOnly?: boolean },
): Promise<{ data: SettingsOptionRow[]; error: string | null }> {
  let query = supabase
    .from("settings_options")
    .select("*")
    .order("list_key", { ascending: true })
    .order("position", { ascending: true })
    .order("value", { ascending: true });

  if (opts?.listKey) {
    query = query.eq("list_key", opts.listKey);
  }
  if (opts?.activeOnly) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

export async function createSettingsOption(
  supabase: SupabaseClient<Database>,
  input: SettingsOptionInput,
): Promise<{ data: SettingsOptionRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("settings_options")
    .insert(input)
    .select("*")
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function updateSettingsOption(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: Partial<SettingsOptionInput>,
): Promise<{ data: SettingsOptionRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("settings_options")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function deleteSettingsOption(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("settings_options").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
