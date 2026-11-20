"use client";

import { useState } from "react";
import {
  Field,
  Input,
  SecondaryButton,
  Select,
  Status,
} from "@/components/ui";
import { formatINR } from "../../jobs/labels";
import type { PriceItemOption } from "../../invoices/[id]/invoice-draft-editor";

export interface QuotationItemFieldsProps {
  item?: {
    position: number;
    description: string;
    basis: string | null;
    rate: number | null;
    minimum_charge: number | null;
    notes: string | null;
  };
  defaultPosition?: number;
  priceItems?: PriceItemOption[];
}

export function QuotationItemFields({
  item,
  defaultPosition = 1,
  priceItems = [],
}: QuotationItemFieldsProps) {
  const [availableItems, setAvailableItems] = useState<PriceItemOption[]>(priceItems);
  const [selectedPriceItemId, setSelectedPriceItemId] = useState<string>(() => {
    if (!item?.description) return "";
    const matched = priceItems.find(
      (pi) =>
        pi.name.toLowerCase() === item.description.toLowerCase() ||
        (pi.description &&
          item.description.toLowerCase().startsWith(pi.description.toLowerCase())),
    );
    return matched?.id ?? "";
  });

  const [position, setPosition] = useState<string>(
    String(item?.position ?? defaultPosition),
  );
  const [description, setDescription] = useState<string>(item?.description ?? "");
  const [rate, setRate] = useState<string>(
    item?.rate !== null && item?.rate !== undefined ? String(item.rate) : "",
  );
  const [basis, setBasis] = useState<string>(item?.basis ?? "");
  const [minCharge, setMinCharge] = useState<string>(
    item?.minimum_charge !== null && item?.minimum_charge !== undefined
      ? String(item.minimum_charge)
      : "",
  );
  const [notes, setNotes] = useState<string>(item?.notes ?? "");

  const [showAddPriceItem, setShowAddPriceItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemRate, setNewItemRate] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("nos");
  const [savingNewItem, setSavingNewItem] = useState(false);
  const [newItemError, setNewItemError] = useState<string | null>(null);

  function applyPriceItem(found: PriceItemOption) {
    setSelectedPriceItemId(found.id);
    setDescription(found.description?.trim() || found.name);
    setRate(String(Number(found.default_rate) || 0));
    setBasis(found.unit || "nos");
  }

  function handleSelectChange(val: string) {
    if (val === "__add_new__") {
      setShowAddPriceItem(true);
      setNewItemError(null);
      return;
    }
    setSelectedPriceItemId(val);
    if (!val) return;
    const found = availableItems.find((pi) => pi.id === val);
    if (found) {
      applyPriceItem(found);
    }
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
          sac: "998393",
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
      setAvailableItems((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      applyPriceItem(created);
      setNewItemName("");
      setNewItemDesc("");
      setNewItemRate("");
      setNewItemUnit("nos");
      setShowAddPriceItem(false);
    } catch {
      setNewItemError("Network error while saving price item.");
    } finally {
      setSavingNewItem(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field
        label="Select from Price list (or type below)"
        hint="Picking an item fills description, rate and basis automatically; you can edit any field before saving."
      >
        <Select
          value={selectedPriceItemId}
          onChange={(e) => handleSelectChange(e.target.value)}
        >
          <option value="">Choose from price list (or type custom item below)…</option>
          {availableItems.map((pi) => (
            <option key={pi.id} value={pi.id}>
              {pi.name} — {formatINR(Number(pi.default_rate) || 0)} / {pi.unit}
            </option>
          ))}
          <option value="__add_new__">+ Add new item to price list…</option>
        </Select>
      </Field>

      {showAddPriceItem && (
        <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
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
          <div className="grid gap-3 sm:grid-cols-3">
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
                placeholder="8500"
              />
            </Field>
            <Field label="Basis / Unit">
              <Input
                value={newItemUnit}
                onChange={(e) => setNewItemUnit(e.target.value)}
                placeholder="per visit / per shaft"
              />
            </Field>
          </div>
          <Field label="Description (optional)">
            <Input
              value={newItemDesc}
              onChange={(e) => setNewItemDesc(e.target.value)}
              placeholder="Defaults to service name if left blank"
            />
          </Field>
          <SecondaryButton
            type="button"
            disabled={savingNewItem}
            onClick={handleCreateNewPriceItem}
          >
            {savingNewItem ? "Saving…" : "Save to price list & use on quotation"}
          </SecondaryButton>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
        <Field label="Sl. No.">
          <Input
            name="position"
            type="number"
            min="1"
            required
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
        </Field>
        <Field label="Component / inspection description">
          <Input
            name="description"
            required
            placeholder="Ultrasonic testing of forged shafts"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Rate (INR)">
          <Input
            name="rate"
            type="number"
            step="0.01"
            min="0"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </Field>
        <Field label="Basis" hint="e.g. per shaft, per ring, per visit">
          <Input
            name="basis"
            placeholder="per shaft"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
          />
        </Field>
        <Field label="Minimum charge (INR)">
          <Input
            name="minimum_charge"
            type="number"
            step="0.01"
            min="0"
            value={minCharge}
            onChange={(e) => setMinCharge(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes">
        <Input
          name="notes"
          placeholder="Optional item note or conveyance detail"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </div>
  );
}
