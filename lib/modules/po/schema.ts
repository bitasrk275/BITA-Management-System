import { checked, text } from "../../forms";
import { roundPaise } from "../../invoices";

export type PoFieldsInput = {
  po_number: string | null;
  po_date: string | null;
  po_value: number | null;
};

export type AcceptQuotationInput = PoFieldsInput & {
  create_job: boolean;
  site: string | null;
  scope: string | null;
};

export type PoValueCheck = {
  poNumber: string | null;
  poValue: number | null;
  otherInvoicesTotal: number;
  currentInvoiceTotal: number;
  totalInvoicedAgainstPo: number;
  exceedsPoValue: boolean;
  exceededBy: number;
  warningMessage: string | null;
};

function isFormData(input: unknown): input is FormData {
  return typeof FormData !== "undefined" && input instanceof FormData;
}

function readString(raw: FormData | Record<string, unknown>, key: string): string | null {
  if (isFormData(raw)) {
    return text(raw, key);
  }
  const val = raw[key];
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(
  raw: FormData | Record<string, unknown>,
  key: string,
  defaultValue = false,
): boolean {
  if (isFormData(raw)) {
    if (!raw.has(key)) return defaultValue;
    return checked(raw, key);
  }
  const val = raw[key];
  if (val === undefined) return defaultValue;
  return val === true || val === "true" || val === "on" || val === "1" || val === 1;
}

export function parsePoValue(
  raw: FormData | Record<string, unknown>,
  key = "po_value",
): { ok: true; value: number | null } | { ok: false; error: string } {
  let rawVal: unknown;
  if (isFormData(raw)) {
    rawVal = text(raw, key);
  } else {
    rawVal = raw[key];
  }

  if (rawVal === null || rawVal === undefined || rawVal === "") {
    return { ok: true, value: null };
  }

  const num = Number(rawVal);
  if (!Number.isFinite(num) || num < 0) {
    return { ok: false, error: "PO value must be a non-negative amount." };
  }

  return { ok: true, value: roundPaise(num) };
}

export function parsePoFieldsInput(
  raw: FormData | Record<string, unknown>,
): { ok: true; value: PoFieldsInput } | { ok: false; error: string } {
  const poValueRes = parsePoValue(raw, "po_value");
  if (!poValueRes.ok) return poValueRes;

  const poDate = readString(raw, "po_date");
  if (poDate && !/^\d{4}-\d{2}-\d{2}$/.test(poDate)) {
    return { ok: false, error: "PO date must be in YYYY-MM-DD format." };
  }

  return {
    ok: true,
    value: {
      po_number: readString(raw, "po_number"),
      po_date: poDate,
      po_value: poValueRes.value,
    },
  };
}

export function parseAcceptQuotationInput(
  raw?: FormData | Record<string, unknown> | null,
): { ok: true; value: AcceptQuotationInput } | { ok: false; error: string } {
  if (!raw) {
    return {
      ok: true,
      value: {
        po_number: null,
        po_date: null,
        po_value: null,
        create_job: false,
        site: null,
        scope: null,
      },
    };
  }

  const poRes = parsePoFieldsInput(raw);
  if (!poRes.ok) return poRes;

  return {
    ok: true,
    value: {
      ...poRes.value,
      create_job: readBoolean(raw, "create_job", false),
      site: readString(raw, "site"),
      scope: readString(raw, "scope"),
    },
  };
}

function formatAmountINR(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function evaluatePoValueWarning(params: {
  poNumber?: string | null;
  poValue?: number | null;
  otherInvoicesTotal?: number | null;
  currentInvoiceTotal?: number | null;
}): PoValueCheck {
  const poNumber = params.poNumber?.trim() || null;
  const poValue =
    params.poValue !== null && params.poValue !== undefined && Number.isFinite(Number(params.poValue))
      ? roundPaise(Number(params.poValue))
      : null;
  const otherInvoicesTotal = roundPaise(Math.max(0, Number(params.otherInvoicesTotal) || 0));
  const currentInvoiceTotal = roundPaise(Math.max(0, Number(params.currentInvoiceTotal) || 0));
  const totalInvoicedAgainstPo = roundPaise(otherInvoicesTotal + currentInvoiceTotal);

  if (poValue === null || poValue <= 0) {
    return {
      poNumber,
      poValue,
      otherInvoicesTotal,
      currentInvoiceTotal,
      totalInvoicedAgainstPo,
      exceedsPoValue: false,
      exceededBy: 0,
      warningMessage: null,
    };
  }

  const exceededBy =
    totalInvoicedAgainstPo > poValue ? roundPaise(totalInvoicedAgainstPo - poValue) : 0;
  const exceedsPoValue = exceededBy > 0;
  const poLabel = poNumber ? `PO ${poNumber}` : "this PO";

  const warningMessage = exceedsPoValue
    ? `Invoices against ${poLabel} total ${formatAmountINR(totalInvoicedAgainstPo)}, which exceeds the PO value of ${formatAmountINR(poValue)} by ${formatAmountINR(exceededBy)}.`
    : null;

  return {
    poNumber,
    poValue,
    otherInvoicesTotal,
    currentInvoiceTotal,
    totalInvoicedAgainstPo,
    exceedsPoValue,
    exceededBy,
    warningMessage,
  };
}
