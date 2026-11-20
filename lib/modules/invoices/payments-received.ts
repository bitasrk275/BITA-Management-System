import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/types";
import { daysBetween, todayIST } from "../../dates";
import { roundPaise } from "../../invoices";
import { evaluateAndAutoCloseJobsForInvoice } from "../jobs/service";

type AppSupabase = SupabaseClient<Database>;

/**
 * Computes the number of days elapsed since an invoice's `invoice_date` (as of `today` in IST).
 * Returns null if `invoiceDate` is missing or invalid.
 */
export function formatDaysSinceInvoiceDate(
  invoiceDate: string | null | undefined,
  today: string = todayIST(),
): { days: number; label: string } | null {
  if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate.slice(0, 10))) {
    return null;
  }
  const cleanDate = invoiceDate.slice(0, 10);
  const rawDays = daysBetween(cleanDate, today);
  const days = Math.max(0, rawDays);
  return {
    days,
    label: days === 1 ? "1 day" : `${days} days`,
  };
}

/**
 * For an issued, unpaid invoice (`status in ('issued', 'partly_paid')` and `balance > 0`),
 * returns the human-readable age label `"N days"` (or `"1 day"`). Returns null for drafts,
 * cancelled invoices, or fully paid invoices.
 */
export function formatUnpaidInvoiceDaysLabel(
  inv: {
    status?: string | null;
    balance?: number | string | null;
    invoice_date?: string | null;
  },
  today: string = todayIST(),
): string | null {
  if (!inv || inv.status === "draft" || inv.status === "cancelled" || inv.status === "paid") {
    return null;
  }
  const bal = Number(inv.balance) || 0;
  if (bal <= 0) return null;
  return formatDaysSinceInvoiceDate(inv.invoice_date, today)?.label ?? null;
}

export interface JobInvoiceSummaryItem {
  id: string;
  kind: "proforma" | "tax_invoice";
  invoice_no: string;
  invoice_date: string | null;
  due_date: string | null;
  total: number;
  balance: number;
  status: string;
  days_since_invoice: string | null;
}

export interface JobPaymentStatusRow {
  job_id: string;
  job_no: string;
  customer_id: string;
  customer_name: string;
  po_number: string | null;
  po_value: number | null;
  scope: string | null;
  status: string;
  paid_at: string | null;
  paid_receipt_id: string | null;
  advice_path: string | null;
  invoices: JobInvoiceSummaryItem[];
  issued_tax_invoices: JobInvoiceSummaryItem[];
  total_billed: number;
  outstanding_balance: number;
  is_paid: boolean;
}

export interface PaymentReceiptSummary {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  received_on: string;
  amount: number;
  mode: string | null;
  reference: string | null;
  advice_path: string | null;
  job_ids: string[];
  job_nos: string[];
  notes: string | null;
  created_at: string;
}

export interface RecordMultiJobPaymentReceiptInput {
  job_ids: string[];
  customer_id?: string | null;
  received_on?: string | null;
  amount?: number | null;
  mode?: string | null;
  reference?: string | null;
  advice_path?: string | null;
  tds_by_job_id?: Record<string, number>;
  notes?: string | null;
  created_by?: string | null;
}

export interface RecordMultiJobPaymentReceiptResult {
  receipt_id: string;
  jobs_marked_paid: number;
  payments_created: number;
  total_settled: number;
}

/**
 * Lists jobs for the "Payments received" view on `/invoices`, computing whether each job is
 * Paid or Pending and summarizing its linked invoices and outstanding balance.
 */
