import { createClient as createSupabaseAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Tables } from "../../db/types";
import { loadReportApprovalAssets } from "../../reports/branding.server";
import { generateReportDocxBytes } from "../../reports/docx";
import {
  type BookedJobEquipmentItem,
  checkReportReadiness,
  extractReadings,
  generateReportPdfBytes,
  generateSignedReportPdfBytes,
  parseRecipients,
  prefillReadingsFromBookedEquipment,
  reportPdfStoragePath,
  supportedMethod,
  validUuid,
} from "../../reports/review";
import type { ReportDocument } from "../../../templates/reports/types";
import {
  isReportInvoicePending,
  loadActiveInvoiceReportMap,
} from "../invoices/service";
import { evaluateAndAutoCloseJob } from "../jobs/service";
import type { ApproveReportInput } from "./schema";

export type ReportRow = Tables<"reports">;

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseAdminClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loadBookedJobEquipmentForReport(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<BookedJobEquipmentItem[]> {
  const { data: assigns } = await supabase
    .from("assignments")
    .select(
      `
      work_date,
      assignment_equipment(
        equipment:equipment!assignment_equipment_equipment_id_fkey(
          id,
          make,
          model,
          serial_no,
          calibration_due
        )
      )
    `,
    )
    .eq("job_id", jobId)
    .order("work_date", { ascending: true });

  type AssignRow = {
    work_date: string;
    assignment_equipment: Array<{
      equipment: {
        id: string;
        make: string | null;
        model: string | null;
        serial_no: string | null;
        calibration_due: string | null;
      } | null;
    }>;
  };

  const seen = new Set<string>();
  const items: BookedJobEquipmentItem[] = [];

  for (const a of (assigns as unknown as AssignRow[]) ?? []) {
    for (const ae of a.assignment_equipment ?? []) {
      const eq = ae.equipment;
      if (!eq || seen.has(eq.id)) continue;
      seen.add(eq.id);
      const isExpired = Boolean(
        eq.calibration_due && eq.calibration_due < a.work_date,
      );
      items.push({
        id: eq.id,
        make: eq.make,
        model: eq.model,
        serial_no: eq.serial_no,
        calibration_due: eq.calibration_due,
        work_date: a.work_date,
        is_expired_on_work_date: isExpired,
      });
    }
  }
  return items;
}

export async function listReports(
  supabase: SupabaseClient<Database>,
  opts?: {
    status?: string | null;
    invoicePending?: boolean;
    jobId?: string | null;
    method?: string | null;
  },
): Promise<{
  data: Array<Record<string, unknown> & { invoice_pending: boolean }>;
  error: string | null;
}> {
  let query = supabase
    .from("reports")
    .select("*, jobs(id, job_no, customer_id, customers(id, name, gstin))")
    .order("report_date", { ascending: false });

  if (opts?.status && opts.status !== "all" && opts.status !== "invoice_pending") {
    query = query.eq("status", opts.status as Enums<"report_status">);
  }
  if (opts?.jobId) {
    query = query.eq("job_id", opts.jobId);
  }
  if (opts?.method && opts.method !== "all") {
    query = query.eq("method", opts.method as Enums<"test_method">);
  }

  const [{ data, error }, activeInvoiceMap] = await Promise.all([
    query,
    loadActiveInvoiceReportMap(supabase),
  ]);

  if (error) return { data: [], error: error.message };

  const enriched = (data ?? []).map((r) => ({
    ...r,
    invoice_pending: isReportInvoicePending(r, activeInvoiceMap),
  }));

  const wantInvoicePending =
    Boolean(opts?.invoicePending) || opts?.status === "invoice_pending";

  return {
    data: wantInvoicePending
      ? enriched.filter((r) => r.invoice_pending)
      : enriched,
    error: null,
  };
}

export async function getReportDetail(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{
  data: (Record<string, unknown> & { invoice_pending: boolean }) | null;
  error: string | null;
}> {
  const [{ data, error }, activeInvoiceMap] = await Promise.all([
    supabase
      .from("reports")
      .select(
        "*, jobs(id, job_no, site, scope, customer_id, customers(id, name, gstin, billing_address)), inspections(*)",
      )
      .eq("id", id)
      .maybeSingle(),
    loadActiveInvoiceReportMap(supabase),
  ]);

  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: null };

  return {
    data: {
      ...data,
      invoice_pending: isReportInvoicePending(data, activeInvoiceMap),
    },
    error: null,
  };
}

export async function approveReportRecord(
  supabase: SupabaseClient<Database>,
  reportId: string,
  actor: { id: string; roles: readonly Enums<"app_role">[] },
  input: ApproveReportInput = {
    signatory_id: null,
    calibration_override_note: null,
  },
): Promise<{ data: ReportRow | null; error: string | null }> {
  if (!validUuid(reportId)) {
    return { data: null, error: "Invalid report ID." };
  }
  if (!actor.roles.includes("reviewer")) {
    return {
      data: null,
      error:
        "Only a technical reviewer can approve a report (AGENTS.md rule 6). Add the Reviewer role in Settings -> Users if needed.",
    };
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) return { data: null, error: "Report not found." };
  if (!["in_review", "draft"].includes(report.status)) {
    return { data: null, error: "This report is not waiting for approval." };
  }

  const [inspectionRes, jobRes, bookedEquipment] = await Promise.all([
    report.inspection_id
      ? supabase
          .from("inspections")
          .select("*")
          .eq("id", report.inspection_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("jobs")
      .select("id, job_no, customers(name)")
      .eq("id", report.job_id)
      .maybeSingle(),
    loadBookedJobEquipmentForReport(supabase, report.job_id),
  ]);

  const inspection = inspectionRes.data;
  const job = jobRes.data;
  const readings = prefillReadingsFromBookedEquipment(
    extractReadings(report.content, inspection?.readings),
    bookedEquipment,
  );
  const readiness = checkReportReadiness(report.method, inspection, readings);
  if (!readiness.ready) {
    return { data: null, error: readiness.blockers.join(" ") };
  }

  const expiredEquipment = bookedEquipment.filter(
    (e) => e.is_expired_on_work_date,
  );
  const calibrationOverrideNote =
    input.calibration_override_note ?? report.calibration_override_note ?? null;

  if (
    expiredEquipment.length > 0 &&
    (!calibrationOverrideNote || !calibrationOverrideNote.trim())
  ) {
    const firstExp = expiredEquipment[0]!;
    const label = [firstExp.make, firstExp.model, firstExp.serial_no]
      .filter(Boolean)
      .join(" ");
    return {
      data: null,
      error: `Booked equipment ${label} had expired calibration (due ${firstExp.calibration_due}) on work date ${firstExp.work_date}. Enter a calibration override reason to approve this report.`,
    };
  }

  const chosenSignatory =
    input.signatory_id || report.signatory_id || actor.id;
  if (!validUuid(chosenSignatory)) {
    return { data: null, error: "Choose a valid signatory." };
  }

  const approvedAt = new Date().toISOString();
  const storagePath = reportPdfStoragePath(report.job_id, report.report_no);

  const assets = await loadReportApprovalAssets(supabase, {
    approved: true,
    approvedAt,
    signatoryId: chosenSignatory,
    approvedBy: actor.id,
  });

  if (assets.approval.approved) {
    const pdfBytes = generateSignedReportPdfBytes({
      reportNo: report.report_no,
      reportDate: report.report_date,
      method: report.method,
      jobNo: job?.job_no ?? report.job_id,
      customerName:
        job?.customers?.name ?? String(readings.client ?? "Customer"),
      readings,
      letterhead: assets.letterhead,
      approval: assets.approval,
    });

    const storageClient = getServiceClient() ?? supabase;
    await storageClient.storage.from("reports").upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  }

  const { data: updated, error } = await supabase
    .from("reports")
    .update({
      status: "approved",
      reviewed_by: actor.id,
      approved_by: actor.id,
      approved_at: approvedAt,
      signatory_id: chosenSignatory,
      pdf_path: storagePath,
      ...(calibrationOverrideNote && calibrationOverrideNote.trim()
        ? {
            calibration_override_note: calibrationOverrideNote.trim(),
            calibration_override_by: actor.id,
          }
        : {}),
    })
    .eq("id", report.id)
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };
  return { data: updated, error: null };
}

export async function returnReportRecord(
  supabase: SupabaseClient<Database>,
  reportId: string,
  actor: { id: string; full_name: string },
  note: string,
): Promise<{ data: ReportRow | null; error: string | null }> {
  if (!validUuid(reportId)) {
    return { data: null, error: "Invalid report ID." };
  }
  const trimmedNote = note.trim();
  if (!trimmedNote) {
    return {
      data: null,
      error: "Enter a clear note explaining what the technician needs to correct.",
    };
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) return { data: null, error: "Report not found." };
  if (report.status === "sent") {
    return { data: null, error: "A sent report cannot be returned." };
  }

  const { data: updated, error } = await supabase
    .from("reports")
    .update({
      status: "returned",
      reviewed_by: actor.id,
      approved_by: null,
      approved_at: null,
      pdf_path: null,
    })
    .eq("id", report.id)
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };

  await supabase
    .from("jobs")
    .update({ status: "inspection_done" })
    .eq("id", report.job_id)
    .eq("status", "report_in_review");

  let targetTechnicianId: string | null = null;
  if (report.inspection_id) {
    const { data: insp } = await supabase
      .from("inspections")
      .select("submitted_by")
      .eq("id", report.inspection_id)
      .maybeSingle();
    targetTechnicianId = insp?.submitted_by ?? null;
  }
  if (!targetTechnicianId) {
    const { data: assign } = await supabase
      .from("assignments")
      .select("person_id")
      .eq("job_id", report.job_id)
      .limit(1)
      .maybeSingle();
    targetTechnicianId = assign?.person_id ?? null;
  }

  if (targetTechnicianId) {
    await supabase.from("technician_messages").insert({
      person_id: targetTechnicianId,
      job_id: report.job_id,
      kind: "other",
      message: `Report ${report.report_no} returned by ${actor.full_name}: ${trimmedNote}`,
    });
  }

  return { data: updated, error: null };
}

