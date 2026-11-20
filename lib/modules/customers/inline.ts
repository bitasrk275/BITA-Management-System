import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { text } from "@/lib/forms";
import { parseCustomerInput } from "./schema";
import { createCustomerRecord } from "./service";

// "+ New customer" inside another form (job, quotation): if the new-customer name is filled,
// create that customer and use it; otherwise use the chosen customer_id.
export async function resolveCustomerFromForm(
  supabase: SupabaseClient<Database>,
  fd: FormData,
): Promise<{ ok: true; customerId: string; created: boolean } | { ok: false; error: string }> {
  const newName = text(fd, "new_customer_name");
  if (newName) {
    const parsed = parseCustomerInput({
      name: newName,
      gstin: text(fd, "new_customer_gstin") ?? "",
      billing_address: text(fd, "new_customer_address") ?? "",
      payment_terms_days: text(fd, "new_customer_terms") ?? "",
      uses_proforma: fd.get("new_customer_proforma") === "on",
    });
    if (!parsed.ok) return parsed;
    const { data, error } = await createCustomerRecord(supabase, parsed.value);
    if (error || !data) return { ok: false, error: error ?? "Could not add the new customer." };
    return { ok: true, customerId: data.id, created: true };
  }
  const customerId = text(fd, "customer_id");
  if (!customerId) return { ok: false, error: "Choose a customer, or add a new one." };
  return { ok: true, customerId, created: false };
}
