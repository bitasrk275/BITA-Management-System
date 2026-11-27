"use client";

import { useState } from "react";
import { NewCustomerFields } from "@/components/new-customer-fields";
import { Button, Field, Input, Mono, SecondaryButton, SectionTitle, Select, Textarea } from "@/components/ui";
import { Constants, type Tables } from "@/lib/db/types";
import { formatINR } from "../jobs/labels";
import { DEFAULT_QUOTATION_TERMS, QUOTATION_STATUS_LABEL } from "./labels";
import { calculateQuotationTotal, QUOTATION_FILE_ACCEPT, quotationFileName } from "./upload";

type Option = { id: string; label: string };

type DraftItemRow = {
  key: number;
  description: string;
  rate: string;
  basis: string;
  minimum_charge: string;
  notes: string;
};

export function QuotationForm({
  action,
  quotation,
  defaults,
  customers,
  enquiries,
  includeFirstItem = false,
  submitLabel,
  priceItems = [],
}: {
  action: (fd: FormData) => Promise<void>;
  quotation?: Tables<"quotations">;
  defaults?: {
    customer_id?: string;
    enquiry_id?: string;
    attention?: string;
    subject?: string;
  };
  customers: Option[];
  enquiries: Option[];
  includeFirstItem?: boolean;
  submitLabel: string;
  // Price list, so items are picked instead of typed (same list as on invoices).
  priceItems?: Array<{ id: string; name: string; description: string | null; unit: string; default_rate: number }>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const existingFileName = quotationFileName(quotation?.pdf_path);

  const [rows, setRows] = useState<DraftItemRow[]>([
    { key: 1, description: "", rate: "", basis: "", minimum_charge: "", notes: "" },
  ]);

  const draftTotal = calculateQuotationTotal(
    rows.map((r) => ({
      rate: r.rate.trim() ? Number(r.rate) : null,
      minimum_charge: r.minimum_charge.trim() ? Number(r.minimum_charge) : null,
    })),
  );

  function updateRow(index: number, patch: Partial<DraftItemRow>) {
    setRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: (prev[prev.length - 1]?.key ?? 0) + 1,
        description: "",
        rate: "",
        basis: "",
        minimum_charge: "",
        notes: "",
      },
    ]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== index) : prev));
  }

  return (
    <form action={action} className="max-w-xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quotation Ref. No." hint="BITA format, e.g. 027-2026">
          <Input name="ref_no" placeholder="027-2026" defaultValue={quotation?.ref_no ?? ""} />
        </Field>
        <Field label="Quotation date">
          <Input name="quote_date" type="date" required defaultValue={quotation?.quote_date ?? today} />
        </Field>
      </div>

      <Field label="Customer">
        <Select name="customer_id" required={!!quotation} defaultValue={quotation?.customer_id ?? defaults?.customer_id ?? ""}>
          <option value="">Choose a customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>

      {!quotation && <NewCustomerFields />}

      {enquiries.length > 0 || quotation?.enquiry_id || defaults?.enquiry_id ? (
        <Field label="Enquiry (optional)">
          <Select name="enquiry_id" defaultValue={quotation?.enquiry_id ?? defaults?.enquiry_id ?? ""}>
            <option value="">Not from an enquiry</option>
            {enquiries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Kind attention" hint="Contact person or department at the customer">
        <Input
          name="attention"
          placeholder="Purchase / Quality Department"
          defaultValue={quotation?.attention ?? defaults?.attention ?? ""}
        />
      </Field>

      <Field label="Subject" hint="Component and NDT method, e.g. Ultrasonic Testing of Forged Shafts">
        <Input name="subject" defaultValue={quotation?.subject ?? defaults?.subject ?? ""} />
      </Field>

      <Field
        label={existingFileName ? "Replace quotation file (PDF or Word)" : "Upload quotation file (PDF or Word)"}
        hint="Upload the quotation prepared by BITA (.pdf, .doc or .docx, max 6 MB)"
      >
        <Input name="pdf_file" type="file" accept={QUOTATION_FILE_ACCEPT} />
        {quotation && existingFileName && (
          <div className="mt-1 text-[13px] text-ink-2">
            Current file:{" "}
            <a href={`/quotations/${quotation.id}/file`} className="font-medium underline">
              {existingFileName}
            </a>
          </div>
        )}
      </Field>

      <Field label="Terms and conditions" hint="No fixed expiry date">
        <Textarea name="terms" defaultValue={quotation?.terms ?? DEFAULT_QUOTATION_TERMS} />
      </Field>

      {includeFirstItem && (
        <div className="space-y-4 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <SectionTitle>Quoted items, rates &amp; total</SectionTitle>
            <SecondaryButton type="button" onClick={addRow}>
              + Add item
            </SecondaryButton>
          </div>
          <p className="text-[13px] text-ink-2">
            Enter the quoted items and rates so the GST invoice can be filled from them after the report is approved.
          </p>

          {rows.map((row, idx) => (
            <div key={row.key} className="space-y-3 rounded-md border border-line-2 bg-surface-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-ink-2">Item #{idx + 1}</span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="text-[13px] text-ink-3 underline hover:text-ink"
                  >
                    Remove
                  </button>
                )}
              </div>
              {priceItems.length > 0 && (
                <Field label="Pick from Price list (or type below)">
                  <Select
                    value=""
                    onChange={(e) => {
                      const pi = priceItems.find((p) => p.id === e.target.value);
                      if (!pi) return;
                      updateRow(idx, {
                        description: pi.description ? `${pi.name} – ${pi.description}` : pi.name,
                        rate: String(pi.default_rate ?? ""),
                        basis: pi.unit ? `per ${pi.unit}` : row.basis,
                      });
                    }}
                  >
                    <option value="">Choose a price list item…</option>
                    {priceItems.map((pi) => (
                      <option key={pi.id} value={pi.id}>
                        {pi.name} · {formatINR(pi.default_rate)}
                        {pi.unit ? ` per ${pi.unit}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Component / scope description">
                <Input
                  name="item_description"
                  value={row.description}
                  onChange={(e) => updateRow(idx, { description: e.target.value })}
                  placeholder="UT of forged shafts at customer works"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Rate (INR)">
                  <Input
                    name="item_rate"
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.rate}
                    onChange={(e) => updateRow(idx, { rate: e.target.value })}
                    placeholder="2500"
                  />
                </Field>
                <Field label="Basis">
                  <Input
                    name="item_basis"
                    value={row.basis}
                    onChange={(e) => updateRow(idx, { basis: e.target.value })}
                    placeholder="per shaft / per visit"
                  />
                </Field>
                <Field label="Minimum charge (INR)">
                  <Input
                    name="item_minimum_charge"
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.minimum_charge}
                    onChange={(e) => updateRow(idx, { minimum_charge: e.target.value })}
                    placeholder="5500"
                  />
                </Field>
              </div>
              <Field label="Item notes">
                <Input
                  name="item_notes"
                  value={row.notes}
                  onChange={(e) => updateRow(idx, { notes: e.target.value })}
                  placeholder="Conveyance or minimum billing notes"
                />
              </Field>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-3 py-2 text-[15px]">
            <span className="font-medium text-ink-2">Quoted total (before GST)</span>
            <strong className="text-ink"><Mono>{formatINR(draftTotal)}</Mono></strong>
          </div>
        </div>
      )}

      {quotation && (
        <Field label="Status" hint="Draft → Sent to customer → Accepted by customer or Rejected">
          <Select
            name="status"
            defaultValue={quotation.status === "superseded" && !quotation.superseded_by ? "rejected" : quotation.status}
          >
            {Constants.public.Enums.quotation_status.map((s) => (
              <option key={s} value={s}>
                {QUOTATION_STATUS_LABEL[s]}
              </option>
            ))}
            <option value="rejected">Rejected</option>
          </Select>
        </Field>
      )}

      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}
