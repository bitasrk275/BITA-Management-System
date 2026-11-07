import { checked, text } from "../../forms";

export type CustomerInput = {
  name: string;
  code: string | null;
  gstin: string | null;
  billing_address: string | null;
  uses_proforma: boolean;
  payment_terms_days: number;
  mailbox: string | null;
  notes: string | null;
};

export type ContactInput = {
  name: string;
  mobile: string | null;
  email: string | null;
  notes: string | null;
  receives_reports: boolean;
  receives_invoices: boolean;
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

function readBoolean(raw: FormData | Record<string, unknown>, key: string): boolean {
  if (isFormData(raw)) {
    return checked(raw, key);
  }
  const val = raw[key];
  return val === true || val === "true" || val === "on" || val === "1" || val === 1;
}

export function sanitizeCustomerSearchTerm(q?: string | null): string {
  if (!q) return "";
  // Commas and brackets have meaning in PostgREST filter syntax, so drop them.
  return q.replace(/[,()%*]/g, " ").trim();
}

export function parseCustomerInput(
  raw: FormData | Record<string, unknown>,
): { ok: true; value: CustomerInput } | { ok: false; error: string } {
  const name = readString(raw, "name");
  if (!name) {
    return { ok: false, error: "Customer name is required." };
  }

  const code = readString(raw, "code")?.toUpperCase() ?? null;
  const gstin = readString(raw, "gstin")?.toUpperCase() ?? null;
  const billingAddress = readString(raw, "billing_address");
  const usesProforma = readBoolean(raw, "uses_proforma");

  let rawDays: unknown;
  if (isFormData(raw)) {
    rawDays = text(raw, "payment_terms_days");
  } else {
    rawDays = raw.payment_terms_days;
  }

  const paymentTermsDays =
    rawDays === null || rawDays === undefined || rawDays === ""
      ? 30
      : Number(rawDays);

  if (!Number.isFinite(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) {
    return { ok: false, error: "Payment terms must be between 0 and 365 days." };
  }

  return {
    ok: true,
    value: {
      name,
      code,
      gstin,
      billing_address: billingAddress,
      uses_proforma: usesProforma,
      payment_terms_days: Math.trunc(paymentTermsDays),
      mailbox: readString(raw, "mailbox"),
      notes: readString(raw, "notes"),
    },
  };
}

export function parseContactInput(
  raw: FormData | Record<string, unknown>,
): { ok: true; value: ContactInput } | { ok: false; error: string } {
  const name = readString(raw, "name");
  if (!name) {
    return { ok: false, error: "Contact name is required." };
  }

  return {
    ok: true,
    value: {
      name,
      mobile: readString(raw, "mobile"),
      email: readString(raw, "email"),
      notes: readString(raw, "notes"),
      receives_reports: readBoolean(raw, "receives_reports"),
      receives_invoices: readBoolean(raw, "receives_invoices"),
    },
  };
}
