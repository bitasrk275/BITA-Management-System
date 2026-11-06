// Builds invoice lines by combining the accepted quotation's priced items
// (rate, basis, minimum_charge) with the approved report's inspected items and quantities.
// Applies the quotation's minimum charge whenever (qty * rate) is lower than minimum_charge
// ("per shaft ... or Rs 8500 basic, whichever is higher").

import { DEFAULT_SAC_CODE, roundPaise } from "./gst";

export interface QuotationItemSource {
  id?: string;
  position?: number | null;
  description: string;
  basis?: string | null;
  rate?: number | string | null;
  minimum_charge?: number | string | null;
  notes?: string | null;
}

export interface ReportItemSource {
  description?: string | null;
  quantity?: number | string | null;
  observations?: string | null;
}

export interface BuiltInvoiceLine {
  position: number;
  description: string;
  sac: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  minimum_charge: number | null;
  minimum_charge_applied: boolean;
}

export interface LineAmountResult {
  qty: number;
  rate: number;
  raw_amount: number;
  minimum_charge: number | null;
  minimum_charge_applied: boolean;
  amount: number;
}

/**
 * Parses a quantity value from a report item (defaulting to 1 when blank or invalid).
 */
export function parseQuantity(value: unknown, fallback = 1): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "");
    const match = /^(\d+(?:\.\d+)?)/.exec(cleaned);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round((parsed + Number.EPSILON) * 1000) / 1000;
      }
    }
  }
  return fallback;
}

/**
 * Computes a single line's amount from qty, rate and optional minimum_charge.
 * When minimum_charge > 0 and (qty * rate) < minimum_charge, minimum_charge wins.
 */
export function computeLineAmount(
  qty: number,
  rate: number,
  minimumCharge?: number | string | null,
): LineAmountResult {
  const safeQty = Number.isFinite(qty) && qty >= 0 ? qty : 0;
  const safeRate = Number.isFinite(rate) && rate >= 0 ? roundPaise(rate) : 0;
  const rawAmount = roundPaise(safeQty * safeRate);

  const parsedMin =
    minimumCharge !== null && minimumCharge !== undefined && minimumCharge !== ""
      ? roundPaise(Number(minimumCharge))
      : 0;
  const validMin = Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : null;

  if (validMin !== null && rawAmount < validMin) {
    return {
      qty: safeQty,
      rate: safeRate,
      raw_amount: rawAmount,
      minimum_charge: validMin,
      minimum_charge_applied: true,
      amount: validMin,
    };
  }

  return {
    qty: safeQty,
    rate: safeRate,
    raw_amount: rawAmount,
    minimum_charge: validMin,
    minimum_charge_applied: false,
    amount: rawAmount,
  };
}

/**
 * Extracts the `items` array from a report's `content` or an inspection's `readings` JSON object.
 */
export function extractReportItems(
  reportContent?: Record<string, unknown> | null,
  inspectionReadings?: Record<string, unknown> | null,
): ReportItemSource[] {
  const fromReport = Array.isArray(reportContent?.items) ? reportContent.items : null;
  const fromInspection = Array.isArray(inspectionReadings?.items) ? inspectionReadings.items : null;
  const rawList = (fromReport && fromReport.length > 0 ? fromReport : fromInspection) ?? [];

  const items: ReportItemSource[] = [];
  for (const entry of rawList) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const desc = typeof obj.description === "string" ? obj.description.trim() : "";
    const qty = obj.quantity as number | string | null | undefined;
    const obs = typeof obj.observations === "string" ? obj.observations.trim() : null;
    if (!desc && (qty === undefined || qty === null || qty === "")) continue;
    items.push({
      description: desc || "Inspected item",
      quantity: qty ?? 1,
      observations: obs,
    });
  }
  return items;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2 && !["the", "and", "for", "with", "per", "nos"].includes(w));
}

function similarityScore(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = new Set(tokenize(b));
  if (tokensA.length === 0 || tokensB.size === 0) return 0;
  let hits = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) hits += 1;
  }
  return hits / Math.max(tokensA.length, tokensB.size);
}

export interface BuildInvoiceLinesOptions {
  quotationItems?: QuotationItemSource[] | null;
  reportItems?: ReportItemSource[] | null;
  defaultSac?: string;
  fallbackDescription?: string | null;
}

/**
 * Builds prefilled invoice lines from an accepted quotation's items and an approved report's items.
 */
