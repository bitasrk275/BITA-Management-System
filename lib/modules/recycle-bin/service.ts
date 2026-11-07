import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/types";

export const SOFT_DELETE_TABLES = [
  "customers",
  "enquiries",
  "quotations",
  "jobs",
  "people",
  "equipment",
  "price_items",
] as const;

export type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number];

export type RecycleBinItem = {
  table_name: SoftDeleteTable;
  record_id: string;
  label: string;
  detail: string;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
};

export function isSoftDeleteTable(value: unknown): value is SoftDeleteTable {
  return typeof value === "string" && (SOFT_DELETE_TABLES as readonly string[]).includes(value);
}

export async function softDeleteRecord(
  supabase: SupabaseClient<Database>,
  table: SoftDeleteTable,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSoftDeleteTable(table)) {
    return { ok: false, error: `Unsupported soft-delete table: ${String(table)}` };
  }
  if (!id || !id.trim()) {
    return { ok: false, error: "Record ID is required." };
  }

  const { error } = await supabase.rpc("soft_delete_record", {
    p_table: table,
    p_id: id.trim(),
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function restoreRecord(
  supabase: SupabaseClient<Database>,
  table: SoftDeleteTable,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSoftDeleteTable(table)) {
    return { ok: false, error: `Unsupported restore table: ${String(table)}` };
  }
  if (!id || !id.trim()) {
    return { ok: false, error: "Record ID is required." };
  }

  const { error } = await supabase.rpc("restore_record", {
    p_table: table,
    p_id: id.trim(),
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function listRecycleBin(
  supabase: SupabaseClient<Database>,
  opts?: { table?: SoftDeleteTable },
): Promise<{ data: RecycleBinItem[]; error: string | null }> {
  const { data, error } = await supabase.rpc("list_recycle_bin");
  if (error) {
    return { data: [], error: error.message };
  }

  const items: RecycleBinItem[] = (data ?? [])
    .filter((row): row is typeof row & { table_name: SoftDeleteTable } => isSoftDeleteTable(row.table_name))
    .map((row) => ({
      table_name: row.table_name,
      record_id: row.record_id,
      label: row.label,
      detail: row.detail,
      deleted_at: row.deleted_at,
      deleted_by: row.deleted_by,
      deleted_by_name: row.deleted_by_name,
    }));

  if (opts?.table) {
    return {
      data: items.filter((item) => item.table_name === opts.table),
      error: null,
    };
  }

  return { data: items, error: null };
}
