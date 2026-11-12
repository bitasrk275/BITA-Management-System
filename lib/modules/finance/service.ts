import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIST } from "../../dates";
import type { Database } from "../../db/types";
import {
  classifyAgeingBucket,
  diffDaysBetweenDates,
  formatMonthLabel,
  parseFinanceMonth,
  parseFinancialYearRange,
  round2,
  type AgeingInvoiceDetail,
  type CustomerAgeingRow,
  type CustomerRevenueReport,
  type CustomerRevenueRow,
  type FinanceOverview,
  type MonthlyIncomeExpenseRow,
  type MonthlyIncomeVsExpensesReport,
  type MonthlyPaymentRow,
  type MonthlyPaymentsReport,
  type ReceivablesAgeingReport,
  type UnconvertedProformaRow,
  type UnconvertedProformasReport,
} from "./schema";

type AppSupabase = SupabaseClient<Database>;

export interface RawFinanceInvoiceRow {
  id: string;
  job_id: string;
  job_no: string;
  customer_id: string;
  customer_name: string;
  customer_gstin: string | null;
  kind: "proforma" | "tax_invoice";
  status: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  customer_po_number: string | null;
  converted_from_id: string | null;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  balance: number;
}

export interface RawFinancePaymentRow {
  id: string;
  invoice_id: string;
  amount: number;
  tds_amount: number;
  paid_on: string;
  mode: string | null;
  reference: string | null;
}

export interface RawFinanceCreditNoteRow {
  id: string;
  invoice_id: string;
  credit_note_no: string | null;
  credit_date: string;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  status: string;
}

export interface RawFinanceExpenseRow {
  id: string;
  job_id: string;
  expense_date: string;
  kind: string;
  amount: number;
}

export interface RawFinanceDataset {
  invoices: RawFinanceInvoiceRow[];
  payments: RawFinancePaymentRow[];
  creditNotes: RawFinanceCreditNoteRow[];
  expenses: RawFinanceExpenseRow[];
}

function computeInvoiceSettlements(
  invoice: RawFinanceInvoiceRow,
  paymentsByInvoice: Map<string, RawFinancePaymentRow[]>,
  creditNotesByInvoice: Map<string, RawFinanceCreditNoteRow[]>,
): {
  paid_amount: number;
  tds_amount: number;
  credit_notes_taxable: number;
  credit_notes_total: number;
  net_balance: number;
} {
  const pmts = paymentsByInvoice.get(invoice.id) ?? [];
  const cns = (creditNotesByInvoice.get(invoice.id) ?? []).filter(
    (cn) => cn.status === "issued",
  );

  const paid_amount = round2(
    pmts.reduce((acc, p) => acc + Number(p.amount ?? 0), 0),
  );
  const tds_amount = round2(
    pmts.reduce((acc, p) => acc + Number(p.tds_amount ?? 0), 0),
  );
  const credit_notes_taxable = round2(
    cns.reduce((acc, cn) => acc + Number(cn.taxable_value ?? 0), 0),
  );
  const credit_notes_total = round2(
    cns.reduce((acc, cn) => acc + Number(cn.total ?? 0), 0),
  );

  const settled = round2(paid_amount + tds_amount + credit_notes_total);
  let net_balance = round2(Math.max(0, Number(invoice.total ?? 0) - settled));
  if (
    invoice.status === "cancelled" ||
    (invoice.status === "paid" && settled === 0 && Number(invoice.balance ?? 0) === 0)
  ) {
    net_balance = 0;
  }

  return {
    paid_amount,
    tds_amount,
    credit_notes_taxable,
    credit_notes_total,
    net_balance,
  };
}

function buildSettlementMaps(
  payments: readonly RawFinancePaymentRow[],
  creditNotes: readonly RawFinanceCreditNoteRow[],
): {
  paymentsByInvoice: Map<string, RawFinancePaymentRow[]>;
  creditNotesByInvoice: Map<string, RawFinanceCreditNoteRow[]>;
} {
  const paymentsByInvoice = new Map<string, RawFinancePaymentRow[]>();
  for (const p of payments) {
    const arr = paymentsByInvoice.get(p.invoice_id) ?? [];
    arr.push(p);
    paymentsByInvoice.set(p.invoice_id, arr);
  }

  const creditNotesByInvoice = new Map<string, RawFinanceCreditNoteRow[]>();
  for (const cn of creditNotes) {
    const arr = creditNotesByInvoice.get(cn.invoice_id) ?? [];
    arr.push(cn);
    creditNotesByInvoice.set(cn.invoice_id, arr);
  }

  return { paymentsByInvoice, creditNotesByInvoice };
}

