import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Tables } from "../../db/types";
import { restoreRecord, softDeleteRecord } from "../recycle-bin/service";
import { hasPermissionForRoles } from "../settings/service";
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
  if (callerRoles && callerRoles.length > 0) {
    const allowed = await hasPermissionForRoles(supabase, callerRoles, "delete");
    if (!allowed) {
      return {
        ok: false,
        error: "Permission denied: your role is not permitted to delete records.",
      };
    }
  }

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
