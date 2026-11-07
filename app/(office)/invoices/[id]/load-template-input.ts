import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { InvoiceTemplateInput } from "@/lib/invoices";
import {
  invoiceLinesTable,
  invoicesTable,
  type InvoiceLineRow,
  type InvoiceWithRelations,
} from "../db";

export async function loadInvoiceTemplateInput(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
): Promise<{ input: InvoiceTemplateInput; filenameBase: string } | null> {
  const [invoiceRes, linesRes] = await Promise.all([
    invoicesTable(supabase)
      .select(
        "*, jobs(id, job_no, po_number, po_date, scope, status, customer_id, quotation_id, customers(id, name, code, gstin, billing_address, payment_terms_days)), reports(id, report_no, method, status), quotations(id, ref_no, status)",
      )
      .eq("id", invoiceId)
      .maybeSingle() as Promise<{ data: InvoiceWithRelations | null }>,
    invoiceLinesTable(supabase)
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("position", { ascending: true }) as Promise<{ data: InvoiceLineRow[] | null }>,
  ]);

  const invoice = invoiceRes.data;
  if (!invoice) return null;

  const lines = linesRes.data ?? [];
  const job = invoice.jobs;
  const customer = job?.customers;
  const report = invoice.reports;
  const quotation = invoice.quotations;

  const rawNo = invoice.invoice_no ?? invoice.number ?? `DRAFT-${invoice.id.slice(0, 8)}`;
  const filenameBase = rawNo.replace(/[^a-zA-Z0-9_-]/g, "_");

  const input: InvoiceTemplateInput = {
    kind: invoice.kind,
    status: invoice.status,
    invoiceNo: invoice.invoice_no ?? invoice.number,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    jobNo: job?.job_no,
    reportNo: report?.report_no,
    quotationRef: quotation?.ref_no,
    poNumber: invoice.customer_po_number ?? job?.po_number,
    poDate: job?.po_date,
    customerName: customer?.name ?? "Customer",
    customerAddress: customer?.billing_address,
    customerGstin: customer?.gstin,
    placeOfSupply: invoice.place_of_supply,
    lines: lines.map((l) => ({
      position: l.position,
      description: l.description,
      sac: l.sac,
      qty: Number(l.qty) || 1,
      unit: l.unit,
      rate: Number(l.rate) || 0,
      amount: Number(l.amount) || 0,
    })),
    taxableValue: Number(invoice.taxable_value) || 0,
    cgst: Number(invoice.cgst) || 0,
    sgst: Number(invoice.sgst) || 0,
    igst: Number(invoice.igst) || 0,
    roundOff: Number(invoice.round_off) || 0,
    total: Number(invoice.total) || 0,
    notes: invoice.notes,
  };

  return { input, filenameBase };
}
