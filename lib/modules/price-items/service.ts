import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../db/types";
import { computeLineAmount, type BuiltInvoiceLine } from "../../invoices";
import { restoreRecord, softDeleteRecord } from "../recycle-bin/service";
import type { PriceItemInput } from "./schema";

export type PriceItemRow = Tables<"price_items">;

export async function listPriceItems(
  supabase: SupabaseClient<Database>,
  opts?: { activeOnly?: boolean; search?: string | null },
): Promise<{ data: PriceItemRow[]; error: string | null }> {
  let query = supabase
    .from("price_items")
    .select("*")
    .order("name", { ascending: true });

  if (opts?.activeOnly) {
    query = query.eq("active", true);
  }

  const q = opts?.search?.replace(/[,()%*]/g, " ").trim();
  if (q) {
    query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%,sac.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return { data: [], error: error.message };
  }
  return { data: data ?? [], error: null };
}

export async function getPriceItemById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: PriceItemRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("price_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data, error: null };
}

export async function createPriceItem(
  supabase: SupabaseClient<Database>,
  input: PriceItemInput,
): Promise<{ data: PriceItemRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("price_items")
    .insert({
      name: input.name,
      description: input.description,
      sac: input.sac,
      unit: input.unit,
      default_rate: input.default_rate,
      active: input.active,
    })
    .select("*")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data, error: null };
}

export async function updatePriceItem(
  supabase: SupabaseClient<Database>,
  id: string,
  input: PriceItemInput,
): Promise<{ data: PriceItemRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("price_items")
    .update({
      name: input.name,
      description: input.description,
      sac: input.sac,
      unit: input.unit,
      default_rate: input.default_rate,
      active: input.active,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data, error: null };
}

export async function softDeletePriceItem(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return softDeleteRecord(supabase, "price_items", id);
}

export async function restorePriceItem(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return restoreRecord(supabase, "price_items", id);
}

const METHOD_PRICE_KEYWORDS: Record<string, string[]> = {
  UT: ["ut service", "ultrasonic"],
  MPT: ["mt service", "mpt", "magnetic particle"],
  DPT: ["dpt service", "dye penetrant", "liquid penetrant"],
  RT: ["rt service", "radiographic"],
  VT: ["visual inspection", "vt service"],
  hardness: ["hardness testing", "hardness"],
};

/**
 * Replaces pulling invoice rates from quotations (Phase 2 Map Change 3 / P3).
 * Builds initial draft invoice lines by matching the report/job method against BITA's price list,
 * copying the description, SAC, unit, and default rate onto the draft invoice so the office can
 * pick from the price list dropdown and edit rates per invoice.
 */
export function buildDraftInvoiceLinesFromPriceList(params: {
  priceItems: Array<{
    id: string;
    name: string;
    description: string | null;
    sac: string | null;
    unit: string;
    default_rate: number;
  }>;
  method?: string | null;
  reportNo?: string | null;
  fallbackDescription?: string | null;
}): BuiltInvoiceLine[] {
  const { priceItems, method, reportNo, fallbackDescription } = params;

  let matchedItem: (typeof priceItems)[number] | undefined;
  if (method) {
    const keywords = METHOD_PRICE_KEYWORDS[method] ?? [method.toLowerCase()];
    matchedItem = priceItems.find((item) => {
      const hay = `${item.name} ${item.description ?? ""}`.toLowerCase();
      return keywords.some((kw) => hay.includes(kw));
    });
  }

  if (matchedItem) {
    const baseDesc = matchedItem.description?.trim() || matchedItem.name.trim();
    const desc = reportNo ? `${baseDesc} (Report ${reportNo})` : baseDesc;
    const rate = Number(matchedItem.default_rate) || 0;
    const calc = computeLineAmount(1, rate, null);
    return [
      {
        position: 1,
        description: desc,
        sac: matchedItem.sac ?? "",
        qty: calc.qty,
        unit: matchedItem.unit || "nos",
        rate: calc.rate,
        amount: calc.amount,
        minimum_charge: null,
        minimum_charge_applied: false,
      },
    ];
  }

  const firstItem = priceItems[0];
  const defaultDesc =
    fallbackDescription?.trim() ||
    (reportNo ? `Inspection services (Report ${reportNo})` : "NDT Inspection Services");
  const defaultRate = firstItem ? Number(firstItem.default_rate) || 0 : 0;
  const calc = computeLineAmount(1, defaultRate, null);

  return [
    {
      position: 1,
      description: defaultDesc,
      sac: firstItem?.sac ?? "",
      qty: calc.qty,
      unit: firstItem?.unit || "nos",
      rate: calc.rate,
      amount: calc.amount,
      minimum_charge: null,
      minimum_charge_applied: false,
    },
  ];
}
