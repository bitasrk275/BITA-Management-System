import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Tables } from "../../db/types";
import { restoreRecord, softDeleteRecord } from "../recycle-bin/service";
import { checkCanDelete } from "../settings/service";
import type { EnquiryInput } from "./schema";

export type EnquiryRow = Tables<"enquiries">;

export async function listEnquiries(
  supabase: SupabaseClient<Database>,
  opts?: {
    status?: string | null;
    customerId?: string | null;
    q?: string | null;
  },
): Promise<{ data: unknown[]; error: string | null }> {
  let query = supabase
    .from("enquiries")
    .select("*, customers(id, name, code)")
    .order("received_at", { ascending: false });

  if (opts?.status && opts.status !== "all") {
    query = query.eq("status", opts.status as Enums<"enquiry_status">);
  }
  if (opts?.customerId) {
    query = query.eq("customer_id", opts.customerId);
  }
  if (opts?.q && opts.q.trim()) {
    const clean = opts.q.trim().replace(/[%*,()]/g, " ");
    query = query.or(
      `subject.ilike.%${clean}%,from_name.ilike.%${clean}%,from_address.ilike.%${clean}%`,
    );
  }

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

export async function getEnquiryDetail(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: unknown | null; error: string | null }> {
  const { data, error } = await supabase
    .from("enquiries")
    .select("*, customers(id, name, code, gstin)")
    .eq("id", id)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  return { data: data ?? null, error: null };
}

export async function createEnquiryRecord(
  supabase: SupabaseClient<Database>,
  input: EnquiryInput,
): Promise<{ data: EnquiryRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("enquiries")
    .insert({
      source: input.source,
      from_name: input.from_name,
      from_address: input.from_address,
      subject: input.subject,
      body: input.body,
      customer_id: input.customer_id,
      status: input.status ?? (input.customer_id ? "linked" : "new"),
      ...(input.received_at ? { received_at: input.received_at } : {}),
      ...(input.extracted ? { extracted: input.extracted } : {}),
    })
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function updateEnquiryRecord(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: Partial<EnquiryInput>,
): Promise<{ data: EnquiryRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("enquiries")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function deleteEnquiryRecord(
  supabase: SupabaseClient<Database>,
  id: string,
  callerRoles?: readonly Enums<"app_role">[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) return perm;
  return softDeleteRecord(supabase, "enquiries", id);
}

export async function restoreEnquiryRecord(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return restoreRecord(supabase, "enquiries", id);
}
