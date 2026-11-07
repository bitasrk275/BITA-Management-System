import { checked, text } from "../../forms";
import { roundPaise } from "../../invoices";

export type PriceItemInput = {
  name: string;
  description: string | null;
  sac: string | null;
  unit: string;
  default_rate: number;
  active: boolean;
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
  defaultValue = true,
): boolean {
  if (isFormData(raw)) {
    if (!raw.has(key)) return defaultValue;
    return checked(raw, key);
  }
  const val = raw[key];
  if (val === undefined) return defaultValue;
  return val === true || val === "true" || val === "on" || val === "1" || val === 1;
}

export function parsePriceItemInput(
  raw: FormData | Record<string, unknown>,
): { ok: true; value: PriceItemInput } | { ok: false; error: string } {
  const name = readString(raw, "name");
  if (!name) {
    return { ok: false, error: "Price item name is required." };
  }

  let rawRate: unknown;
  if (isFormData(raw)) {
    rawRate = text(raw, "default_rate");
  } else {
    rawRate = raw.default_rate;
  }

  const rateNum = rawRate === null || rawRate === undefined || rawRate === "" ? 0 : Number(rawRate);
  if (!Number.isFinite(rateNum) || rateNum < 0) {
    return { ok: false, error: "Default rate must be a non-negative amount." };
  }

  const description = readString(raw, "description");
  const sac = readString(raw, "sac");
  const unit = readString(raw, "unit") ?? "nos";
  const active = readBoolean(raw, "active", true);

  return {
    ok: true,
    value: {
      name,
      description,
      sac,
      unit,
      default_rate: roundPaise(rateNum),
      active,
    },
  };
}