/**
 * (a) Receivables ageing for issued tax invoices by customer:
 * not due / 0–30 / 31–60 / 61–90 / 90+ days, balance net of payments, TDS and credit notes.
 */
export function computeReceivablesAgeing(
  dataset: RawFinanceDataset,
  asOfDate: string = todayIST(),
): ReceivablesAgeingReport {
  const { paymentsByInvoice, creditNotesByInvoice } = buildSettlementMaps(
    dataset.payments,
    dataset.creditNotes,
  );

  const byCustomer = new Map<string, CustomerAgeingRow>();

  for (const inv of dataset.invoices) {
    if (inv.kind !== "tax_invoice") continue;
    if (!["issued", "partly_paid", "paid"].includes(inv.status)) continue;

    const { paid_amount, tds_amount, credit_notes_total, net_balance } =
      computeInvoiceSettlements(inv, paymentsByInvoice, creditNotesByInvoice);

    if (net_balance <= 0) continue;

    const dueDate = inv.due_date || inv.invoice_date;
    const daysOverdue = diffDaysBetweenDates(dueDate, asOfDate);
    const bucket = classifyAgeingBucket(daysOverdue);

    const detail: AgeingInvoiceDetail = {
      invoice_id: inv.id,
      invoice_no: inv.invoice_no,
      invoice_date: inv.invoice_date,
      due_date: dueDate,
      job_id: inv.job_id,
      job_no: inv.job_no,
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      customer_gstin: inv.customer_gstin,
      total: round2(inv.total),
      paid_amount,
      tds_amount,
      credit_notes_total,
      net_balance,
      days_overdue: daysOverdue,
      bucket,
    };

    const existing = byCustomer.get(inv.customer_id) ?? {
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      customer_gstin: inv.customer_gstin,
      invoice_count: 0,
      not_due: 0,
      days_0_30: 0,
      days_31_60: 0,
      days_61_90: 0,
      days_90_plus: 0,
      total_outstanding: 0,
      invoices: [],
    };

    existing.invoice_count += 1;
    existing[bucket] = round2(existing[bucket] + net_balance);
    existing.total_outstanding = round2(existing.total_outstanding + net_balance);
    existing.invoices.push(detail);

    byCustomer.set(inv.customer_id, existing);
  }

  const customers = Array.from(byCustomer.values()).sort(
    (a, b) =>
      b.total_outstanding - a.total_outstanding ||
      a.customer_name.localeCompare(b.customer_name),
  );

  for (const c of customers) {
    c.invoices.sort((a, b) => b.days_overdue - a.days_overdue);
  }

  const totals = {
    customer_count: customers.length,
    invoice_count: customers.reduce((s, c) => s + c.invoice_count, 0),
    not_due: round2(customers.reduce((s, c) => s + c.not_due, 0)),
    days_0_30: round2(customers.reduce((s, c) => s + c.days_0_30, 0)),
    days_31_60: round2(customers.reduce((s, c) => s + c.days_31_60, 0)),
    days_61_90: round2(customers.reduce((s, c) => s + c.days_61_90, 0)),
    days_90_plus: round2(customers.reduce((s, c) => s + c.days_90_plus, 0)),
    total_outstanding: round2(customers.reduce((s, c) => s + c.total_outstanding, 0)),
  };

  return {
    as_of_date: asOfDate,
    customers,
    totals,
  };
}

/**
 * (b) Customer-wise revenue and outstanding for a financial year (April–March).
 */
