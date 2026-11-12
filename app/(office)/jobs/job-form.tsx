import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Constants, type Enums, type Tables } from "@/lib/db/types";
import { JOB_STATUS_LABEL, METHOD_LABEL } from "./labels";

type Option = { id: string; label: string };

// Shared by "new job" and "edit job". The Job ID itself is created by the database.
export function JobForm({
  action,
  job,
  customers,
  enquiries,
  quotations,
  defaults,
  submitLabel,
  availableTestMethods,
}: {
  action: (fd: FormData) => Promise<void>;
  job?: Tables<"jobs">;
  customers: Option[];
  enquiries: Option[];
  quotations: Option[];
  defaults?: {
    customer_id?: string;
    enquiry_id?: string;
    quotation_id?: string;
    scope?: string;
    site?: string;
    test_methods?: Enums<"test_method">[];
  };
  submitLabel: string;
  availableTestMethods?: Array<{ code: string; label: string }>;
}) {
  const methods = new Set(job?.test_methods ?? defaults?.test_methods ?? []);
  const methodsList =
    availableTestMethods && availableTestMethods.length > 0
      ? availableTestMethods
      : Constants.public.Enums.test_method.map((m) => ({
          code: m,
          label: METHOD_LABEL[m],
        }));
  return (
    <form action={action} className="space-y-4">
      <Field label="Customer">
        <Select name="customer_id" required defaultValue={job?.customer_id ?? defaults?.customer_id ?? ""}>
          <option value="" disabled>
            Choose a customer
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From enquiry">
          <Select name="enquiry_id" defaultValue={job?.enquiry_id ?? defaults?.enquiry_id ?? ""}>
            <option value="">None</option>
            {enquiries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quotation" hint="An approved quotation can be reused for repeat work">
          <Select name="quotation_id" defaultValue={job?.quotation_id ?? defaults?.quotation_id ?? ""}>
            <option value="">None yet</option>
            {quotations.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Scope of work">
        <Textarea
          name="scope"
          defaultValue={job?.scope ?? defaults?.scope ?? ""}
          placeholder="Components, quantity, standard…"
        />
      </Field>
      <fieldset>
        <legend className="text-sm font-medium text-ink-2">Test methods</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {methodsList.map((m) => (
            <label key={m.code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="test_methods"
                value={m.code}
                defaultChecked={methods.has(m.code as Enums<"test_method">)}
                className="h-4 w-4"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Site">
        <Input
          name="site"
          defaultValue={job?.site ?? defaults?.site ?? ""}
          placeholder="Customer works, or site address"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="PO number" hint="Not needed before work starts; add it when the PO arrives">
          <Input name="po_number" defaultValue={job?.po_number ?? ""} />
        </Field>
        <Field label="PO date">
          <Input name="po_date" type="date" defaultValue={job?.po_date ?? ""} />
        </Field>
        <Field label="PO value (₹)" hint="Warn if invoices exceed this amount">
          <Input
            name="po_value"
            type="number"
            step="0.01"
            min="0"
            defaultValue={job?.po_value ?? ""}
            placeholder="0.00"
          />
        </Field>
      </div>
      <Field label={job?.po_path ? "Replace PO file" : "PO file"}>
        <Input name="po_file" type="file" accept=".pdf,image/*" />
      </Field>
      {job && (
        <Field label="Status">
          <Select name="status" defaultValue={job.status}>
            {Constants.public.Enums.job_status.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}