export async function listJobsForPaymentsReceived(
  supabase: AppSupabase,
  opts?: { customerId?: string | null; today?: string },
): Promise<{
  jobs: JobPaymentStatusRow[];
  receipts: PaymentReceiptSummary[];
}> {
  const today = opts?.today ?? todayIST();

  let jobsQuery = supabase
    .from("jobs")
    .select(
      "id, job_no, customer_id, po_number, po_value, scope, status, paid_at, paid_receipt_id, created_at, customers(id, name)",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (opts?.customerId) {
    jobsQuery = jobsQuery.eq("customer_id", opts.customerId);
  }

  const [jobsRes, invoicesRes, receiptsRes] = await Promise.all([
    jobsQuery,
    supabase
      .from("invoices")
      .select(
        "id, job_id, kind, invoice_no, number, invoice_date, due_date, total, balance, status, invoice_reports(report_id, reports(job_id))",
      )
      .neq("status", "cancelled")
      .order("invoice_date", { ascending: false }),
    supabase
      .from("payment_receipts")
      .select("*, customers(name)")
      .order("received_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const rawJobs = jobsRes.data ?? [];
  const rawInvoices = invoicesRes.data ?? [];
  const rawReceipts = receiptsRes.data ?? [];

  const receiptById = new Map(rawReceipts.map((r) => [r.id, r]));
  const jobNoById = new Map(rawJobs.map((j) => [j.id, j.job_no]));

  // Map job_id -> array of non-cancelled invoices (via direct job_id or invoice_reports.reports.job_id)
  const invoicesByJobId = new Map<string, Map<string, JobInvoiceSummaryItem>>();

  function attachInvoiceToJob(jobId: string, item: JobInvoiceSummaryItem) {
    let bucket = invoicesByJobId.get(jobId);
    if (!bucket) {
      bucket = new Map();
      invoicesByJobId.set(jobId, bucket);
    }
    bucket.set(item.id, item);
  }

  for (const inv of rawInvoices) {
    const item: JobInvoiceSummaryItem = {
      id: inv.id,
      kind: inv.kind,
      invoice_no:
        inv.invoice_no ??
        inv.number ??
        (inv.kind === "proforma" ? "Draft Proforma" : "Draft"),
      invoice_date: inv.invoice_date,
      due_date: inv.due_date,
      total: roundPaise(Number(inv.total) || 0),
      balance: roundPaise(Number(inv.balance) || 0),
      status: inv.status,
      days_since_invoice: formatDaysSinceInvoiceDate(inv.invoice_date, today)?.label ?? null,
    };

    if (inv.job_id) {
      attachInvoiceToJob(inv.job_id, item);
    }

    const joinRows = (inv.invoice_reports ?? []) as unknown as Array<{
      report_id: string;
      reports?: { job_id?: string | null } | null;
    }>;
    for (const jr of joinRows) {
      const rJobId = jr.reports?.job_id;
      if (rJobId) {
        attachInvoiceToJob(rJobId, item);
      }
    }
  }

  const jobs: JobPaymentStatusRow[] = rawJobs.map((j) => {
    const cust = j.customers as unknown as { id: string; name: string } | null;
    const invList = Array.from(invoicesByJobId.get(j.id)?.values() ?? []);
    const issuedTax = invList.filter(
      (i) =>
        i.kind === "tax_invoice" &&
        ["issued", "partly_paid", "paid"].includes(i.status),
    );
    const totalBilled = roundPaise(
      issuedTax.reduce((sum, i) => sum + i.total, 0),
    );
    const outstandingBalance = roundPaise(
      issuedTax.reduce((sum, i) => sum + (i.balance > 0 ? i.balance : 0), 0),
    );

    // D-R3a:
    // - If the job has issued tax invoices, it is Paid when all of them have balance === 0.
    // - If the job has no issued tax invoice yet, it is Paid when jobs.paid_at is set.
    const isPaid =
      issuedTax.length > 0
        ? outstandingBalance === 0
        : Boolean(j.paid_at);

    const linkedReceipt = j.paid_receipt_id ? receiptById.get(j.paid_receipt_id) : undefined;

    return {
      job_id: j.id,
      job_no: j.job_no,
      customer_id: j.customer_id,
      customer_name: cust?.name ?? "Customer",
      po_number: j.po_number,
      po_value: j.po_value !== null && j.po_value !== undefined ? Number(j.po_value) : null,
      scope: j.scope,
      status: j.status,
      paid_at: j.paid_at,
      paid_receipt_id: j.paid_receipt_id,
      advice_path: linkedReceipt?.advice_path ?? null,
      invoices: invList,
      issued_tax_invoices: issuedTax,
      total_billed: totalBilled,
      outstanding_balance: outstandingBalance,
      is_paid: isPaid,
    };
  });

  const receipts: PaymentReceiptSummary[] = rawReceipts.map((r) => {
    const cust = r.customers as unknown as { name?: string } | null;
    const jIds = Array.isArray(r.job_ids) ? r.job_ids : [];
    return {
      id: r.id,
      customer_id: r.customer_id,
      customer_name: cust?.name ?? null,
      received_on: r.received_on,
      amount: roundPaise(Number(r.amount) || 0),
      mode: r.mode,
      reference: r.reference,
      advice_path: r.advice_path,
      job_ids: jIds,
      job_nos: jIds.map((id) => jobNoById.get(id) ?? id.slice(0, 8)),
      notes: r.notes,
      created_at: r.created_at,
    };
  });

  return { jobs, receipts };
}

/**
 * Records one multi-job payment receipt (D-R3a):
 * - Creates a `payment_receipts` row covering all ticked `job_ids` (with date, amount, mode, reference, optional advice file).
 * - For each ticked job, every ISSUED tax invoice with `balance > 0` gets a `payments` row (linked via `receipt_id`)
 *   for its full remaining balance (with optional per-job TDS, default 0), so invoices, Finance, and overdue reminders stay accurate.
 * - Every ticked job gets `jobs.paid_at` and `jobs.paid_receipt_id` set (marking jobs with no issued invoice as Paid too).
 * - Evaluates the job auto-close rule for each settled invoice.
 */
export async function recordMultiJobPaymentReceipt(
  supabase: AppSupabase,
  input: RecordMultiJobPaymentReceiptInput,
): Promise<RecordMultiJobPaymentReceiptResult> {
  const uniqueJobIds = Array.from(
    new Set((input.job_ids ?? []).map((id) => id.trim()).filter(Boolean)),
  );
  if (uniqueJobIds.length === 0) {
    throw new Error("Tick at least one Job ID to mark as paid.");
  }

  const receivedOn =
    input.received_on && /^\d{4}-\d{2}-\d{2}$/.test(input.received_on)
      ? input.received_on
      : todayIST();
  const mode = input.mode?.trim() || "NEFT";
  const reference = input.reference?.trim() || null;
  const advicePath = input.advice_path?.trim() || null;
  const notes = input.notes?.trim() || null;

  // 1. Load ticked jobs
  const { data: jobs, error: jobsErr } = await supabase
    .from("jobs")
    .select("id, job_no, customer_id, status, paid_at")
    .in("id", uniqueJobIds);

  if (jobsErr) {
    throw new Error(jobsErr.message);
  }
  if (!jobs || jobs.length === 0) {
    throw new Error("Selected jobs could not be found.");
  }

  const distinctCustomerIds = Array.from(new Set(jobs.map((j) => j.customer_id)));
  const inferredCustomerId =
    input.customer_id?.trim() ||
    (distinctCustomerIds.length === 1 ? distinctCustomerIds[0] : null);

  // 2. Find all issued tax invoices with balance > 0 for the ticked jobs (direct job_id or via invoice_reports)
  const [{ data: directInvs, error: directErr }, { data: reportJoinInvs }] =
    await Promise.all([
      supabase
        .from("invoices")
        .select("id, job_id, kind, status, balance, total")
        .in("job_id", uniqueJobIds)
        .eq("kind", "tax_invoice")
        .in("status", ["issued", "partly_paid"])
        .gt("balance", 0),
      supabase
        .from("invoice_reports")
        .select(
          "invoice_id, reports!inner(job_id), invoices!inner(id, job_id, kind, status, balance, total)",
        )
        .in("reports.job_id", uniqueJobIds),
    ]);

  if (directErr) {
    throw new Error(directErr.message);
  }

  const targetInvoicesMap = new Map<
    string,
    { id: string; job_id: string; balance: number }
  >();

  for (const inv of directInvs ?? []) {
    const bal = roundPaise(Number(inv.balance) || 0);
    if (bal > 0) {
      targetInvoicesMap.set(inv.id, {
        id: inv.id,
        job_id: inv.job_id,
        balance: bal,
      });
    }
  }

  for (const row of reportJoinInvs ?? []) {
    const inv = row.invoices as unknown as {
      id: string;
      job_id: string;
      kind: string;
      status: string;
      balance: number;
    } | null;
    if (
      inv &&
      inv.kind === "tax_invoice" &&
      ["issued", "partly_paid"].includes(inv.status) &&
      Number(inv.balance) > 0 &&
      !targetInvoicesMap.has(inv.id)
    ) {
      targetInvoicesMap.set(inv.id, {
        id: inv.id,
        job_id: inv.job_id,
        balance: roundPaise(Number(inv.balance) || 0),
      });
    }
  }

  const targetInvoices = Array.from(targetInvoicesMap.values());
  const totalInvoiceBalance = roundPaise(
    targetInvoices.reduce((sum, inv) => sum + inv.balance, 0),
  );

  const explicitAmount =
    input.amount !== null &&
    input.amount !== undefined &&
    Number.isFinite(Number(input.amount)) &&
    Number(input.amount) > 0
      ? roundPaise(Number(input.amount))
      : null;

  const receiptAmount = explicitAmount ?? totalInvoiceBalance;

  // 3. Insert the payment receipt row
  const { data: receipt, error: receiptErr } = await supabase
    .from("payment_receipts")
    .insert({
      customer_id: inferredCustomerId,
      received_on: receivedOn,
      amount: receiptAmount,
      mode,
      reference,
      advice_path: advicePath,
      job_ids: uniqueJobIds,
      notes,
      created_by: input.created_by ?? null,
    })
    .select("id")
    .single();

  if (receiptErr || !receipt) {
    throw new Error(receiptErr?.message ?? "Could not save payment receipt.");
  }

  // 4. Create a full-balance payment row for each issued tax invoice with balance > 0
  const remainingTdsByJob = new Map<string, number>();
  for (const [jId, tdsVal] of Object.entries(input.tds_by_job_id ?? {})) {
    const num = Number(tdsVal);
    if (Number.isFinite(num) && num > 0) {
      remainingTdsByJob.set(jId, roundPaise(num));
    }
  }

  let paymentsCreated = 0;
  for (const inv of targetInvoices) {
    const jobTdsLeft = remainingTdsByJob.get(inv.job_id) ?? 0;
    // payments.amount has a DB check (amount > 0), so leave at least 0.01 in amount if TDS was entered
    const maxTds = Math.max(0, roundPaise(inv.balance - 0.01));
    const tdsAmount = roundPaise(Math.min(jobTdsLeft, maxTds));
    const bankAmount = roundPaise(inv.balance - tdsAmount);
    if (jobTdsLeft > 0) {
      remainingTdsByJob.set(inv.job_id, roundPaise(jobTdsLeft - tdsAmount));
    }

    const { error: payErr } = await supabase.from("payments").insert({
      invoice_id: inv.id,
      amount: bankAmount,
      tds_amount: tdsAmount,
      paid_on: receivedOn,
      mode,
      reference,
      receipt_id: receipt.id,
    });

    if (payErr) {
      throw new Error(payErr.message);
    }
    paymentsCreated += 1;

    await evaluateAndAutoCloseJobsForInvoice(supabase, inv.id);
  }

  // 5. Mark all ticked jobs with paid_at and paid_receipt_id
  const nowIso = new Date().toISOString();
  const { error: jobUpdErr } = await supabase
    .from("jobs")
    .update({
      paid_at: nowIso,
      paid_receipt_id: receipt.id,
    })
    .in("id", uniqueJobIds);

  if (jobUpdErr) {
    throw new Error(jobUpdErr.message);
  }

  return {
    receipt_id: receipt.id,
    jobs_marked_paid: uniqueJobIds.length,
    payments_created: paymentsCreated,
    total_settled: totalInvoiceBalance,
  };
}
