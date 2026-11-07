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

export type PriceItemOption = {
  id: string;
  name: string;
  description: string | null;
  sac: string | null;
  unit: string;
  default_rate: number;
};

type EditableLine = {
  key: string;
  priceItemId: string;
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
  priceItems = [],
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
  priceItems?: PriceItemOption[];
}) {
  const [selectedState, setSelectedState] = useState(placeOfSupply || "29");
  const [poNumber, setPoNumber] = useState(customerPoNumber || "");
  const [defaultSac, setDefaultSac] = useState(initialLines[0]?.sac ?? "998346");
  const [availablePriceItems, setAvailablePriceItems] = useState<PriceItemOption[]>(priceItems);
  const [showAddPriceItem, setShowAddPriceItem] = useState(false);
  const [targetLineForNewItem, setTargetLineForNewItem] = useState<number | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemRate, setNewItemRate] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("nos");
  const [newItemSac, setNewItemSac] = useState("998346");
  const [savingNewItem, setSavingNewItem] = useState(false);
  const [newItemError, setNewItemError] = useState<string | null>(null);

  const [lines, setLines] = useState<EditableLine[]>(() => {
    if (initialLines.length === 0) {
      return [
        {
          key: "line-0",
          priceItemId: "",
          description: "",
          sac: "998346",
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
      const matched = priceItems.find(
        (pi) =>
          pi.name.toLowerCase() === l.description.toLowerCase() ||
          (pi.description && l.description.toLowerCase().startsWith(pi.description.toLowerCase())),
      );
      return {
        key: l.id || `line-${idx}`,
        priceItemId: matched?.id ?? "",
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

  function applyPriceItemToLine(index: number, item: PriceItemOption) {
    updateLine(index, {
      priceItemId: item.id,
      description: item.description?.trim() || item.name,
      sac: item.sac || defaultSac,
      unit: item.unit || "nos",
      rate: String(Number(item.default_rate) || 0),
    });
  }

  function handlePriceItemSelect(index: number, selectedValue: string) {
    if (selectedValue === "__add_new__") {
      setTargetLineForNewItem(index);
      setShowAddPriceItem(true);
      setNewItemError(null);
      return;
    }
    if (!selectedValue) {
      updateLine(index, { priceItemId: "" });
      return;
    }
    const found = availablePriceItems.find((item) => item.id === selectedValue);
    if (found) {
      applyPriceItemToLine(index, found);
    }
  }

  function addLine(item?: PriceItemOption) {
    setLines((prev) => [
      ...prev,
      {
        key: `line-${Date.now()}-${prev.length}`,
        priceItemId: item?.id ?? "",
        description: item ? item.description?.trim() || item.name : "",
        sac: item?.sac || defaultSac,
        qty: "1",
        unit: item?.unit || "nos",
        rate: item ? String(Number(item.default_rate) || 0) : "0",
        minCharge: "",
      },
    ]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index)));
  }

  async function handleCreateNewPriceItem() {
    if (!newItemName.trim()) {
      setNewItemError("Enter a service or item name.");
      return;
    }
    const rateNum = newItemRate.trim() ? Number(newItemRate) : 0;
    if (!Number.isFinite(rateNum) || rateNum < 0) {
      setNewItemError("Enter a valid non-negative default rate.");
      return;
    }

    setSavingNewItem(true);
    setNewItemError(null);

    try {
      const response = await fetch("/api/v1/price-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newItemName.trim(),
          description: newItemDesc.trim() || newItemName.trim(),
          default_rate: rateNum,
          unit: newItemUnit.trim() || "nos",
          sac: newItemSac.trim() || defaultSac || "998346",
          active: true,
        }),
      });

      const payload = (await response.json()) as {
        data?: PriceItemOption;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        setNewItemError(payload.error ?? "Could not add price item.");
        setSavingNewItem(false);
        return;
      }

      const created = payload.data;
      setAvailablePriceItems((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );

      if (targetLineForNewItem !== null && targetLineForNewItem < lines.length) {
        applyPriceItemToLine(targetLineForNewItem, created);
      } else {
        addLine(created);
      }

      setNewItemName("");
      setNewItemDesc("");
      setNewItemRate("");
      setNewItemUnit("nos");
      setShowAddPriceItem(false);
      setTargetLineForNewItem(null);
    } catch {
      setNewItemError("Network error while saving price item.");
    } finally {
      setSavingNewItem(false);
    }
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
            <SectionTitle>Invoice lines (from Price list)</SectionTitle>
            <p className="text-[12px] text-ink-3">
              Select services and charges from the price list dropdown or click <strong>+ Add new item</strong>. Rates can be adjusted per invoice without changing past invoices.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              type="button"
              onClick={() => {
                setTargetLineForNewItem(null);
                setShowAddPriceItem((prev) => !prev);
                setNewItemError(null);
              }}
            >
              + Add new item
            </SecondaryButton>
            <SecondaryButton type="button" onClick={() => addLine()}>
              + Add line
            </SecondaryButton>
          </div>
        </div>

        {showAddPriceItem && (
          <div className="rounded-lg border border-line bg-surface-2 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink">
                Add new service / charge to Price list
              </span>
              <button
                type="button"
                onClick={() => setShowAddPriceItem(false)}
                className="text-xs text-ink-3 underline"
              >
                Cancel
              </button>
            </div>
            {newItemError && <Status tone="bad">{newItemError}</Status>}
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Service name">
                <Input
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g. UT service"
                />
              </Field>
              <Field label="Default rate (₹)">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newItemRate}
                  onChange={(e) => setNewItemRate(e.target.value)}
                  placeholder="7500"
                />
              </Field>
              <Field label="Unit">
                <Input
                  value={newItemUnit}
                  onChange={(e) => setNewItemUnit(e.target.value)}
                  placeholder="nos / visit"
                />
              </Field>
              <Field label="SAC">
                <Input
                  value={newItemSac}
                  onChange={(e) => setNewItemSac(e.target.value)}
                  placeholder="998346"
                />
              </Field>
            </div>
            <Field label="Description on invoice line (optional)">
              <Input
                value={newItemDesc}
                onChange={(e) => setNewItemDesc(e.target.value)}
                placeholder="Defaults to service name if left blank"
              />
            </Field>
            <div className="flex items-center gap-2">
              <SecondaryButton
                type="button"
                disabled={savingNewItem}
                onClick={handleCreateNewPriceItem}
              >
                {savingNewItem ? "Adding to price list…" : "Save to price list & use on invoice"}
              </SecondaryButton>
            </div>
          </div>
        )}

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
                  <div className="sm:col-span-4">
                    <Field label="Price list item">
                      <Select
                        value={line.priceItemId}
                        onChange={(e) => handlePriceItemSelect(index, e.target.value)}
                      >
                        <option value="">Choose from price list…</option>
                        {availablePriceItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} — {formatINR(Number(item.default_rate) || 0)} / {item.unit}
                          </option>
                        ))}
                        <option value="__add_new__">+ Add new item to price list…</option>
                      </Select>
                    </Field>
                  </div>
                  <div className="sm:col-span-8">
                    <Field label="Description on invoice">
                      <Input
                        name="line_description"
                        value={line.description}
                        onChange={(e) => updateLine(index, { description: e.target.value })}
                        required
                        placeholder="Service / component description"
                      />
                    </Field>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-3">
                    <Field label="SAC">
                      <Input
                        name="line_sac"
                        value={line.sac}
                        onChange={(e) => updateLine(index, { sac: e.target.value })}
                        placeholder={defaultSac || "Optional"}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
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
                  <div className="sm:col-span-2">
                    <Field label="Unit">
                      <Input
                        name="line_unit"
                        value={line.unit}
                        onChange={(e) => updateLine(index, { unit: e.target.value })}
                        placeholder="nos"
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-3">
                    <Field label="Rate (INR, editable)">
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
