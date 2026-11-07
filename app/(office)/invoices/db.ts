// Typed database helpers for the reshaped invoices, invoice_lines and payments tables (T35).
// Works seamlessly whether lib/db/types.ts has the pre-T35 or post-T35 generated types.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export type InvoiceStatus = "draft" | "issued" | "partly_paid" | "paid" | "cancelled";

export interface InvoiceRow {
  id: string;
  job_id: string;
  kind: "proforma" | "tax_invoice";
  zoho_id: string | null; // legacy mirror id (kept per D-017 / schema)
  number: string | null;
  invoice_no: string | null;
  report_id: string | null;
  quotation_id: string | null;
  place_of_supply: string | null;
  invoice_date: string | null;
  due_date: string | null;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  round_off: number;
  total: number;
  balance: number;
  status: InvoiceStatus | string;
  issued_at: string | null;
  pdf_path: string | null;
  notes: string | null;
  customer_po_number: string | null;
  converted_from_id?: string | null;
  reminders_paused: boolean;
  created_at: string;
}

export interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  sac: string;
  qty: number;
  unit: string | null;
  rate: number;
  amount: number;
}

export interface PaymentRow {
  id: string;
  invoice_id: string;
  amount: number;
  paid_on: string;
  mode: string | null;
  reference: string | null;
  created_at: string;
}

export interface PaymentReminderRow {
  id: string;
  invoice_id: string;
  kind: "before_due" | "on_due" | "overdue" | string;
  scheduled_for: string;
  sent_at: string | null;
  from_mailbox: string | null;
  sent_to: string[];
}

export interface InvoiceWithRelations extends InvoiceRow {
  jobs?: {
    id: string;
    job_no: string;
    po_number: string | null;
    po_date: string | null;
    po_value?: number | null;
    scope: string | null;
    status: string;
    customer_id: string;
    quotation_id: string | null;
    customers?: {
      id: string;
      name: string;
      code: string | null;
      gstin: string | null;
      billing_address: string | null;
      payment_terms_days: number;
    } | null;
  } | null;
  reports?: {
    id: string;
    report_no: string;
    method: string;
    status: string;
  } | null;
  invoice_reports?: Array<{
    report_id: string;
    reports?: {
      id: string;
      report_no: string;
      method: string;
      status: string;
      job_id?: string;
      jobs?: {
        id: string;
        job_no: string;
        po_number: string | null;
      } | null;
    } | null;
  }> | null;
  quotations?: {
    id: string;
    ref_no: string | null;
    status: string;
  } | null;
}

// Untyped table accessor for columns added in 20261106040000_invoices_in_app.sql
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function invoicesTable(supabase: SupabaseClient<Database>): any {
  return supabase.from("invoices" as never);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function invoiceLinesTable(supabase: SupabaseClient<Database>): any {
  return supabase.from("invoice_lines" as never);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function paymentsTable(supabase: SupabaseClient<Database>): any {
  return supabase.from("payments" as never);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function paymentRemindersTable(supabase: SupabaseClient<Database>): any {
  return supabase.from("payment_reminders" as never);
}