export function computeCustomerRevenue(
  dataset: RawFinanceDataset,
  rawFy?: string | null,
  asOfDate: string = todayIST(),
): CustomerRevenueReport {
  const { fy, startDate, endDate } = parseFinancialYearRange(rawFy, asOfDate);
  const { paymentsByInvoice, creditNotesByInvoice } = buildSettlementMaps(
    dataset.payments,
    dataset.creditNotes,
  );

  const byCustomer = new Map<string, CustomerRevenueRow>();

  for (const inv of dataset.invoices) {
    if (inv.kind !== "tax_invoice") continue;
    if (!["issued", "partly_paid", "paid"].includes(inv.status)) continue;
    if (inv.invoice_date < startDate || inv.invoice_date > endDate) continue;

    const {
      paid_amount,
      tds_amount,
      credit_notes_taxable,
      credit_notes_total,
      net_balance,
    } = computeInvoiceSettlements(inv, paymentsByInvoice, creditNotesByInvoice);

    const gstTotal = round2(
      Number(inv.cgst ?? 0) + Number(inv.sgst ?? 0) + Number(inv.igst ?? 0),
    );
    const taxableVal = round2(inv.taxable_value);
    const grossTotal = round2(inv.total);
    const netTaxable = round2(Math.max(0, taxableVal - credit_notes_taxable));
    const netInvoiced = round2(Math.max(0, grossTotal - credit_notes_total));

    const existing = byCustomer.get(inv.customer_id) ?? {
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      customer_gstin: inv.customer_gstin,
      invoice_count: 0,
      taxable_value: 0,
      gst_total: 0,
      gross_invoiced: 0,
      credit_notes_taxable: 0,
      credit_notes_total: 0,
      net_taxable_revenue: 0,
      net_invoiced: 0,
      paid_amount: 0,
      tds_amount: 0,
      outstanding_balance: 0,
    };

    existing.invoice_count += 1;
    existing.taxable_value = round2(existing.taxable_value + taxableVal);
    existing.gst_total = round2(existing.gst_total + gstTotal);
    existing.gross_invoiced = round2(existing.gross_invoiced + grossTotal);
    existing.credit_notes_taxable = round2(
      existing.credit_notes_taxable + credit_notes_taxable,
    );
    existing.credit_notes_total = round2(
      existing.credit_notes_total + credit_notes_total,
    );
    existing.net_taxable_revenue = round2(
      existing.net_taxable_revenue + netTaxable,
    );
    existing.net_invoiced = round2(existing.net_invoiced + netInvoiced);
    existing.paid_amount = round2(existing.paid_amount + paid_amount);
    existing.tds_amount = round2(existing.tds_amount + tds_amount);
    existing.outstanding_balance = round2(
      existing.outstanding_balance + net_balance,
    );

    byCustomer.set(inv.customer_id, existing);
  }

  const customers = Array.from(byCustomer.values()).sort(
    (a, b) =>
      b.net_invoiced - a.net_invoiced ||
      a.customer_name.localeCompare(b.customer_name),
  );

  const totals = {
    customer_count: customers.length,
    invoice_count: customers.reduce((s, c) => s + c.invoice_count, 0),
    taxable_value: round2(customers.reduce((s, c) => s + c.taxable_value, 0)),
    gst_total: round2(customers.reduce((s, c) => s + c.gst_total, 0)),
    gross_invoiced: round2(customers.reduce((s, c) => s + c.gross_invoiced, 0)),
    credit_notes_taxable: round2(
      customers.reduce((s, c) => s + c.credit_notes_taxable, 0),
    ),
    credit_notes_total: round2(
      customers.reduce((s, c) => s + c.credit_notes_total, 0),
    ),
    net_taxable_revenue: round2(
      customers.reduce((s, c) => s + c.net_taxable_revenue, 0),
    ),
    net_invoiced: round2(customers.reduce((s, c) => s + c.net_invoiced, 0)),
    paid_amount: round2(customers.reduce((s, c) => s + c.paid_amount, 0)),
    tds_amount: round2(customers.reduce((s, c) => s + c.tds_amount, 0)),
    outstanding_balance: round2(
      customers.reduce((s, c) => s + c.outstanding_balance, 0),
    ),
  };

  return {
    fy,
    start_date: startDate,
    end_date: endDate,
    customers,
    totals,
  };
}

/**
 * (c) Monthly income (tax invoices issued, taxable value and GST) vs expenses (log-book job_expenses).
 */
