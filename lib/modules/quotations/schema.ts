import { DEFAULT_QUOTATION_TERMS } from "../../../app/(office)/quotations/labels";
import { Constants, type Enums } from "../../db/types";

export interface QuotationItemInput {
  position: number;
  description: string;
  basis: string | null;
  rate: number | null;
  minimum_charge: number | null;
  notes: string | null;
}

export interface QuotationInput {
  ref_no: string | null;
  customer_id: string;
  enquiry_id: string | null;
  quote_date: string;
  attention: string | null;
  subject: string | null;
  terms: string;
  status?: Enums<"quotation_status">;
  items?: QuotationItemInput[];
}

function readStr(
  raw: FormData | Record<string, unknown>,
  key: string,
): string | null {
  const val = raw instanceof FormData ? raw.get(key) : raw[key];
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalNum(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseQuotationInput(
  raw: FormData | Record<string, unknown>,
): { ok: true; value: QuotationInput } | { ok: false; error: string } {
  const customerId = readStr(raw, "customer_id");
  if (!customerId) {
    return { ok: false, error: "Please choose a customer." };
  }

  const quoteDate =
    readStr(raw, "quote_date") ?? new Date().toISOString().slice(0, 10);
  const statusRaw = readStr(raw, "status");
  const validStatuses = Constants.public.Enums.quotation_status as readonly string[];
  const status: Enums<"quotation_status"> | undefined =
    statusRaw && validStatuses.includes(statusRaw)
      ? (statusRaw as Enums<"quotation_status">)
      : undefined;

  const items: QuotationItemInput[] = [];
  if (raw instanceof FormData) {
    const descriptions = raw.getAll("item_description");
    const bases = raw.getAll("item_basis");
    const rates = raw.getAll("item_rate");
    const minCharges = raw.getAll("item_minimum_charge");
    const itemNotes = raw.getAll("item_notes");

    for (let i = 0; i < descriptions.length; i += 1) {
      const descEntry = descriptions[i];
      const desc = typeof descEntry === "string" ? descEntry.trim() : "";
      if (!desc) continue;
      const basisEntry = bases[i];
      const noteEntry = itemNotes[i];
      items.push({
        position: items.length + 1,
        description: desc,
        basis:
          typeof basisEntry === "string" && basisEntry.trim()
            ? basisEntry.trim()
            : null,
        rate: parseOptionalNum(rates[i]),
        minimum_charge: parseOptionalNum(minCharges[i]),
        notes:
          typeof noteEntry === "string" && noteEntry.trim()
            ? noteEntry.trim()
            : null,
      });
    }
  } else if (Array.isArray(raw.items)) {
    for (const entry of raw.items) {
      if (!entry || typeof entry !== "object") continue;
      const itemObj = entry as Record<string, unknown>;
      const desc =
        typeof itemObj.description === "string"
          ? itemObj.description.trim()
          : "";
      if (!desc) continue;
      items.push({
        position:
          typeof itemObj.position === "number" && itemObj.position > 0
            ? Math.trunc(itemObj.position)
            : items.length + 1,
        description: desc,
        basis:
          typeof itemObj.basis === "string" && itemObj.basis.trim()
            ? itemObj.basis.trim()
            : null,
        rate: parseOptionalNum(itemObj.rate),
        minimum_charge: parseOptionalNum(itemObj.minimum_charge),
        notes:
          typeof itemObj.notes === "string" && itemObj.notes.trim()
            ? itemObj.notes.trim()
            : null,
      });
    }
  }

  return {
    ok: true,
    value: {
      ref_no: readStr(raw, "ref_no"),
      customer_id: customerId,
      enquiry_id: readStr(raw, "enquiry_id"),
      quote_date: quoteDate,
      attention: readStr(raw, "attention"),
      subject: readStr(raw, "subject"),
      terms: readStr(raw, "terms") ?? DEFAULT_QUOTATION_TERMS,
      ...(status ? { status } : {}),
      items,
    },
  };
}
