import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Tables } from "../../db/types";
import { restoreRecord, softDeleteRecord } from "../recycle-bin/service";
import { checkCanDelete } from "../settings/service";
import type { JobInput } from "./schema";

export type JobRow = Tables<"jobs">;

export async function listJobs(
  supabase: SupabaseClient<Database>,
  opts?: {
    status?: string | null;
    customerId?: string | null;
    q?: string | null;
  },
): Promise<{ data: unknown[]; error: string | null }> {
  let query = supabase
    .from("jobs")
    .select("*, customers(id, name, code, gstin)")
    .order("created_at", { ascending: false });

  if (opts?.status && opts.status !== "all") {
    query = query.eq("status", opts.status as Enums<"job_status">);
  }
  if (opts?.customerId) {
    query = query.eq("customer_id", opts.customerId);
  }
  if (opts?.q && opts.q.trim()) {
    const clean = opts.q.trim().replace(/[%*,()]/g, " ");
    query = query.or(
      `job_no.ilike.%${clean}%,site.ilike.%${clean}%,scope.ilike.%${clean}%,po_number.ilike.%${clean}%`,
    );
  }

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

export async function getJobDetail(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: unknown | null; error: string | null }> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "*, customers(id, name, code, gstin, billing_address), reports(id, report_no, method, status, approved_at, sent_at), invoices(id, invoice_no, number, kind, status, total, balance)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  return { data: data ?? null, error: null };
}

export async function createJobRecord(
  supabase: SupabaseClient<Database>,
  input: JobInput,
): Promise<{ data: JobRow | null; error: string | null }> {
  let enquiryId = input.enquiry_id;
  if (input.quotation_id && !enquiryId) {
    const { data: qt } = await supabase
      .from("quotations")
      .select("enquiry_id")
      .eq("id", input.quotation_id)
      .maybeSingle();
    if (qt?.enquiry_id) {
      enquiryId = qt.enquiry_id;
    }
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      customer_id: input.customer_id,
      enquiry_id: enquiryId,
      quotation_id: input.quotation_id,
      site: input.site,
      scope: input.scope,
      test_methods: input.test_methods,
      po_number: input.po_number,
      po_date: input.po_date,
      po_value: input.po_value,
      ...(input.status ? { status: input.status } : {}),
    })
    .select("*")
    .single();

  if (error || !data) {
    return { data: null, error: error?.message ?? "Could not create job." };
  }

  if (enquiryId) {
    await supabase
      .from("enquiries")
      .update({ status: "converted" })
      .eq("id", enquiryId);
  }

  return { data, error: null };
}