export function computeMonthlyIncomeVsExpenses(
  dataset: RawFinanceDataset,
  rawFy?: string | null,
  asOfDate: string = todayIST(),
): MonthlyIncomeVsExpensesReport {
  const { fy, startDate, endDate, months } = parseFinancialYearRange(
    rawFy,
    asOfDate,
  );

  const monthMap = new Map<string, MonthlyIncomeExpenseRow>();
  for (const m of months) {
    monthMap.set(m, {
      month: m,
      label: formatMonthLabel(m),
      invoice_count: 0,
      taxable_value: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      gst_total: 0,
      gross_income: 0,
      credit_notes_total: 0,
      net_income: 0,
      expenses_total: 0,
      net_operating_surplus: 0,
    });
  }

  const validInvoiceIds = new Set<string>();
  for (const inv of dataset.invoices) {
    if (inv.kind !== "tax_invoice") continue;
    if (!["issued", "partly_paid", "paid"].includes(inv.status)) continue;
    validInvoiceIds.add(inv.id);

    const monthKey = (inv.invoice_date ?? "").slice(0, 7);
    const row = monthMap.get(monthKey);
    if (!row) continue;

    const cgst = round2(inv.cgst);
    const sgst = round2(inv.sgst);
    const igst = round2(inv.igst);
    const gst = round2(cgst + sgst + igst);
    const taxable = round2(inv.taxable_value);
    const total = round2(inv.total);

    row.invoice_count += 1;
    row.taxable_value = round2(row.taxable_value + taxable);
    row.cgst = round2(row.cgst + cgst);
    row.sgst = round2(row.sgst + sgst);
    row.igst = round2(row.igst + igst);
    row.gst_total = round2(row.gst_total + gst);
    row.gross_income = round2(row.gross_income + total);
  }

  for (const cn of dataset.creditNotes) {
    if (cn.status !== "issued") continue;
    if (!validInvoiceIds.has(cn.invoice_id)) continue;
    const monthKey = (cn.credit_date ?? "").slice(0, 7);
    const row = monthMap.get(monthKey);
    if (!row) continue;
    row.credit_notes_total = round2(row.credit_notes_total + Number(cn.total ?? 0));
  }

  for (const exp of dataset.expenses) {
    const monthKey = (exp.expense_date ?? "").slice(0, 7);
    const row = monthMap.get(monthKey);
    if (!row) continue;
    row.expenses_total = round2(row.expenses_total + Number(exp.amount ?? 0));
  }

  const monthRows = months.map((m) => {
    const row = monthMap.get(m)!;
    row.net_income = round2(Math.max(0, row.gross_income - row.credit_notes_total));
    row.net_operating_surplus = round2(row.taxable_value - row.expenses_total);
    return row;
  });

  const totals = {
    invoice_count: monthRows.reduce((s, r) => s + r.invoice_count, 0),
    taxable_value: round2(monthRows.reduce((s, r) => s + r.taxable_value, 0)),
    cgst: round2(monthRows.reduce((s, r) => s + r.cgst, 0)),
    sgst: round2(monthRows.reduce((s, r) => s + r.sgst, 0)),
    igst: round2(monthRows.reduce((s, r) => s + r.igst, 0)),
    gst_total: round2(monthRows.reduce((s, r) => s + r.gst_total, 0)),
    gross_income: round2(monthRows.reduce((s, r) => s + r.gross_income, 0)),
    credit_notes_total: round2(
      monthRows.reduce((s, r) => s + r.credit_notes_total, 0),
    ),
    net_income: round2(monthRows.reduce((s, r) => s + r.net_income, 0)),
    expenses_total: round2(monthRows.reduce((s, r) => s + r.expenses_total, 0)),
    net_operating_surplus: round2(
      monthRows.reduce((s, r) => s + r.net_operating_surplus, 0),
    ),
  };

  return {
    fy,
    start_date: startDate,
    end_date: endDate,
    months: monthRows,
    totals,
  };
}

/**
 * (d) Payments received in a month with TDS totals.
 */
