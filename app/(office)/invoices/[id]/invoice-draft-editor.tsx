"use client";

import { useState } from "react";
import {
  Button,
  Field,
  Input,
  SecondaryButton,
  SectionTitle,
  Select,
  Status,
  Textarea,
} from "@/components/ui";
import {
  INDIAN_STATE_NAMES,
  amountInWordsINR,
  calculateInvoiceGst,
  computeLineAmount,
  sumTaxableValue,
} from "@/lib/invoices";
import { evaluatePoValueWarning } from "@/lib/modules/po/schema";
import { formatINR } from "../../jobs/labels";
import type { InvoiceLineRow } from "../db";

type EditableLine = {
  key: string;
  description: string;
  sac: string;
  qty: string;
  unit: string;
  rate: string;
  minCharge: string;
};

export function InvoiceDraftEditor({
  action,
  invoiceDate,
  dueDate,
  placeOfSupply,
  customerPoNumber,
  poValue,
  otherInvoicesTotal,
  notes,
  customerGstin,
  customerAddress,
  initialLines,
}: {
  action: (formData: FormData) => void | Promise<void>;
  invoiceDate: string;
  dueDate: string;
  placeOfSupply: string;
  customerPoNumber: string;
  poValue?: number | null;
  otherInvoicesTotal?: number | null;
  notes: string;
  customerGstin?: string | null;
  customerAddress?: string | null;
  initialLines: InvoiceLineRow[];
}) {
  const [selectedState, setSelectedState] = useState(placeOfSupply || "29");
  const [poNumber, setPoNumber] = useState(customerPoNumber || "");
  const [defaultSac, setDefaultSac] = useState(initialLines[0]?.sac ?? "");
  const [lines, setLines] = useState<EditableLine[]>(() => {
    if (initialLines.length === 0) {
      return [
        {
          key: "line-0",
          description: "",
          sac: "",
          qty: "1",
          unit: "nos",
          rate: "0",
          minCharge: "",
        },
      ];
    }
    return initialLines.map((l, idx) => {
      const qty = Number(l.qty) || 1;
      const rate = Number(l.rate) || 0;
      const amount = Number(l.amount) || 0;
      const raw = Math.round(qty * rate * 100) / 100;
      const inferredMin = amount > raw && amount > 0 ? String(amount) : "";
      return {
        key: l.id || `line-${idx}`,
        description: l.description,
        sac: l.sac ?? "",
        qty: String(qty),
        unit: l.unit ?? "nos",
        rate: String(rate),
        minCharge: inferredMin,
      };
    });
  });

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        key: `line-${Date.now()}-${prev.length}`,
        description: "",
        sac: defaultSac,
        qty: "1",
        unit: "nos",
        rate: "0",
        minCharge: "",
      },
    ]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index)));
  }

  const computedLines = lines.map((l) => {
    const qtyNum = Number(l.qty);
    const rateNum = Number(l.rate);
    const minNum = l.minCharge.trim() ? Number(l.minCharge) : null;
    return computeLineAmount(
      Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 0,
      Number.isFinite(rateNum) && rateNum >= 0 ? rateNum : 0,
      minNum,
    );
  });

  const taxableValue = sumTaxableValue(computedLines);
  const gst = calculateInvoiceGst(taxableValue, {
    placeOfSupply: selectedState,
    gstin: customerGstin,
    billingAddress: customerAddress,
  });

  const livePoCheck = evaluatePoValueWarning({
    poNumber,
    poValue,
    otherInvoicesTotal,
    currentInvoiceTotal: gst.total,
  });

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Invoice date">
          <Input type="date" name="invoice_date" defaultValue={invoiceDate} required />
        </Field>
        <Field label="Due date (for reminders)">
          <Input type="date" name="due_date" defaultValue={dueDate} required />
        </Field>
        <Field label="Place of supply (GST State)">
          <Select
            name="place_of_supply"
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
          >
            {Object.entries(INDIAN_STATE_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {code} - {name} {code === "29" ? "(CGST 9% + SGST 9%)" : "(IGST 18%)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Customer PO number"
          hint={
            poValue !== null && poValue !== undefined
              ? `PO value: ${formatINR(poValue)}`
              : "Prefilled from the job PO (editable)"
          }
        >
          <Input
            name="customer_po_number"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="e.g. PO/2026/104"
          />
        </Field>
      </div>

      {livePoCheck.exceedsPoValue && livePoCheck.warningMessage && (
        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <Status tone="wait">{livePoCheck.warningMessage}</Status>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Default SAC code"
          hint="Optional setting; applied to lines with a blank SAC."
        >
          <Input
            name="default_sac"
            value={defaultSac}
            onChange={(e) => setDefaultSac(e.target.value)}
            placeholder="Leave blank until BITA confirms SAC (e.g. 998346)"
          />
        </Field>
        <Field label="Notes on invoice">
          <Textarea name="notes" rows={2} defaultValue={notes} placeholder="Optional remarks or enclosures..." />
        </Field>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <SectionTitle>Invoice lines</SectionTitle>
            <p className="text-[12px] text-ink-3">
              Prefilled from the accepted quotation and approved report. If a minimum charge exceeds Qty × Rate, the minimum charge is applied automatically.
            </p>
          </div>
          <SecondaryButton type="button" onClick={addLine}>
            + Add line
          </SecondaryButton>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => {
            const calc = computedLines[index];
            return (
              <div
                key={line.key}
                className="rounded-lg border border-line bg-surface-2/40 p-3.5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-ink-2">
                    Line #{index + 1}
                    {calc.minimum_charge_applied && (
                      <span className="ml-2 rounded bg-ink/10 px-2 py-0.5 text-[11px] font-semibold text-ink">
                        Minimum charge {formatINR(calc.minimum_charge)} applied
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold text-ink tabular-nums">
                      Amount: {formatINR(calc.amount)}
                    </span>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        className="text-[12px] font-medium text-bad hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <Field label="Description">
                      <Input
                        name="line_description"
                        value={line.description}
                        onChange={(e) => updateLine(index, { description: e.target.value })}
                        required
                        placeholder="Service / component description"
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="SAC">
                      <Input
                        name="line_sac"
                        value={line.sac}
                        onChange={(e) => updateLine(index, { sac: e.target.value })}
                        placeholder={defaultSac || "Optional"}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-1">
                    <Field label="Qty">
                      <Input
                        type="number"
                        step="any"
                        min="0.001"
                        name="line_qty"
                        value={line.qty}
                        onChange={(e) => updateLine(index, { qty: e.target.value })}
                        required
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-1">
                    <Field label="Unit">
                      <Input
                        name="line_unit"
                        value={line.unit}
                        onChange={(e) => updateLine(index, { unit: e.target.value })}
                        placeholder="nos"
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-1">
                    <Field label="Rate (INR)">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        name="line_rate"
                        value={line.rate}
                        onChange={(e) => updateLine(index, { rate: e.target.value })}
                        required
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Min charge (opt.)">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        name="line_min_charge"
                        value={line.minCharge}
                        onChange={(e) => updateLine(index, { minCharge: e.target.value })}
                        placeholder="None"
                      />
                    </Field>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live GST & Round-Off Preview */}
      <div className="rounded-lg border border-line bg-surface-2/50 p-4 space-y-2 text-[13px]">
        <div className="flex justify-between text-ink-2">
          <span>Taxable value</span>
          <span className="font-medium text-ink tabular-nums">{formatINR(gst.taxable_value)}</span>
        </div>
        {gst.is_intra_state ? (
          <>
            <div className="flex justify-between text-ink-2">
              <span>CGST @ 9% (Intra-state Karnataka · 29)</span>
              <span className="tabular-nums">{formatINR(gst.cgst)}</span>
            </div>
            <div className="flex justify-between text-ink-2">
              <span>SGST @ 9% (Intra-state Karnataka · 29)</span>
              <span className="tabular-nums">{formatINR(gst.sgst)}</span>
            </div>
          </>
        ) : (
          <div className="flex justify-between text-ink-2">
            <span>IGST @ 18% (Inter-state · {gst.place_of_supply})</span>
            <span className="tabular-nums">{formatINR(gst.igst)}</span>
          </div>
        )}
        <div className="flex justify-between text-ink-2">
          <span>Round-off</span>
          <span className="tabular-nums">
            {gst.round_off > 0 ? "+" : ""}
            {formatINR(gst.round_off)}
          </span>
        </div>
        <div className="flex justify-between border-t border-line pt-2 text-[14px] font-semibold text-ink">
          <span>Total invoice amount (INR)</span>
          <span className="tabular-nums">{formatINR(gst.total)}</span>
        </div>
        <div className="text-[12px] text-ink-3">
          Amount in words: <strong className="font-medium text-ink">{amountInWordsINR(gst.total)}</strong>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="submit">Save draft invoice</Button>
      </div>
    </form>
  );
}
