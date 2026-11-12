import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { BitaInvoiceProfile, InvoiceTemplateInput } from "@/lib/invoices";
import { downloadBrandingImageDataUrl } from "@/lib/reports/branding.server";
import {
  invoiceLinesTable,
  invoicesTable,
  type InvoiceLineRow,
  type InvoiceWithRelations,
} from "../db";

export async function loadBitaInvoiceProfile(
  supabase: SupabaseClient<Database>,
): Promise<Partial<BitaInvoiceProfile> | undefined> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "company_profile")
    .maybeSingle();
  if (!data?.value || typeof data.value !== "object" || Array.isArray(data.value)) {
    return undefined;
  }
  const v = data.value as Record<string, unknown>;
  const profile: Partial<BitaInvoiceProfile> = {};
  if (typeof v.name === "string" && v.name.trim()) profile.name = v.name.trim();
  if (typeof v.subtitle === "string" && v.subtitle.trim()) profile.subtitle = v.subtitle.trim();
  if (typeof v.address === "string" && v.address.trim()) profile.address = v.address.trim();
  if (typeof v.phone === "string" && v.phone.trim()) profile.phone = v.phone.trim();
  if (typeof v.email === "string" && v.email.trim()) profile.email = v.email.trim();
  if (typeof v.pan === "string" && v.pan.trim()) profile.pan = v.pan.trim();
  if (typeof v.gstin === "string" && v.gstin.trim()) profile.gstin = v.gstin.trim();
  const sac =
    typeof v.defaultSac === "string" && v.defaultSac.trim()
      ? v.defaultSac.trim()
      : typeof v.default_sac === "string" && v.default_sac.trim()
        ? v.default_sac.trim()
        : "";
  if (sac) profile.defaultSac = sac;
  if (typeof v.bankDetails === "string" && v.bankDetails.trim()) {
    profile.bankDetailsPlaceholder = v.bankDetails.trim();
  } else if (
    typeof v.bank_name === "string" &&
    v.bank_name.trim()
  ) {
    const parts = [
      `${v.bank_name.trim()}${typeof v.bank_branch === "string" && v.bank_branch.trim() ? `, ${v.bank_branch.trim()}` : ""}`,
      typeof v.bank_account_no === "string" && v.bank_account_no.trim()
        ? `A/C No. : ${v.bank_account_no.trim()}`
        : "",
      typeof v.bank_ifsc === "string" && v.bank_ifsc.trim()
        ? `IFSC Code: ${v.bank_ifsc.trim()}`
        : "",
    ].filter(Boolean);
    profile.bankDetailsPlaceholder = parts.join(" · ");
  }
  if (typeof v.terms === "string" && v.terms.trim()) {
    profile.termsPlaceholder = v.terms.trim();
  }

  const logoPath =
    typeof v.logo_path === "string" && v.logo_path.trim()
      ? v.logo_path.trim()
      : undefined;
  if (logoPath) {
    const url = await downloadBrandingImageDataUrl(supabase, logoPath);
    if (url) profile.logoUrl = url;
  }

  const sealPath =
    typeof v.seal_path === "string" && v.seal_path.trim()
      ? v.seal_path.trim()
      : undefined;
  if (sealPath) {
    const url = await downloadBrandingImageDataUrl(supabase, sealPath);
    if (url) profile.sealUrl = url;
  }

  return profile;
}

export async function loadInvoiceTemplateInput(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
): Promise<{ input: InvoiceTemplateInput; filenameBase: string } | null> {
  const [invoiceRes, linesRes, profile] = await Promise.all([
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
    loadBitaInvoiceProfile(supabase),
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
    profile,
  };

  return { input, filenameBase };
}
