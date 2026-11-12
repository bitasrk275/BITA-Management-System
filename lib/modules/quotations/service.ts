import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Tables } from "../../db/types";
import { restoreRecord, softDeleteRecord } from "../recycle-bin/service";
import { hasPermissionForRoles } from "../settings/service";
import type { QuotationInput, QuotationItemInput } from "./schema";

export type QuotationRow = Tables<"quotations">;

export async function listQuotations(
  supabase: SupabaseClient<Database>,
  opts?: {
    status?: string | null;
    customerId?: string | null;
    q?: string | null;
  },
): Promise<{ data: unknown[]; error: string | null }> {
  let query = supabase
    .from("quotations")
    .select("*, customers(id, name, code), quotation_items(*)")
    .order("quote_date", { ascending: false });

  if (opts?.status && opts.status !== "all") {
    query = query.eq("status", opts.status as Enums<"quotation_status">);
  }
  if (opts?.customerId) {
    query = query.eq("customer_id", opts.customerId);
  }
  if (opts?.q && opts.q.trim()) {
    const clean = opts.q.trim().replace(/[%*,()]/g, " ");
    query = query.or(
      `ref_no.ilike.%${clean}%,subject.ilike.%${clean}%,attention.ilike.%${clean}%`,
    );
  }

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

export async function getQuotationDetail(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: unknown | null; error: string | null }> {
  const { data, error } = await supabase
    .from("quotations")
    .select(
      "*, customers(id, name, code, gstin, billing_address), quotation_items(*)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  return { data: data ?? null, error: null };
}

export async function createQuotationRecord(
  supabase: SupabaseClient<Database>,
  input: QuotationInput,
): Promise<{ data: QuotationRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("quotations")
    .insert({
      ref_no: input.ref_no,
      customer_id: input.customer_id,
      enquiry_id: input.enquiry_id,
      quote_date: input.quote_date,
      attention: input.attention,
      subject: input.subject,
      terms: input.terms,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { data: null, error: error?.message ?? "Could not create quotation." };
  }

  if (input.items && input.items.length > 0) {
    await supabase.from("quotation_items").insert(
      input.items.map((item, idx) => ({
        quotation_id: data.id,
        position: item.position || idx + 1,
        description: item.description,
        basis: item.basis,
        rate: item.rate,
        minimum_charge: item.minimum_charge,
        notes: item.notes,
      })),
    );
  }

  if (input.enquiry_id) {
    await supabase
      .from("enquiries")
      .update({ status: "quoted" })
      .eq("id", input.enquiry_id)
      .neq("status", "converted");
  }

  return { data, error: null };
}

export async function updateQuotationRecord(
  supabase: SupabaseClient<Database>,
  id: string,
  input: Partial<QuotationInput>,
  actor?: { id: string; roles: readonly Enums<"app_role">[] } | null,
): Promise<{ data: QuotationRow | null; error: string | null }> {
  const { data: existing } = await supabase
    .from("quotations")
    .select("status, approved_at, approved_by")
    .eq("id", id)
    .maybeSingle();

  let approvalPatch: {
    approved_by?: string | null;
    approved_at?: string | null;
    superseded_by?: string | null;
  } = {};

  if (
    input.status &&
    ["approved", "sent", "accepted"].includes(input.status) &&
    !existing?.approved_at
  ) {
    if (!actor || !actor.roles.includes("management")) {
      return {
        data: null,
        error: "Only management can approve or send a quotation.",
      };
    }
    approvalPatch = {
      approved_by: actor.id,
      approved_at: new Date().toISOString(),
    };
  } else if (input.status === "draft") {
    approvalPatch = {
      approved_by: null,
      approved_at: null,
      superseded_by: null,
    };
  }

  const patch: Database["public"]["Tables"]["quotations"]["Update"] = {
    ...(input.ref_no !== undefined ? { ref_no: input.ref_no } : {}),
    ...(input.customer_id !== undefined ? { customer_id: input.customer_id } : {}),
    ...(input.enquiry_id !== undefined ? { enquiry_id: input.enquiry_id } : {}),
    ...(input.quote_date !== undefined ? { quote_date: input.quote_date } : {}),
    ...(input.attention !== undefined ? { attention: input.attention } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.terms !== undefined ? { terms: input.terms } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...approvalPatch,
  };

  const { data, error } = await supabase
    .from("quotations")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function addQuotationItemRecord(
  supabase: SupabaseClient<Database>,
  quotationId: string,
  item: QuotationItemInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("quotation_items").insert({
    quotation_id: quotationId,
    position: item.position,
    description: item.description,
    basis: item.basis,
    rate: item.rate,
    minimum_charge: item.minimum_charge,
    notes: item.notes,
  });
  return { error: error?.message ?? null };
}

export async function updateQuotationItemRecord(
  supabase: SupabaseClient<Database>,
  quotationId: string,
  itemId: string,
  item: QuotationItemInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("quotation_items")
    .update({
      position: item.position,
      description: item.description,
      basis: item.basis,
      rate: item.rate,
      minimum_charge: item.minimum_charge,
      notes: item.notes,
    })
    .eq("id", itemId)
    .eq("quotation_id", quotationId);
  return { error: error?.message ?? null };
}

export async function deleteQuotationItemRecord(
  supabase: SupabaseClient<Database>,
  quotationId: string,
  itemId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("quotation_items")
    .delete()
    .eq("id", itemId)
    .eq("quotation_id", quotationId);
  return { error: error?.message ?? null };
}

export async function deleteQuotationRecord(
  supabase: SupabaseClient<Database>,
  id: string,
  callerRoles?: readonly Enums<"app_role">[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (callerRoles && callerRoles.length > 0) {
    const allowed = await hasPermissionForRoles(supabase, callerRoles, "delete");
    if (!allowed) {
      return {
        ok: false,
        error: "Permission denied: your role is not permitted to delete records.",
      };
    }
  }

  // Rule: deleting a quotation that has an active job is refused
  const { data: linkedJobs, error: jobErr } = await supabase
    .from("jobs")
    .select("id, job_no")
    .eq("quotation_id", id)
    .is("deleted_at", null);

  if (jobErr) {
    return { ok: false, error: "Failed to check linked jobs: " + jobErr.message };
  }
  if (linkedJobs && linkedJobs.length > 0) {
    const jobList = linkedJobs.map((j) => j.job_no).join(", ");
    return {
      ok: false,
      error: `Cannot delete quotation: active job (${jobList}) is linked to this quotation.`,
    };
  }

  return softDeleteRecord(supabase, "quotations", id);
}

export async function restoreQuotationRecord(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return restoreRecord(supabase, "quotations", id);
}