export function buildInvoiceLines(options: BuildInvoiceLinesOptions): BuiltInvoiceLine[] {
  const sac = (options.defaultSac ?? DEFAULT_SAC_CODE).trim();
  const quoteItems = [...(options.quotationItems ?? [])]
    .filter((q) => q && typeof q.description === "string" && q.description.trim().length > 0)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const repItems = (options.reportItems ?? []).filter(
    (r) => r && ((r.description && r.description.trim().length > 0) || r.quantity !== undefined),
  );

  // Case 1: Both quotation items and report items exist
  if (quoteItems.length > 0 && repItems.length > 0) {
    // Subcase 1a: Single quotation item with minimum_charge and multiple report items
    // Combine total report quantity if individual lines would fall under minimum_charge,
    // or pair each report item to best quotation item.
    if (quoteItems.length === 1 && repItems.length > 1) {
      const q = quoteItems[0];
      const rate = roundPaise(Number(q.rate) || 0);
      const minCharge = q.minimum_charge !== null && q.minimum_charge !== undefined ? roundPaise(Number(q.minimum_charge) || 0) : 0;
      const totalQty = repItems.reduce((sum, r) => sum + parseQuantity(r.quantity, 1), 0);
      const rawTotal = roundPaise(totalQty * rate);

      if (minCharge > 0 && rawTotal < minCharge) {
        const combinedDesc = `${q.description.trim()} (${repItems.map((r) => r.description?.trim()).filter(Boolean).join("; ")}) — Minimum charge applied`;
        const calc = computeLineAmount(totalQty, rate, minCharge);
        return [
          {
            position: 1,
            description: combinedDesc,
            sac,
            qty: calc.qty,
            unit: q.basis?.trim() || "nos",
            rate: calc.rate,
            amount: calc.amount,
            minimum_charge: calc.minimum_charge,
            minimum_charge_applied: calc.minimum_charge_applied,
          },
        ];
      }
    }

    // Match each report item to the best quotation item (by keyword overlap, then index)
    return repItems.map((rep, idx) => {
      let bestQuote = quoteItems[Math.min(idx, quoteItems.length - 1)];
      let bestScore = -1;
      for (const q of quoteItems) {
        const score = similarityScore(rep.description ?? "", q.description);
        if (score > bestScore) {
          bestScore = score;
          bestQuote = q;
        }
      }
      if (bestScore === 0 && quoteItems[idx]) {
        bestQuote = quoteItems[idx];
      }

      const qty = parseQuantity(rep.quantity, 1);
      const rate = roundPaise(Number(bestQuote.rate) || 0);
      const calc = computeLineAmount(qty, rate, bestQuote.minimum_charge);
      const repDesc = rep.description?.trim() || bestQuote.description.trim();
      const quoteDesc = bestQuote.description.trim();
      const baseDescription =
        repDesc.toLowerCase() === quoteDesc.toLowerCase()
          ? repDesc
          : `${quoteDesc} — ${repDesc}`;
      const description = calc.minimum_charge_applied
        ? `${baseDescription} (Minimum charge applied)`
        : baseDescription;

      return {
        position: idx + 1,
        description,
        sac,
        qty: calc.qty,
        unit: bestQuote.basis?.trim() || "nos",
        rate: calc.rate,
        amount: calc.amount,
        minimum_charge: calc.minimum_charge,
        minimum_charge_applied: calc.minimum_charge_applied,
      };
    });
  }

  // Case 2: Only quotation items exist (no report items yet)
  if (quoteItems.length > 0) {
    return quoteItems.map((q, idx) => {
      const rate = roundPaise(Number(q.rate) || 0);
      const calc = computeLineAmount(1, rate, q.minimum_charge);
      const baseDesc = q.description.trim();
      const description = calc.minimum_charge_applied
        ? `${baseDesc} (Minimum charge applied)`
        : baseDesc;

      return {
        position: idx + 1,
        description,
        sac,
        qty: calc.qty,
        unit: q.basis?.trim() || "nos",
        rate: calc.rate,
        amount: calc.amount,
        minimum_charge: calc.minimum_charge,
        minimum_charge_applied: calc.minimum_charge_applied,
      };
    });
  }

  // Case 3: Only report items exist (no quotation linked)
  if (repItems.length > 0) {
    return repItems.map((rep, idx) => {
      const qty = parseQuantity(rep.quantity, 1);
      return {
        position: idx + 1,
        description: rep.description?.trim() || `Inspected item ${idx + 1}`,
        sac,
        qty,
        unit: "nos",
        rate: 0,
        amount: 0,
        minimum_charge: null,
        minimum_charge_applied: false,
      };
    });
  }

  // Case 4: Fallback single line from job scope
  return [
    {
      position: 1,
      description: options.fallbackDescription?.trim() || "NDT Inspection & Testing Services",
      sac,
      qty: 1,
      unit: "job",
      rate: 0,
      amount: 0,
      minimum_charge: null,
      minimum_charge_applied: false,
    },
  ];
}

/**
 * Sums line amounts into the invoice's taxable value (rounded to exact paise).
 */
export function sumTaxableValue(lines: ReadonlyArray<{ amount: number | string | null | undefined }>): number {
  let sum = 0;
  for (const line of lines) {
    const val = Number(line.amount);
    if (Number.isFinite(val)) {
      sum = roundPaise(sum + val);
    }
  }
  return sum;
}
