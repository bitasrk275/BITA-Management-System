import { NewCustomerFields } from "@/components/new-customer-fields";
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
  schedule,
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
  // New job only: technician, dates and equipment on the same screen, so the job lands on the calendar.
  schedule?: {
    technicians: Option[];
    equipment: Option[];
    techId?: string;
    date?: string;
    returnTo?: string;
  };
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
        <Select name="customer_id" required={!!job} defaultValue={job?.customer_id ?? defaults?.customer_id ?? ""}>
          <option value="">Choose a customer</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      {!job && <NewCustomerFields />}
      <div className="grid gap-4 sm:grid-cols-2">
        {enquiries.length > 0 || job?.enquiry_id || defaults?.enquiry_id ? (
          <Field label="Enquiry (optional)">
            <Select name="enquiry_id" defaultValue={job?.enquiry_id ?? defaults?.enquiry_id ?? ""}>
              <option value="">Not from an enquiry</option>
              {enquiries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
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
        <legend className="text-[15px] font-medium text-ink-2">Test methods</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {methodsList.map((m) => (
            <label key={m.code} className="flex items-center gap-2 text-[15px]">
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
      {!job && schedule && (
        <fieldset className="space-y-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-[15px] font-medium text-ink-2">Schedule (shows on the calendar)</legend>
          {schedule.returnTo && <input type="hidden" name="return_to" value={schedule.returnTo} />}
          <div>
            <p className="text-[15px] text-ink-2">Technicians</p>
            {schedule.technicians.length === 0 ? (
              <p className="mt-1 text-[14px] text-ink-3">No active technicians yet. Add them under Employees.</p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {schedule.technicians.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-[15px]">
                    <input
                      type="checkbox"
                      name="technician_ids"
                      value={t.id}
                      defaultChecked={t.id === schedule.techId}
                      className="h-4 w-4"
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date">
              <Input name="work_date" type="date" defaultValue={schedule.date ?? ""} />
            </Field>
            <Field label="End date" hint="Leave empty for a one-day job">
              <Input name="end_date" type="date" />
            </Field>
          </div>
          {schedule.equipment.length > 0 && (
            <div>
              <p className="text-[15px] text-ink-2">Equipment</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {schedule.equipment.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-[15px]">
                    <input type="checkbox" name="equipment_ids" value={e.id} className="h-4 w-4" />
                    {e.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          <p className="text-[14px] text-ink-3">
            Optional. Leave it empty to schedule later from the Calendar.
          </p>
        </fieldset>
      )}
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
