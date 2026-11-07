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