/**
 * Marks an approved report as `sent` (`sent_at = now()`, `sent_to = emails`),
 * advances the job status to `report_sent` if still in pre-invoice stage,
 * and (G4) automatically closes the job if all its non-cancelled tax invoices are already fully paid.
 */
export async function markReportSentRecord(
  supabase: SupabaseClient<Database>,
  reportId: string,
  recipientsInput: string | readonly string[],
): Promise<{
  data: ReportRow | null;
  jobClosed: boolean;
  error: string | null;
}> {
  if (!validUuid(reportId)) {
    return { data: null, jobClosed: false, error: "Invalid report ID." };
  }

  let emails: string[];
  try {
    const raw =
      typeof recipientsInput === "string"
        ? recipientsInput
        : recipientsInput.join(", ");
    emails = parseRecipients(raw);
  } catch (err) {
    return {
      data: null,
      jobClosed: false,
      error:
        err instanceof Error
          ? err.message
          : "Enter valid recipient email addresses.",
    };
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    return { data: null, jobClosed: false, error: "Report not found." };
  }
  if (!report.approved_at || !["approved", "sent"].includes(report.status)) {
    return {
      data: null,
      jobClosed: false,
      error:
        "Report must be approved by a technical reviewer before marking it as sent.",
    };
  }

  const sentAt = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("reports")
    .update({
      status: "sent",
      sent_at: sentAt,
      sent_to: emails,
    })
    .eq("id", report.id)
    .select("*")
    .single();

  if (error || !updated) {
    return {
      data: null,
      jobClosed: false,
      error: error?.message ?? "Could not mark report as sent.",
    };
  }

  await supabase
    .from("jobs")
    .update({ status: "report_sent" })
    .eq("id", report.job_id)
    .in("status", ["scheduled", "inspection_done", "report_in_review"]);

  // G4: If all non-cancelled tax invoices of this job are already paid, auto-close the job
  const closeRes = await evaluateAndAutoCloseJob(supabase, report.job_id);

  return {
    data: updated,
    jobClosed: closeRes.closed,
    error: null,
  };
}

