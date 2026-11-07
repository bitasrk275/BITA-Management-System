import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIST } from "@/lib/dates";
import type { Database } from "@/lib/db/types";
import {
  buildGstExportReport,
  resolveGstExportPeriod,
  type GstExportInvoiceInput,
  type GstExportReport,
} from "@/lib/invoices";
import { invoicesTable } from "../db";

interface RawInvoiceForExport {
  id: string;
  kind: "tax_invoice" | "proforma";
  status: string;
  invoice_no: string | null;
  number: string | null;
  invoice_date: string | null;
  place_of_supply: string | null;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  round_off: number;
  total: number;
  jobs?: {
    customers?: {
      name: string;
      gstin: string | null;
      billing_address: string | null;
    } | null;
  } | null;
  invoice_lines?: Array<{ sac: string | null }> | null;
}

export async function loadGstExportData(
  supabase: SupabaseClient<Database>,
  params: { month?: string | null; from?: string | null; to?: string | null },
): Promise<{
  fromDate: string;
  toDate: string;
  month: string;
  report: GstExportReport;
}> {
  const { fromDate, toDate, month } = resolveGstExportPeriod(params, todayIST());

  const { data } = (await invoicesTable(supabase)
    .select(
      "id, kind, status, invoice_no, number, invoice_date, place_of_supply, taxable_value, cgst, sgst, igst, round_off, total, jobs(customers(name, gstin, billing_address)), invoice_lines(sac)",
    )
    .eq("kind", "tax_invoice")
    .in("status", ["issued", "partly_paid", "paid", "cancelled"])
    .gte("invoice_date", fromDate)
    .lte("invoice_date", toDate)
    .order("invoice_date", { ascending: true })) as { data: RawInvoiceForExport[] | null };

  const mapped: GstExportInvoiceInput[] = (data ?? []).map((inv) => ({
    id: inv.id,
    kind: inv.kind,
    status: inv.status,
    invoice_no: inv.invoice_no,
    number: inv.number,
    invoice_date: inv.invoice_date,
    place_of_supply: inv.place_of_supply,
    taxable_value: inv.taxable_value,
    cgst: inv.cgst,
    sgst: inv.sgst,
    igst: inv.igst,
    round_off: inv.round_off,
    total: inv.total,
    customer_name: inv.jobs?.customers?.name ?? "Customer",
    customer_gstin: inv.jobs?.customers?.gstin ?? null,
    customer_address: inv.jobs?.customers?.billing_address ?? null,
    lines: inv.invoice_lines ?? [],
  }));

  const report = buildGstExportReport(mapped, { fromDate, toDate });
  return { fromDate, toDate, month, report };
}
