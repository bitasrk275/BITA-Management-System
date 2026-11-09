import { roundPaise } from "../../invoices";
import { validUuid } from "../../reports/review";

export interface CreateInvoiceFromReportsInput {
  report_ids: string[];
  kind?: "tax_invoice" | "proforma";
  notes?: string | null;
}

export function parseCreateInvoiceFromReportsInput(
  raw: unknown,
): { ok: true; value: CreateInvoiceFromReportsInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request payload." };
  }
  const obj = raw as Record<string, unknown>;
  const rawIds = Array.isArray(obj.report_ids) ? obj.report_ids : [];
  const reportIds = rawIds
    .map((v) => String(v ?? "").trim())
    .filter((id) => validUuid(id));

  if (reportIds.length === 0) {
    return { ok: false, error: "Select at least one approved report." };
  }

  const kindRaw = obj.kind;
  const kind = kindRaw === "proforma" ? "proforma" : "tax_invoice";
  const notes =
    typeof obj.notes === "string" && obj.notes.trim().length > 0
      ? obj.notes.trim().slice(0, 2000)
      : null;

  return {
    ok: true,
    value: {
      report_ids: reportIds,
      kind,
      notes,
    },
  };
}

export interface RecordPaymentInput {
  amount: number;
  tds_amount: number;
  total_settled: number;
  paid_on: string;
  mode: string;
  reference: string | null;
}

export function parseRecordPaymentInput(
  raw: unknown,
  defaultDate: string,
): { ok: true; value: RecordPaymentInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid payment payload." };
  }
  const obj = raw as Record<string, unknown>;
  const amountNum = Number(obj.amount ?? 0);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return { ok: false, error: "Amount received must be greater than zero." };
  }

  const tdsRaw = obj.tds_amount;
  const tdsNum =
    tdsRaw === null || tdsRaw === undefined || String(tdsRaw).trim() === ""
      ? 0
      : Number(tdsRaw);
  if (!Number.isFinite(tdsNum) || tdsNum < 0) {
    return { ok: false, error: "TDS deducted cannot be negative." };
  }

  const amount = roundPaise(amountNum);
  const tds_amount = roundPaise(tdsNum);
  const total_settled = roundPaise(amount + tds_amount);

  const paidOn =
    typeof obj.paid_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.paid_on.trim())
      ? obj.paid_on.trim()
      : defaultDate;
  const mode =
    typeof obj.mode === "string" && obj.mode.trim().length > 0
      ? obj.mode.trim()
      : "NEFT";
  const reference =
    typeof obj.reference === "string" && obj.reference.trim().length > 0
      ? obj.reference.trim().slice(0, 200)
      : null;

  return {
    ok: true,
    value: {
      amount,
      tds_amount,
      total_settled,
      paid_on: paidOn,
      mode,
      reference,
    },
  };
}

export interface CreateCreditNoteInput {
  invoice_id: string;
  reason: string;
  taxable_value: number;
  credit_date: string;
  notes: string | null;
  issue_immediately: boolean;
}

export function parseCreateCreditNoteInput(
  raw: unknown,
  defaultDate: string,
): { ok: true; value: CreateCreditNoteInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid credit note payload." };
  }
  const obj = raw as Record<string, unknown>;
  const invoiceId = String(obj.invoice_id ?? "").trim();
  if (!validUuid(invoiceId)) {
    return { ok: false, error: "Valid target invoice ID is required." };
  }

  const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  if (!reason) {
    return { ok: false, error: "Credit note reason is required." };
  }

  const taxableNum = Number(obj.taxable_value ?? 0);
  if (!Number.isFinite(taxableNum) || taxableNum <= 0) {
    return { ok: false, error: "Credit note taxable value must be greater than zero." };
  }

  const creditDate =
    typeof obj.credit_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.credit_date.trim())
      ? obj.credit_date.trim()
      : defaultDate;

  const notes =
    typeof obj.notes === "string" && obj.notes.trim().length > 0
      ? obj.notes.trim().slice(0, 2000)
      : null;

  const issueImmediately =
    obj.issue_immediately === undefined
      ? true
      : Boolean(
          obj.issue_immediately === true ||
            obj.issue_immediately === "true" ||
            obj.issue_immediately === "1" ||
            obj.issue_immediately === "on",
        );

  return {
    ok: true,
    value: {
      invoice_id: invoiceId,
      reason: reason.slice(0, 500),
      taxable_value: roundPaise(taxableNum),
      credit_date: creditDate,
      notes,
      issue_immediately: issueImmediately,
    },
  };
}