export async function generateReportPdfDownload(
  supabase: SupabaseClient<Database>,
  reportId: string,
): Promise<
  | { ok: true; bytes: Uint8Array; filename: string }
  | { ok: false; status: number; error: string }
> {
  if (!validUuid(reportId)) {
    return { ok: false, status: 400, error: "Invalid report ID" };
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    return { ok: false, status: 404, error: "Report not found" };
  }

  const isApproved =
    (report.status === "approved" || report.status === "sent") &&
    !!report.approved_at;
  const safeFileName =
    report.report_no.replace(/[^A-Za-z0-9._-]+/g, "-") +
    (isApproved ? ".pdf" : "-draft.pdf");

  if (isApproved) {
    const storagePath =
      report.pdf_path || reportPdfStoragePath(report.job_id, report.report_no);
    const { data: storedBlob } = await supabase.storage
      .from("reports")
      .download(storagePath);

    if (storedBlob && storedBlob.size > 0) {
      const ab = await storedBlob.arrayBuffer();
      return { ok: true, bytes: new Uint8Array(ab), filename: safeFileName };
    }
  }

  const [inspectionRes, jobRes, attachmentsRes] = await Promise.all([
    report.inspection_id
      ? supabase
          .from("inspections")
          .select("readings")
          .eq("id", report.inspection_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("jobs")
      .select("job_no, customers(name)")
      .eq("id", report.job_id)
      .maybeSingle(),
    supabase
      .from("attachments")
      .select("kind, caption, storage_path")
      .eq("job_id", report.job_id)
      .eq("include_in_report", true)
      .order("uploaded_at", { ascending: true }),
  ]);

  const readings = extractReadings(report.content, inspectionRes.data?.readings);
  const attachments = attachmentsRes.data ?? [];
  const assets = await loadReportApprovalAssets(supabase, {
    approved: isApproved,
    approvedAt: report.approved_at,
    signatoryId: report.signatory_id,
    approvedBy: report.approved_by,
  });

  const pdfBytes = generateReportPdfBytes({
    reportNo: report.report_no,
    reportDate: report.report_date,
    method: report.method,
    jobNo: jobRes.data?.job_no ?? report.job_id,
    customerName:
      jobRes.data?.customers?.name ?? String(readings.client ?? "Customer"),
    readings,
    letterhead: assets.letterhead,
    approval: assets.approval,
    attachments: attachments.map((a) => ({
      kind: a.kind,
      caption: a.caption,
      storagePath: a.storage_path,
    })),
  });

  return { ok: true, bytes: pdfBytes, filename: safeFileName };
}

export async function generateReportDocxDownload(
  supabase: SupabaseClient<Database>,
  reportId: string,
): Promise<
  | { ok: true; bytes: Uint8Array; filename: string }
  | { ok: false; status: number; error: string }
> {
  if (!validUuid(reportId)) {
    return { ok: false, status: 400, error: "Invalid report ID" };
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    return { ok: false, status: 404, error: "Report not found" };
  }

  if (!supportedMethod(report.method)) {
    return {
      ok: false,
      status: 400,
      error: "Word (.docx) layout is available for UT, MPT, and DPT reports.",
    };
  }

  const [inspectionRes, attachmentsRes] = await Promise.all([
    report.inspection_id
      ? supabase
          .from("inspections")
          .select("readings")
          .eq("id", report.inspection_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("attachments")
      .select("kind, caption, storage_path")
      .eq("job_id", report.job_id)
      .eq("include_in_report", true)
      .order("uploaded_at", { ascending: true }),
  ]);

  const isApproved =
    (report.status === "approved" || report.status === "sent") &&
    !!report.approved_at;
  const readings = extractReadings(report.content, inspectionRes.data?.readings);
  const attachments = attachmentsRes.data ?? [];

  const assets = await loadReportApprovalAssets(supabase, {
    approved: isApproved,
    approvedAt: report.approved_at,
    signatoryId: report.signatory_id,
    approvedBy: report.approved_by,
  });

  const doc: ReportDocument = {
    reportNumber: report.report_no,
    reportDate: report.report_date,
    letterhead: assets.letterhead,
    readings,
    approval: assets.approval,
    attachments: attachments.map((a) => ({
      kind: a.kind,
      caption: a.caption,
      storagePath: a.storage_path,
    })),
  };

  const docxBytes = await generateReportDocxBytes(report.method, doc);
  const safeFileName =
    report.report_no.replace(/[^A-Za-z0-9._-]+/g, "-") + ".docx";

  return { ok: true, bytes: docxBytes, filename: safeFileName };
}
