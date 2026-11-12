import { todayIST } from "../../dates";
import { csvEscapeCell } from "../../invoices/gst-export";

export type AgeingBucket =
  | "not_due"
  | "days_0_30"
  | "days_31_60"
  | "days_61_90"
  | "days_90_plus";

export interface AgeingInvoiceDetail {
  invoice_id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  job_id: string;
  job_no: string;
  customer_id: string;
  customer_name: string;
  customer_gstin: string | null;
  total: number;
  paid_amount: number;
  tds_amount: number;
  credit_notes_total: number;
  net_balance: number;
  days_overdue: number;
  bucket: AgeingBucket;
}

export interface CustomerAgeingRow {
  customer_id: string;
  customer_name: string;
  customer_gstin: string | null;
  invoice_count: number;
  not_due: number;
  days_0_30: number;
  days_31_60: number;
  days_61_90: number;
  days_90_plus: number;
  total_outstanding: number;
  invoices: AgeingInvoiceDetail[];
}

export interface ReceivablesAgeingReport {
  as_of_date: string;
  customers: CustomerAgeingRow[];
  totals: {
    customer_count: number;
    invoice_count: number;
    not_due: number;
    days_0_30: number;
    days_31_60: number;
    days_61_90: number;
    days_90_plus: number;
    total_outstanding: number;
  };
}

export interface CustomerRevenueRow {
  customer_id: string;
  customer_name: string;
  customer_gstin: string | null;
  invoice_count: number;
  taxable_value: number;
  gst_total: number;
  gross_invoiced: number;
  credit_notes_taxable: number;
  credit_notes_total: number;
  net_taxable_revenue: number;
  net_invoiced: number;
  paid_amount: number;
  tds_amount: number;
  outstanding_balance: number;
}

export interface CustomerRevenueReport {
  fy: string;
  start_date: string;
  end_date: string;
  customers: CustomerRevenueRow[];
  totals: {
    customer_count: number;
    invoice_count: number;
    taxable_value: number;
    gst_total: number;
    gross_invoiced: number;
    credit_notes_taxable: number;
    credit_notes_total: number;
    net_taxable_revenue: number;
    net_invoiced: number;
    paid_amount: number;
    tds_amount: number;
    outstanding_balance: number;
  };
}

export interface MonthlyIncomeExpenseRow {
  month: string;
  label: string;
  invoice_count: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  gst_total: number;
  gross_income: number;
  credit_notes_total: number;
  net_income: number;
  expenses_total: number;
  net_operating_surplus: number;
}

export interface MonthlyIncomeVsExpensesReport {
  fy: string;
  start_date: string;
  end_date: string;
  months: MonthlyIncomeExpenseRow[];
  totals: {
    invoice_count: number;
    taxable_value: number;
    cgst: number;
    sgst: number;
    igst: number;
    gst_total: number;
    gross_income: number;
    credit_notes_total: number;
    net_income: number;
    expenses_total: number;
    net_operating_surplus: number;
  };
}

export interface MonthlyPaymentRow {
  payment_id: string;
  paid_on: string;
  invoice_id: string;
  invoice_no: string;
  job_id: string;
  job_no: string;
  customer_id: string;
  customer_name: string;
  customer_gstin: string | null;
  mode: string | null;
  reference: string | null;
  amount: number;
  tds_amount: number;
  total_settled: number;
}

export interface MonthlyPaymentsReport {
  month: string;
  start_date: string;
  end_date: string;
  payments: MonthlyPaymentRow[];
  totals: {
    payment_count: number;
    amount_received: number;
    tds_total: number;
    total_settled: number;
  };
}

export interface UnconvertedProformaRow {
  invoice_id: string;
  invoice_no: string;
  invoice_date: string;
  status: string;
  job_id: string;
  job_no: string;
  customer_id: string;
  customer_name: string;
  customer_gstin: string | null;
  customer_po_number: string | null;
  taxable_value: number;
  gst_total: number;
  total: number;
  age_days: number;
}

export interface UnconvertedProformasReport {
  as_of_date: string;
  proformas: UnconvertedProformaRow[];
  totals: {
    proforma_count: number;
    taxable_value: number;
    gst_total: number;
    total_value: number;
  };
}

export interface FinanceOverview {
  fy: string;
  month: string;
  as_of_date: string;
  ageing: ReceivablesAgeingReport;
  customer_revenue: CustomerRevenueReport;
  monthly_income_vs_expenses: MonthlyIncomeVsExpensesReport;
  monthly_payments: MonthlyPaymentsReport;
  unconverted_proformas: UnconvertedProformasReport;
}

