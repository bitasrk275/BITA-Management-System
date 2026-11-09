import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIST } from "@/lib/dates";
import type { Database } from "@/lib/db/types";
import {
  buildGstExportReport,
  resolveGstExportPeriod,
  type GstExportCreditNoteInput,
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
  payments?: Array<{ tds_amount: number | null }> | null;
}

interface RawCreditNoteForExport {
  id: string;
  credit_note_no: string;
  issued_on: string;
  amount: number;
  gst_amount: number;
  total: number;
  reason: string | null;
  invoices?: {
    invoice_no: string | null;
    number: string | null;
    invoice_date: string | null;
    place_of_supply: string | null;
    jobs?: {
      customers?: {
        name: string;
        gstin: string | null;
      } | null;
    } | null;
  } | null;
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

  const [{ data }, { data: cnData }] = await Promise.all([
    invoicesTable(supabase)
      .select(
        "id, kind, status, invoice_no, number, invoice_date, place_of_supply, taxable_value, cgst, sgst, igst, round_off, total, jobs(customers(name, gstin, billing_address)), invoice_lines(sac), payments(tds_amount)",
      )
      .eq("kind", "tax_invoice")
      .in("status", ["issued", "partly_paid", "paid", "cancelled"])
      .gte("invoice_date", fromDate)
      .lte("invoice_date", toDate)
      .order("invoice_date", { ascending: true }) as unknown as Promise<{
      data: RawInvoiceForExport[] | null;
    }>,
    supabase
      .from("credit_notes")
      .select(
        "id, credit_note_no, issued_on, amount, gst_amount, total, reason, invoices(invoice_no, number, invoice_date, place_of_supply, jobs(customers(name, gstin)))",
      )
      .is("deleted_at", null)
      .gte("issued_on", fromDate)
      .lte("issued_on", toDate)
      .order("issued_on", { ascending: true }) as unknown as Promise<{
      data: RawCreditNoteForExport[] | null;
    }>,
  ]);

  const mapped: GstExportInvoiceInput[] = (data ?? []).map((inv) => {
    const tdsSum = (inv.payments ?? []).reduce(
      (sum, p) => sum + (Number(p?.tds_amount) || 0),
      0,
    );
    return {
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
      tds_deducted: tdsSum,
    };
  });

  const mappedCn: GstExportCreditNoteInput[] = (cnData ?? []).map((cn) => ({
    id: cn.id,
    credit_note_no: cn.credit_note_no,
    issued_on: cn.issued_on,
    invoice_no: cn.invoices?.invoice_no ?? cn.invoices?.number ?? "",
    invoice_date: cn.invoices?.invoice_date ?? "",
    place_of_supply: cn.invoices?.place_of_supply ?? null,
    customer_name: cn.invoices?.jobs?.customers?.name ?? "Customer",
    customer_gstin: cn.invoices?.jobs?.customers?.gstin ?? null,
    reason: cn.reason,
    amount: cn.amount,
    gst_amount: cn.gst_amount,
    total: cn.total,
  }));

  const report = buildGstExportReport(mapped, {
    fromDate,
    toDate,
    creditNotes: mappedCn,
  });
  return { fromDate, toDate, month, report };
}
