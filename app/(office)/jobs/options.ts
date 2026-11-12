import type { requireStaff } from "@/lib/auth";
import { getActiveTestMethods } from "@/lib/modules/settings/templates";

type Supabase = Awaited<ReturnType<typeof requireStaff>>["supabase"];

// Choices for the job form: customers, open enquiries, quotations, and active test methods.
export async function jobFormOptions(supabase: Supabase) {
  const [{ data: customers }, { data: enquiries }, { data: quotations }, activeMethods] =
    await Promise.all([
      supabase.from("customers").select("id, name").order("name"),
      supabase
        .from("enquiries")
        .select("id, subject, customers(name)")
        .neq("status", "closed")
        .order("received_at", { ascending: false })
        .limit(100),
      supabase
        .from("quotations")
        .select("id, ref_no, status, customers(name)")
        .order("quote_date", { ascending: false })
        .limit(100),
      getActiveTestMethods(supabase).catch(() => []),
    ]);
  return {
    customers: (customers ?? []).map((c) => ({ id: c.id, label: c.name })),
    enquiries: (enquiries ?? []).map((e) => ({
      id: e.id,
      label: `${e.subject ?? "(no subject)"}${e.customers ? " – " + e.customers.name : ""}`,
    })),
    quotations: (quotations ?? []).map((q) => ({
      id: q.id,
      label: `${q.ref_no ?? "Draft"} (${q.status})${q.customers ? " – " + q.customers.name : ""}`,
    })),
    availableTestMethods: (activeMethods ?? []).map((m) => ({
      code: m.code,
      label: m.label,
    })),
  };
}