export function round2(val: number): number {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

export function currentFinancialYear(asOfDate: string = todayIST()): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(asOfDate);
  const year = m ? Number(m[1]) : 2026;
  const month = m ? Number(m[2]) : 4;
  const startYear = month >= 4 ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endShort}`;
}

export function parseFinancialYearRange(
  rawFy?: string | null,
  asOfDate: string = todayIST(),
): {
  fy: string;
  startYear: number;
  startDate: string;
  endDate: string;
  months: string[];
} {
  const fallback = currentFinancialYear(asOfDate);
  const trimmed = (rawFy ?? "").trim();

  let startYear = Number(fallback.slice(0, 4));
  const fullMatch = /^(\d{4})-(\d{2}|\d{4})$/.exec(trimmed);
  const shortMatch = /^(\d{2})-(\d{2})$/.exec(trimmed);

  if (fullMatch) {
    const y = Number(fullMatch[1]);
    if (y >= 2000 && y <= 2100) {
      startYear = y;
    }
  } else if (shortMatch) {
    const y = 2000 + Number(shortMatch[1]);
    if (y >= 2000 && y <= 2100) {
      startYear = y;
    }
  }

  const endYear = startYear + 1;
  const fy = `${startYear}-${String(endYear % 100).padStart(2, "0")}`;
  const startDate = `${startYear}-04-01`;
  const endDate = `${endYear}-03-31`;

  const months: string[] = [];
  for (let m = 4; m <= 12; m++) {
    months.push(`${startYear}-${String(m).padStart(2, "0")}`);
  }
  for (let m = 1; m <= 3; m++) {
    months.push(`${endYear}-${String(m).padStart(2, "0")}`);
  }

  return { fy, startYear, startDate, endDate, months };
}

export function parseFinanceMonth(
  rawMonth?: string | null,
  asOfDate: string = todayIST(),
): {
  month: string;
  startDate: string;
  endDate: string;
} {
  const defaultMonth = asOfDate.slice(0, 7);
  const trimmed = (rawMonth ?? "").trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(trimmed);
  const month = match ? trimmed : defaultMonth;
  const [yStr, mStr] = month.split("-");
  const year = Number(yStr);
  const mon = Number(mStr);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    month,
    startDate: `${month}-01`,
    endDate: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

const MONTH_SHORT_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatMonthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  const idx = Number(m[2]) - 1;
  return `${MONTH_SHORT_NAMES[idx] ?? m[2]} ${m[1]}`;
}

export function diffDaysBetweenDates(fromIsoDate: string, toIsoDate: string): number {
  const [fy, fm, fd] = fromIsoDate.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = toIsoDate.slice(0, 10).split("-").map(Number);
  const fromUtc = Date.UTC(fy || 1970, (fm || 1) - 1, fd || 1);
  const toUtc = Date.UTC(ty || 1970, (tm || 1) - 1, td || 1);
  return Math.floor((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

export function classifyAgeingBucket(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 30) return "days_0_30";
  if (daysOverdue <= 60) return "days_31_60";
  if (daysOverdue <= 90) return "days_61_90";
  return "days_90_plus";
}

function buildCsv(headers: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const lines = [
    headers.map(csvEscapeCell).join(","),
    ...rows.map((r) => r.map(csvEscapeCell).join(",")),
  ];
  return lines.join("\r\n") + "\r\n";
}

export function receivablesAgeingToCsv(report: ReceivablesAgeingReport): string {
  const headers = [
    "Customer",
    "GSTIN",
    "Invoices",
    "Not Due (INR)",
    "0-30 Days (INR)",
    "31-60 Days (INR)",
    "61-90 Days (INR)",
    "90+ Days (INR)",
    "Total Outstanding (INR)",
  ];
  const rows = report.customers.map((c) => [
    c.customer_name,
    c.customer_gstin ?? "",
    c.invoice_count,
    c.not_due.toFixed(2),
    c.days_0_30.toFixed(2),
    c.days_31_60.toFixed(2),
    c.days_61_90.toFixed(2),
    c.days_90_plus.toFixed(2),
    c.total_outstanding.toFixed(2),
  ]);
  rows.push([
    "TOTAL",
    "",
    report.totals.invoice_count,
    report.totals.not_due.toFixed(2),
    report.totals.days_0_30.toFixed(2),
    report.totals.days_31_60.toFixed(2),
    report.totals.days_61_90.toFixed(2),
    report.totals.days_90_plus.toFixed(2),
    report.totals.total_outstanding.toFixed(2),
  ]);
  return buildCsv(headers, rows);
}

export function customerRevenueToCsv(report: CustomerRevenueReport): string {
  const headers = [
    "Financial Year",
    "Customer",
    "GSTIN",
    "Invoices",
    "Taxable Value (INR)",
    "GST (INR)",
    "Gross Invoiced (INR)",
    "Credit Notes (INR)",
    "Net Invoiced (INR)",
    "Received (INR)",
    "TDS Deducted (INR)",
    "Outstanding (INR)",
  ];
  const rows = report.customers.map((c) => [
    report.fy,
    c.customer_name,
    c.customer_gstin ?? "",
    c.invoice_count,
    c.taxable_value.toFixed(2),
    c.gst_total.toFixed(2),
    c.gross_invoiced.toFixed(2),
    c.credit_notes_total.toFixed(2),
    c.net_invoiced.toFixed(2),
    c.paid_amount.toFixed(2),
    c.tds_amount.toFixed(2),
    c.outstanding_balance.toFixed(2),
  ]);
  rows.push([
    report.fy,
    "TOTAL",
    "",
    report.totals.invoice_count,
    report.totals.taxable_value.toFixed(2),
    report.totals.gst_total.toFixed(2),
    report.totals.gross_invoiced.toFixed(2),
    report.totals.credit_notes_total.toFixed(2),
    report.totals.net_invoiced.toFixed(2),
    report.totals.paid_amount.toFixed(2),
    report.totals.tds_amount.toFixed(2),
    report.totals.outstanding_balance.toFixed(2),
  ]);
  return buildCsv(headers, rows);
}

export function monthlyIncomeVsExpensesToCsv(report: MonthlyIncomeVsExpensesReport): string {
  const headers = [
    "Month",
    "Tax Invoices Issued",
    "Taxable Value (INR)",
    "CGST (INR)",
    "SGST (INR)",
    "IGST (INR)",
    "Total GST (INR)",
    "Gross Income (INR)",
    "Credit Notes (INR)",
    "Net Income (INR)",
    "Job Expenses (INR)",
    "Operating Surplus (Taxable - Expenses) (INR)",
  ];
  const rows = report.months.map((m) => [
    m.label,
    m.invoice_count,
    m.taxable_value.toFixed(2),
    m.cgst.toFixed(2),
    m.sgst.toFixed(2),
    m.igst.toFixed(2),
    m.gst_total.toFixed(2),
    m.gross_income.toFixed(2),
    m.credit_notes_total.toFixed(2),
    m.net_income.toFixed(2),
    m.expenses_total.toFixed(2),
    m.net_operating_surplus.toFixed(2),
  ]);
  rows.push([
    "TOTAL",
    report.totals.invoice_count,
    report.totals.taxable_value.toFixed(2),
    report.totals.cgst.toFixed(2),
    report.totals.sgst.toFixed(2),
    report.totals.igst.toFixed(2),
    report.totals.gst_total.toFixed(2),
    report.totals.gross_income.toFixed(2),
    report.totals.credit_notes_total.toFixed(2),
    report.totals.net_income.toFixed(2),
    report.totals.expenses_total.toFixed(2),
    report.totals.net_operating_surplus.toFixed(2),
  ]);
  return buildCsv(headers, rows);
}

export function monthlyPaymentsToCsv(report: MonthlyPaymentsReport): string {
  const headers = [
    "Paid On",
    "Invoice No.",
    "Job No.",
    "Customer",
    "GSTIN",
    "Mode",
    "Reference",
    "Amount Received (INR)",
    "TDS Deducted (INR)",
    "Total Settled (INR)",
  ];
  const rows = report.payments.map((p) => [
    p.paid_on,
    p.invoice_no,
    p.job_no,
    p.customer_name,
    p.customer_gstin ?? "",
    p.mode ?? "",
    p.reference ?? "",
    p.amount.toFixed(2),
    p.tds_amount.toFixed(2),
    p.total_settled.toFixed(2),
  ]);
  rows.push([
    "TOTAL",
    "",
    "",
    `${report.totals.payment_count} payment(s)`,
    "",
    "",
    "",
    report.totals.amount_received.toFixed(2),
    report.totals.tds_total.toFixed(2),
    report.totals.total_settled.toFixed(2),
  ]);
  return buildCsv(headers, rows);
}

export function unconvertedProformasToCsv(report: UnconvertedProformasReport): string {
  const headers = [
    "Proforma No.",
    "Date",
    "Status",
    "Job No.",
    "Customer",
    "GSTIN",
    "Customer PO",
    "Taxable Value (INR)",
    "GST (INR)",
    "Total (INR)",
    "Age (Days)",
  ];
  const rows = report.proformas.map((p) => [
    p.invoice_no,
    p.invoice_date,
    p.status,
    p.job_no,
    p.customer_name,
    p.customer_gstin ?? "",
    p.customer_po_number ?? "",
    p.taxable_value.toFixed(2),
    p.gst_total.toFixed(2),
    p.total.toFixed(2),
    p.age_days,
  ]);
  rows.push([
    "TOTAL",
    "",
    `${report.totals.proforma_count} proforma(s)`,
    "",
    "",
    "",
    "",
    report.totals.taxable_value.toFixed(2),
    report.totals.gst_total.toFixed(2),
    report.totals.total_value.toFixed(2),
    "",
  ]);
  return buildCsv(headers, rows);
}
