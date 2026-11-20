import { Field, Input } from "@/components/ui";

// Collapsible "+ New customer" block for the job and quotation forms.
// Filling the name creates the customer on save and uses it instead of the list choice.
export function NewCustomerFields() {
  return (
    <details className="rounded-lg border border-line px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-info">+ New customer</summary>
      <p className="mt-2 text-[12.5px] text-ink-3">
        Not in the list? Fill this in and the customer is added when you save. More details can be added later on the Customers page.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Company name">
          <Input name="new_customer_name" placeholder="e.g. Apex Forge Pvt Ltd" />
        </Field>
        <Field label="GSTIN (optional)">
          <Input name="new_customer_gstin" />
        </Field>
        <Field label="Billing address (optional)">
          <Input name="new_customer_address" />
        </Field>
        <Field label="Payment terms (days)">
          <Input name="new_customer_terms" type="number" min="0" max="365" placeholder="30" />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" name="new_customer_proforma" className="h-4 w-4" />
        Send a proforma invoice before the GST invoice
      </label>
    </details>
  );
}
