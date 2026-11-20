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

// Choices for scheduling on the new-job screen: active technicians and active equipment.
export async function jobScheduleOptions(supabase: Supabase) {
  const [{ data: techs }, { data: equipment }] = await Promise.all([
    supabase
      .from("people")
      .select("id, full_name")
      .contains("roles", ["technician"])
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("equipment")
      .select("id, make, model, serial_no, equipment_types(name)")
      .is("deleted_at", null)
      .eq("active", true)
      .order("make"),
  ]);
  return {
    technicians: (techs ?? []).map((t) => ({ id: t.id, label: t.full_name })),
    equipment: (equipment ?? []).map((e) => {
      const type = (e.equipment_types as unknown as { name?: string } | null)?.name;
      const name = [e.make, e.model].filter(Boolean).join(" ") || type || "Equipment";
      return { id: e.id, label: `${name}${e.serial_no ? ` (${e.serial_no})` : ""}` };
    }),
  };
}