export function computeMonthlyPayments(
  dataset: RawFinanceDataset,
  rawMonth?: string | null,
  asOfDate: string = todayIST(),
): MonthlyPaymentsReport {
  const { month, startDate, endDate } = parseFinanceMonth(rawMonth, asOfDate);

  const invoiceMap = new Map<string, RawFinanceInvoiceRow>();
  for (const inv of dataset.invoices) {
    if (inv.status === "cancelled") continue;
    invoiceMap.set(inv.id, inv);
  }

  const rows: MonthlyPaymentRow[] = [];
  for (const p of dataset.payments) {
    if (p.paid_on < startDate || p.paid_on > endDate) continue;
    const inv = invoiceMap.get(p.invoice_id);
    if (!inv) continue;

    const amount = round2(p.amount);
    const tds = round2(p.tds_amount);
    rows.push({
      payment_id: p.id,
      paid_on: p.paid_on,
      invoice_id: inv.id,
      invoice_no: inv.invoice_no,
      job_id: inv.job_id,
      job_no: inv.job_no,
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      customer_gstin: inv.customer_gstin,
      mode: p.mode,
      reference: p.reference,
      amount,
      tds_amount: tds,
      total_settled: round2(amount + tds),
    });
  }

  rows.sort(
    (a, b) =>
      b.paid_on.localeCompare(a.paid_on) ||
      a.invoice_no.localeCompare(b.invoice_no),
  );

  const totals = {
    payment_count: rows.length,
    amount_received: round2(rows.reduce((s, r) => s + r.amount, 0)),
    tds_total: round2(rows.reduce((s, r) => s + r.tds_amount, 0)),
    total_settled: round2(rows.reduce((s, r) => s + r.total_settled, 0)),
  };

  return {
    month,
    start_date: startDate,
    end_date: endDate,
    payments: rows,
    totals,
  };
}

/**
 * (e) Proformas not yet converted to a tax invoice.
 */
export function computeUnconvertedProformas(
  dataset: RawFinanceDataset,
  asOfDate: string = todayIST(),
): UnconvertedProformasReport {
  const convertedProformaIds = new Set<string>();
  const jobsWithTaxInvoice = new Set<string>();

  for (const inv of dataset.invoices) {
    if (inv.kind === "tax_invoice" && inv.status !== "cancelled") {
      if (inv.converted_from_id) {
        convertedProformaIds.add(inv.converted_from_id);
      }
      if (inv.job_id) {
        jobsWithTaxInvoice.add(inv.job_id);
      }
    }
  }

  const proformas: UnconvertedProformaRow[] = [];
  for (const inv of dataset.invoices) {
    if (inv.kind !== "proforma") continue;
    if (inv.status === "cancelled") continue;
    if (convertedProformaIds.has(inv.id)) continue;
    if (inv.job_id && jobsWithTaxInvoice.has(inv.job_id)) continue;

    const gstTotal = round2(
      Number(inv.cgst ?? 0) + Number(inv.sgst ?? 0) + Number(inv.igst ?? 0),
    );
    const ageDays = Math.max(0, diffDaysBetweenDates(inv.invoice_date, asOfDate));

    proformas.push({
      invoice_id: inv.id,
      invoice_no: inv.invoice_no,
      invoice_date: inv.invoice_date,
      status: inv.status,
      job_id: inv.job_id,
      job_no: inv.job_no,
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      customer_gstin: inv.customer_gstin,
      customer_po_number: inv.customer_po_number,
      taxable_value: round2(inv.taxable_value),
      gst_total: gstTotal,
      total: round2(inv.total),
      age_days: ageDays,
    });
  }

  proformas.sort(
    (a, b) =>
      b.age_days - a.age_days ||
      b.invoice_date.localeCompare(a.invoice_date),
  );

  const totals = {
    proforma_count: proformas.length,
    taxable_value: round2(proformas.reduce((s, p) => s + p.taxable_value, 0)),
    gst_total: round2(proformas.reduce((s, p) => s + p.gst_total, 0)),
    total_value: round2(proformas.reduce((s, p) => s + p.total, 0)),
  };

  return {
    as_of_date: asOfDate,
    proformas,
    totals,
  };
}

export function computeFinanceOverview(
  dataset: RawFinanceDataset,
  options?: {
    fy?: string | null;
    month?: string | null;
    asOfDate?: string;
  },
): FinanceOverview {
  const asOfDate = options?.asOfDate ?? todayIST();
  const { fy } = parseFinancialYearRange(options?.fy, asOfDate);
  const { month } = parseFinanceMonth(options?.month, asOfDate);

  return {
    fy,
    month,
    as_of_date: asOfDate,
    ageing: computeReceivablesAgeing(dataset, asOfDate),
    customer_revenue: computeCustomerRevenue(dataset, fy, asOfDate),
    monthly_income_vs_expenses: computeMonthlyIncomeVsExpenses(
      dataset,
      fy,
      asOfDate,
    ),
    monthly_payments: computeMonthlyPayments(dataset, month, asOfDate),
    unconverted_proformas: computeUnconvertedProformas(dataset, asOfDate),
  };
}