export async function updateJobRecord(
  supabase: SupabaseClient<Database>,
  id: string,
  input: Partial<JobInput>,
): Promise<{ data: JobRow | null; error: string | null }> {
  const patch: Database["public"]["Tables"]["jobs"]["Update"] = {
    ...(input.customer_id !== undefined ? { customer_id: input.customer_id } : {}),
    ...(input.enquiry_id !== undefined ? { enquiry_id: input.enquiry_id } : {}),
    ...(input.quotation_id !== undefined ? { quotation_id: input.quotation_id } : {}),
    ...(input.site !== undefined ? { site: input.site } : {}),
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.test_methods !== undefined ? { test_methods: input.test_methods } : {}),
    ...(input.po_number !== undefined ? { po_number: input.po_number } : {}),
    ...(input.po_date !== undefined ? { po_date: input.po_date } : {}),
    ...(input.po_value !== undefined ? { po_value: input.po_value } : {}),
    ...(input.status !== undefined
      ? {
          status: input.status,
          closed_at:
            input.status === "closed" ? new Date().toISOString() : null,
        }
      : {}),
  };

  const { data, error } = await supabase
    .from("jobs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function deleteJobRecord(
  supabase: SupabaseClient<Database>,
  id: string,
  callerRoles?: readonly Enums<"app_role">[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const perm = await checkCanDelete(supabase, callerRoles);
  if (!perm.ok) return perm;

  // Rule: a job with an issued invoice can't be deleted (cancel by credit note first)
  const { data: directInvoices, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, number, status, issued_at")
    .eq("job_id", id)
    .neq("status", "cancelled");

  if (invErr) {
    return { ok: false, error: "Failed to check linked invoices: " + invErr.message };
  }

  const issuedDirect = (directInvoices ?? []).filter(
    (inv) =>
      inv.issued_at !== null ||
      ["issued", "partly_paid", "partially_paid", "paid"].includes(inv.status),
  );

  if (issuedDirect.length > 0) {
    const invNo =
      issuedDirect[0].invoice_no ||
      issuedDirect[0].number ||
      "issued invoice";
    return {
      ok: false,
      error: `Cannot delete job: an issued invoice (${invNo}) exists for this job. Cancel by credit note first.`,
    };
  }

  const { data: jobReports } = await supabase
    .from("reports")
    .select("id")
    .eq("job_id", id);

  const reportIds = (jobReports ?? []).map((r) => r.id);
  if (reportIds.length > 0) {
    const { data: invReports } = await supabase
      .from("invoice_reports")
      .select("invoice:invoices(id, invoice_no, number, status, issued_at)")
      .in("report_id", reportIds);

    const linkedIssued = (invReports ?? [])
      .map(
        (ir) =>
          ir.invoice as unknown as {
            id: string;
            invoice_no: string | null;
            number: string | null;
            status: string;
            issued_at: string | null;
          } | null,
      )
      .filter((inv): inv is NonNullable<typeof inv> => Boolean(inv))
      .filter(
        (inv) =>
          inv.status !== "cancelled" &&
          (inv.issued_at !== null ||
            ["issued", "partly_paid", "partially_paid", "paid"].includes(
              inv.status,
            )),
      );

    if (linkedIssued.length > 0) {
      const invNo =
        linkedIssued[0].invoice_no ||
        linkedIssued[0].number ||
        "issued invoice";
      return {
        ok: false,
        error: `Cannot delete job: an issued invoice (${invNo}) is linked to reports of this job. Cancel by credit note first.`,
      };
    }
  }

  return softDeleteRecord(supabase, "jobs", id);
}

export async function restoreJobRecord(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return restoreRecord(supabase, "jobs", id);
}

type TaxInvoiceSettlementRow = {
  id: string;
  kind: Enums<"invoice_kind">;
  status: string;
  total: number | null;
  balance: number | null;
  payments?: Array<{ amount: number | null; tds_amount: number | null }> | null;
  credit_notes?: Array<{ total: number | null; status: string | null }> | null;
};

function isTaxInvoiceFullyPaid(inv: TaxInvoiceSettlementRow): boolean {
  if (inv.kind !== "tax_invoice" || inv.status === "cancelled") return false;
  if (inv.status === "draft") return false;

  const balance = Number(inv.balance ?? 0);
  if (balance <= 0.005) return true;

  const total = Number(inv.total ?? 0);
  if (total <= 0) return false;

  const paidPlusTds = (inv.payments ?? []).reduce(
    (sum, p) => sum + Number(p.amount ?? 0) + Number(p.tds_amount ?? 0),
    0,
  );
  const credited = (inv.credit_notes ?? [])
    .filter((cn) => cn.status === "issued")
    .reduce((sum, cn) => sum + Number(cn.total ?? 0), 0);

  return paidPlusTds + credited >= total - 0.005;
}

/**
 * G4: Evaluates whether a job has every report marked `sent` AND every non-cancelled
 * tax invoice (direct or linked via `invoice_reports`) fully paid (amount + TDS + credit notes).
 * When both hold, moves the job to `closed` (`closed_at = now()`), which is logged in `audit_log`.
 */
export async function evaluateAndAutoCloseJob(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<{ closed: boolean; data: JobRow | null; error: string | null }> {
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !job) {
    return {
      closed: false,
      data: null,
      error: jobErr?.message ?? "Job not found.",
    };
  }

  if (job.status === "closed") {
    return { closed: false, data: job, error: null };
  }

  const { data: reports, error: repErr } = await supabase
    .from("reports")
    .select("id, status, sent_at")
    .eq("job_id", jobId);

  if (repErr) {
    return { closed: false, data: job, error: repErr.message };
  }

  const reportList = reports ?? [];
  if (
    reportList.length === 0 ||
    reportList.some((r) => r.status !== "sent" && !r.sent_at)
  ) {
    return { closed: false, data: job, error: null };
  }

  const { data: directInvoices, error: invErr } = await supabase
    .from("invoices")
    .select(
      "id, kind, status, total, balance, payments(amount, tds_amount), credit_notes(total, status)",
    )
    .eq("job_id", jobId)
    .eq("kind", "tax_invoice")
    .neq("status", "cancelled");

  if (invErr) {
    return { closed: false, data: job, error: invErr.message };
  }

  const invoiceMap = new Map<string, TaxInvoiceSettlementRow>();
  for (const inv of (directInvoices as unknown as TaxInvoiceSettlementRow[]) ?? []) {
    if (inv.kind === "tax_invoice" && inv.status !== "cancelled") {
      invoiceMap.set(inv.id, inv);
    }
  }

  const reportIds = reportList.map((r) => r.id);
  if (reportIds.length > 0) {
    const { data: joinedRows } = await supabase
      .from("invoice_reports")
      .select(
        "invoice:invoices(id, kind, status, total, balance, payments(amount, tds_amount), credit_notes(total, status))",
      )
      .in("report_id", reportIds);

    for (const row of joinedRows ?? []) {
      const inv = row.invoice as unknown as TaxInvoiceSettlementRow | null;
      if (inv && inv.kind === "tax_invoice" && inv.status !== "cancelled") {
        invoiceMap.set(inv.id, inv);
      }
    }
  }

  const taxInvoices = Array.from(invoiceMap.values());
  if (
    taxInvoices.length === 0 ||
    !taxInvoices.every((inv) => isTaxInvoiceFullyPaid(inv))
  ) {
    return { closed: false, data: job, error: null };
  }

  const { data: closedJob, error: closeErr } = await supabase
    .from("jobs")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .select("*")
    .single();

  if (closeErr || !closedJob) {
    return {
      closed: false,
      data: job,
      error: closeErr?.message ?? "Could not close job.",
    };
  }

  return { closed: true, data: closedJob, error: null };
}

/**
 * Evaluates and auto-closes all jobs linked to a given invoice (both `invoices.job_id`
 * and any jobs whose reports are linked via `invoice_reports`).
 */
export async function evaluateAndAutoCloseJobsForInvoice(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
): Promise<string[]> {
  const [{ data: inv }, { data: joined }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, job_id")
      .eq("id", invoiceId)
      .maybeSingle(),
    supabase
      .from("invoice_reports")
      .select("reports(job_id)")
      .eq("invoice_id", invoiceId),
  ]);

  const jobIds = new Set<string>();
  if (inv?.job_id) jobIds.add(inv.job_id);
  for (const row of joined ?? []) {
    const rep = row.reports as unknown as { job_id: string } | null;
    if (rep?.job_id) jobIds.add(rep.job_id);
  }

  const closedJobIds: string[] = [];
  for (const jobId of jobIds) {
    const res = await evaluateAndAutoCloseJob(supabase, jobId);
    if (res.closed) {
      closedJobIds.push(jobId);
    }
  }
  return closedJobIds;
}

/**
 * G4: Manual Close job action.
 * - Management can close a job at any time.
 * - Office staff can close a job when all reports are sent and all non-cancelled tax invoices are paid.
 * Logged in `audit_log` via `audit_jobs` trigger.
 */
export async function closeJobRecord(
  supabase: SupabaseClient<Database>,
  jobId: string,
  callerRoles?: readonly Enums<"app_role">[],
): Promise<{ data: JobRow | null; error: string | null }> {
  const isManagement = Boolean(callerRoles?.includes("management"));
  const isOffice = Boolean(callerRoles?.includes("office"));
  if (!isManagement && !isOffice) {
    return {
      data: null,
      error: "Only management or office staff can close a job.",
    };
  }

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !job) {
    return { data: null, error: jobErr?.message ?? "Job not found." };
  }

  if (job.status === "closed") {
    return { data: job, error: null };
  }

  if (!isManagement) {
    const autoRes = await evaluateAndAutoCloseJob(supabase, jobId);
    if (!autoRes.closed) {
      return {
        data: null,
        error:
          autoRes.error ??
          "Job can only be closed once the report is sent and every tax invoice is fully paid (or ask Management to close manually).",
      };
    }
    return { data: autoRes.data, error: null };
  }

  const { data: closedJob, error: closeErr } = await supabase
    .from("jobs")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .select("*")
    .single();

  if (closeErr || !closedJob) {
    return {
      data: null,
      error: closeErr?.message ?? "Could not close job.",
    };
  }

  return { data: closedJob, error: null };
}

