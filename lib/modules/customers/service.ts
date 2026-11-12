import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Tables } from "../../db/types";
import { restoreRecord, softDeleteRecord } from "../recycle-bin/service";
import { checkCanDelete } from "../settings/service";
import {
  sanitizeCustomerSearchTerm,
  type ContactInput,
  type CustomerInput,
} from "./schema";

export type CustomerListRow = {
  id: string;
  name: string;
  code: string | null;
  gstin: string | null;
  uses_proforma: boolean;
  contact_count: number;
};

export type CustomerDetail = {
  customer: Tables<"customers">;
  contacts: Tables<"customer_contacts">[];
  enquiries: Pick<
    Tables<"enquiries">,
    "id" | "subject" | "source" | "status" | "received_at"
  >[];
};

export async function listCustomers(
  supabase: SupabaseClient<Database>,
  opts?: { q?: string | null },
): Promise<{ data: CustomerListRow[]; error: string | null }> {
  let query = supabase
    .from("customers")
    .select("id, name, code, gstin, uses_proforma, customer_contacts(count)")
    .order("name");

  const term = sanitizeCustomerSearchTerm(opts?.q);
  if (term) {
    query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,gstin.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) {
    return { data: [], error: error.message };
  }

  const rows: CustomerListRow[] = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    gstin: c.gstin,
    uses_proforma: c.uses_proforma,
    contact_count: c.customer_contacts?.[0]?.count ?? 0,
  }));

  return { data: rows, error: null };
}

export async function getCustomerDetail(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: CustomerDetail | null; error: string | null }> {
  const { data: customer, error: custError } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (custError) {
    return { data: null, error: custError.message };
  }
  if (!customer) {
    return { data: null, error: null };
  }

  const [{ data: contacts, error: contactsError }, { data: enquiries, error: enquiriesError }] =
    await Promise.all([
      supabase.from("customer_contacts").select("*").eq("customer_id", id).order("name"),
      supabase
        .from("enquiries")
        .select("id, subject, source, status, received_at")
        .eq("customer_id", id)
        .order("received_at", { ascending: false })
        .limit(10),
    ]);

  if (contactsError) return { data: null, error: contactsError.message };
  if (enquiriesError) return { data: null, error: enquiriesError.message };

  return {
    data: {
      customer,
      contacts: contacts ?? [],
      enquiries: enquiries ?? [],
    },
    error: null,
  };
}

export async function createCustomerRecord(
  supabase: SupabaseClient<Database>,
  input: CustomerInput,
): Promise<{ data: Tables<"customers"> | null; error: string | null }> {
  const { data, error } = await supabase
    .from("customers")
    .insert(input)
    .select("*")
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function updateCustomerRecord(
  supabase: SupabaseClient<Database>,
  id: string,
  input: CustomerInput,
): Promise<{ data: Tables<"customers"> | null; error: string | null }> {
  const { data, error } = await supabase
    .from("customers")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function deleteCustomerRecord(
  supabase: SupabaseClient<Database>,
  id: string,
  callerRoles?: readonly Enums<"app_role">[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) return perm;
  return softDeleteRecord(supabase, "customers", id);
}

export async function restoreCustomerRecord(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return restoreRecord(supabase, "customers", id);
}

export async function addCustomerContact(
  supabase: SupabaseClient<Database>,
  customerId: string,
  input: ContactInput,
): Promise<{ data: Tables<"customer_contacts"> | null; error: string | null }> {
  const { data, error } = await supabase
    .from("customer_contacts")
    .insert({ customer_id: customerId, ...input })
    .select("*")
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function updateCustomerContact(
  supabase: SupabaseClient<Database>,
  contactId: string,
  input: ContactInput,
): Promise<{ data: Tables<"customer_contacts"> | null; error: string | null }> {
  const { data, error } = await supabase
    .from("customer_contacts")
    .update(input)
    .eq("id", contactId)
    .select("*")
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function deleteCustomerContact(
  supabase: SupabaseClient<Database>,
  contactId: string,
  callerRoles?: readonly Enums<"app_role">[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) return perm;
  const { error } = await supabase.from("customer_contacts").delete().eq("id", contactId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