export async function loadFinanceDataset(
  supabase: AppSupabase,
): Promise<RawFinanceDataset> {
  const [invRes, pmtRes, cnRes, expRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, job_id, kind, status, invoice_no, number, invoice_date, due_date, customer_po_number, converted_from_id, taxable_value, cgst, sgst, igst, total, balance, jobs(id, job_no, customer_id, customers(id, name, gstin))",
      )
      .order("invoice_date", { ascending: false }),
    supabase
      .from("payments")
      .select("id, invoice_id, amount, tds_amount, paid_on, mode, reference")
      .order("paid_on", { ascending: false }),
    supabase
      .from("credit_notes")
      .select(
        "id, invoice_id, credit_note_no, credit_date, taxable_value, cgst, sgst, igst, total, status",
      )
      .order("credit_date", { ascending: false }),
    supabase
      .from("job_expenses")
      .select("id, job_id, expense_date, kind, amount")
      .is("deleted_at", null)
      .order("expense_date", { ascending: false }),
  ]);

  if (invRes.error) {
    throw new Error(`Failed to load invoices for finance reports: ${invRes.error.message}`);
  }
  if (pmtRes.error) {
    throw new Error(`Failed to load payments for finance reports: ${pmtRes.error.message}`);
  }
  if (cnRes.error) {
    throw new Error(`Failed to load credit notes for finance reports: ${cnRes.error.message}`);
  }
  if (expRes.error) {
    throw new Error(`Failed to load job expenses for finance reports: ${expRes.error.message}`);
  }

  const invoices: RawFinanceInvoiceRow[] = (invRes.data ?? []).map((row) => {
    const job = row.jobs as unknown as {
      id?: string;
      job_no?: string;
      customer_id?: string;
      customers?: { id?: string; name?: string; gstin?: string | null } | null;
    } | null;

    const customer = job?.customers;
    const invoiceDate = row.invoice_date ?? todayIST();

    return {
      id: row.id,
      job_id: row.job_id,
      job_no: job?.job_no ?? "—",
      customer_id: customer?.id ?? job?.customer_id ?? "unknown",
      customer_name: customer?.name ?? "Unknown Customer",
      customer_gstin: customer?.gstin ?? null,
      kind: row.kind,
      status: row.status,
      invoice_no: row.invoice_no ?? row.number ?? row.id.slice(0, 8),
      invoice_date: invoiceDate,
      due_date: row.due_date ?? invoiceDate,
      customer_po_number: row.customer_po_number ?? null,
      converted_from_id: row.converted_from_id ?? null,
      taxable_value: Number(row.taxable_value ?? 0),
      cgst: Number(row.cgst ?? 0),
      sgst: Number(row.sgst ?? 0),
      igst: Number(row.igst ?? 0),
      total: Number(row.total ?? 0),
      balance: Number(row.balance ?? 0),
    };
  });

  const payments: RawFinancePaymentRow[] = (pmtRes.data ?? []).map((p) => ({
    id: p.id,
    invoice_id: p.invoice_id,
    amount: Number(p.amount ?? 0),
    tds_amount: Number(p.tds_amount ?? 0),
    paid_on: p.paid_on,
    mode: p.mode ?? null,
    reference: p.reference ?? null,
  }));

  const creditNotes: RawFinanceCreditNoteRow[] = (cnRes.data ?? []).map((cn) => ({
    id: cn.id,
    invoice_id: cn.invoice_id,
    credit_note_no: cn.credit_note_no ?? null,
    credit_date: cn.credit_date,
    taxable_value: Number(cn.taxable_value ?? 0),
    cgst: Number(cn.cgst ?? 0),
    sgst: Number(cn.sgst ?? 0),
    igst: Number(cn.igst ?? 0),
    total: Number(cn.total ?? 0),
    status: cn.status,
  }));

  const expenses: RawFinanceExpenseRow[] = (expRes.data ?? []).map((e) => ({
    id: e.id,
    job_id: e.job_id,
    expense_date: e.expense_date,
    kind: e.kind,
    amount: Number(e.amount ?? 0),
  }));

  return { invoices, payments, creditNotes, expenses };
}

export async function getFinanceOverview(
  supabase: AppSupabase,
  options?: {
    fy?: string | null;
    month?: string | null;
    asOfDate?: string;
  },
): Promise<FinanceOverview> {
  const dataset = await loadFinanceDataset(supabase);
  return computeFinanceOverview(dataset, options);
}