/**
 * G4: Manual Reopen job action for management.
 * Restores `closed_at = null` and sets `status` to the appropriate stage based on existing invoices/reports/inspections.
 * Logged in `audit_log` via `audit_jobs` trigger.
 */
export async function reopenJobRecord(
  supabase: SupabaseClient<Database>,
  jobId: string,
  callerRoles?: readonly Enums<"app_role">[],
): Promise<{ data: JobRow | null; error: string | null }> {
  const isManagement = Boolean(callerRoles?.includes("management"));
  if (!isManagement) {
    return {
      data: null,
      error: "Only management can reopen a closed job.",
    };
  }

  const [jobRes, reportsRes, invoicesRes, inspectionsRes] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("reports").select("id, status, sent_at").eq("job_id", jobId),
    supabase
      .from("invoices")
      .select("id, kind, status")
      .eq("job_id", jobId)
      .neq("status", "cancelled"),
    supabase.from("inspections").select("id, submitted_at").eq("job_id", jobId),
  ]);

  if (jobRes.error || !jobRes.data) {
    return { data: null, error: jobRes.error?.message ?? "Job not found." };
  }

  const reports = reportsRes.data ?? [];
  const invoices = invoicesRes.data ?? [];
  const inspections = inspectionsRes.data ?? [];

  let nextStatus: Enums<"job_status"> = "scheduled";
  const hasIssuedInvoice = invoices.some((inv) =>
    ["issued", "partly_paid", "partially_paid", "paid"].includes(
      inv.status ?? "",
    ),
  );
  const hasSentReport =
    reports.length > 0 &&
    reports.every((r) => r.status === "sent" || Boolean(r.sent_at));

  if (hasIssuedInvoice) {
    nextStatus = "invoiced";
  } else if (hasSentReport) {
    nextStatus = "report_sent";
  } else if (reports.length > 0) {
    nextStatus = "report_in_review";
  } else if (inspections.some((i) => Boolean(i.submitted_at))) {
    nextStatus = "inspection_done";
  }

  const { data: reopened, error: reopenErr } = await supabase
    .from("jobs")
    .update({
      status: nextStatus,
      closed_at: null,
    })
    .eq("id", jobId)
    .select("*")
    .single();

  if (reopenErr || !reopened) {
    return {
      data: null,
      error: reopenErr?.message ?? "Could not reopen job.",
    };
  }

  return { data: reopened, error: null };
}
