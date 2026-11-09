import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "../../db/types";
import {
  evaluatePoValueWarning,
  type AcceptQuotationInput,
  type PoFieldsInput,
  type PoValueCheck,
} from "./schema";

export async function saveJobPoFile(
  supabase: SupabaseClient<Database>,
  jobId: string,
  file: File | null | undefined,
): Promise<{ path: string | null; error: string | null }> {
  if (!file || !(file instanceof File) || file.size === 0) {
    return { path: null, error: null };
  }
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const path = `po/${jobId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) {
    return { path: null, error: error.message };
  }

  const { error: updateErr } = await supabase
    .from("jobs")
    .update({ po_path: path })
    .eq("id", jobId);

  if (updateErr) {
    return { path: null, error: updateErr.message };
  }
  return { path, error: null };
}

export async function acceptQuotationAndRecordPo(
  supabase: SupabaseClient<Database>,
  quotationId: string,
  actor: { id: string; roles: readonly Enums<"app_role">[] },
  input: AcceptQuotationInput,
  poFile?: File | null,
): Promise<{
  ok: true;
  quotationId: string;
  jobId: string | null;
  jobNo: string | null;
  fileError: string | null;
} | {
  ok: false;
  error: string;
}> {
  const { data: existing, error: fetchErr } = await supabase
    .from("quotations")
    .select("id, customer_id, enquiry_id, subject, approved_at, approved_by")
    .eq("id", quotationId)
    .maybeSingle();

  if (fetchErr || !existing) {
    return { ok: false, error: fetchErr?.message ?? "Quotation not found." };
  }

  let approvalPatch: { approved_by?: string; approved_at?: string } = {};
  if (!existing.approved_at) {
    if (!actor.roles.includes("management")) {
      return { ok: false, error: "Only management can mark a quotation as accepted." };
    }
    approvalPatch = {
      approved_by: actor.id,
      approved_at: new Date().toISOString(),
    };
  }

  const { error: updErr } = await supabase
    .from("quotations")
    .update({
      status: "accepted",
      superseded_by: null,
      ...approvalPatch,
    })
    .eq("id", quotationId);

  if (updErr) {
    return { ok: false, error: updErr.message };
  }

  const hasPoData = Boolean(
    input.po_number || input.po_date || input.po_value !== null || (poFile && poFile.size > 0),
  );
  const shouldEnsureJob = input.create_job || hasPoData;

  // Check if a job already exists for this quotation
  const { data: existingJobs } = await supabase
    .from("jobs")
    .select("id, job_no, po_number, po_date, po_value")
    .eq("quotation_id", quotationId)
    .order("created_at", { ascending: false })
    .limit(1);

  let jobId: string | null = existingJobs?.[0]?.id ?? null;
  let jobNo: string | null = existingJobs?.[0]?.job_no ?? null;

  if (jobId) {
    if (hasPoData || input.site || input.scope) {
      const patch: Database["public"]["Tables"]["jobs"]["Update"] = {};
      if (input.po_number !== null) patch.po_number = input.po_number;
      if (input.po_date !== null) patch.po_date = input.po_date;
      if (input.po_value !== null) patch.po_value = input.po_value;
      if (input.site !== null) patch.site = input.site;
      if (input.scope !== null) patch.scope = input.scope;

      if (Object.keys(patch).length > 0) {
        const { error: jobUpdErr } = await supabase.from("jobs").update(patch).eq("id", jobId);
        if (jobUpdErr) return { ok: false, error: jobUpdErr.message };
      }
    }
  } else if (shouldEnsureJob) {
    const resolvedScope = input.scope ?? existing.subject ?? null;
    const upperScope = (resolvedScope || "").toUpperCase();
    const inferredMethods: Enums<"test_method">[] = [];
    if (/\bUT\b|ULTRASONIC/.test(upperScope)) inferredMethods.push("UT");
    if (/\bMPT\b|\bMT\b|\bMPI\b|MAGNETIC/.test(upperScope)) inferredMethods.push("MPT");
    if (/\bDPT\b|\bPT\b|\bLPI\b|PENETRANT/.test(upperScope)) inferredMethods.push("DPT");
    if (inferredMethods.length === 0) inferredMethods.push("UT");

    const { data: createdJob, error: jobCreateErr } = await supabase
      .from("jobs")
      .insert({
        customer_id: existing.customer_id,
        enquiry_id: existing.enquiry_id,
        quotation_id: quotationId,
        scope: resolvedScope,
        site: input.site ?? null,
        test_methods: inferredMethods,
        po_number: input.po_number,
        po_date: input.po_date,
        po_value: input.po_value,
      })
      .select("id, job_no")
      .single();

    if (jobCreateErr || !createdJob) {
      return { ok: false, error: jobCreateErr?.message ?? "Could not create job for accepted quotation." };
    }

    jobId = createdJob.id;
    jobNo = createdJob.job_no;

    if (existing.enquiry_id) {
      await supabase
        .from("enquiries")
        .update({ status: "converted" })
        .eq("id", existing.enquiry_id);
    }
  }

  let fileError: string | null = null;
  if (jobId && poFile && poFile.size > 0) {
    const fileRes = await saveJobPoFile(supabase, jobId, poFile);
    fileError = fileRes.error;
  }

  return {
    ok: true,
    quotationId,
    jobId,
    jobNo,
    fileError,
  };
}

export async function updateJobPoFields(
  supabase: SupabaseClient<Database>,
  jobId: string,
  input: PoFieldsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("jobs")
    .update({
      po_number: input.po_number,
      po_date: input.po_date,
      po_value: input.po_value,
    })
    .eq("id", jobId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Computes PO value utilization across all non-cancelled invoices for the given job/PO.
 * If `excludeInvoiceId` is provided, its total is excluded from `otherInvoicesTotal`
 * and `currentInvoiceTotal` is used as the current invoice's contribution.
 */
export async function checkPoUtilization(
  supabase: SupabaseClient<Database>,
  params: {
    jobId: string;
    customerId?: string | null;
    poNumber?: string | null;
    poValue?: number | null;
    excludeInvoiceId?: string | null;
    currentInvoiceTotal?: number | null;
  },
): Promise<PoValueCheck> {
  let poNumber = params.poNumber ?? null;
  let poValue = params.poValue ?? null;
  let customerId = params.customerId ?? null;

  if (poValue === undefined || poValue === null || !customerId) {
    const { data: job } = await supabase
      .from("jobs")
      .select("customer_id, po_number, po_value")
      .eq("id", params.jobId)
      .maybeSingle();

    if (job) {
      customerId = customerId ?? job.customer_id;
      if (!poNumber) poNumber = job.po_number;
      if (poValue === null || poValue === undefined) poValue = job.po_value;
    }
  }

  // If the user changed the PO number on the invoice to another PO of the same customer,
  // check if a job for that customer has a `po_value` recorded for that `po_number`.
  if (poNumber && customerId && (poValue === null || poValue === undefined)) {
    const { data: matchingJobs } = await supabase
      .from("jobs")
      .select("po_value")
      .eq("customer_id", customerId)
      .eq("po_number", poNumber)
      .not("po_value", "is", null)
      .limit(1);
    if (matchingJobs && matchingJobs.length > 0) {
      poValue = matchingJobs[0]!.po_value;
    }
  }

  // Gather all non-cancelled invoices for this PO (or this job when PO number is blank)
  let otherInvoicesTotal = 0;

  if (poNumber && customerId) {
    // Find all jobs of this customer that share this po_number
    const { data: customerJobs } = await supabase
      .from("jobs")
      .select("id, po_number, po_value")
      .eq("customer_id", customerId);

    const jobIdsWithSamePo = new Set(
      (customerJobs ?? [])
        .filter((j) => j.po_number === poNumber)
        .map((j) => j.id),
    );
    jobIdsWithSamePo.add(params.jobId);

    if (poValue === null || poValue === undefined) {
      const jobWithVal = (customerJobs ?? []).find(
        (j) => j.po_number === poNumber && j.po_value !== null,
      );
      if (jobWithVal) poValue = jobWithVal.po_value;
    }

    const allCustomerJobIds = (customerJobs ?? []).map((j) => j.id);
    if (allCustomerJobIds.length > 0) {
      const { data: invRows } = await supabase
        .from("invoices")
        .select("id, job_id, customer_po_number, total, status")
        .in("job_id", allCustomerJobIds)
        .neq("status", "cancelled");

      for (const inv of invRows ?? []) {
        if (params.excludeInvoiceId && inv.id === params.excludeInvoiceId) continue;
        const invPo: string | null = inv.customer_po_number ?? null;
        const effectivePo: string | null = invPo || (jobIdsWithSamePo.has(inv.job_id) ? poNumber : null);
        if (effectivePo === poNumber) {
          otherInvoicesTotal += Number(inv.total) || 0;
        }
      }
    }
  } else {
    const { data: invRows } = await supabase
      .from("invoices")
      .select("id, total, status")
      .eq("job_id", params.jobId)
      .neq("status", "cancelled");

    for (const inv of invRows ?? []) {
      if (params.excludeInvoiceId && inv.id === params.excludeInvoiceId) continue;
      otherInvoicesTotal += Number(inv.total) || 0;
    }
  }

  return evaluatePoValueWarning({
    poNumber,
    poValue,
    otherInvoicesTotal,
    currentInvoiceTotal: params.currentInvoiceTotal ?? 0,
  });
}
