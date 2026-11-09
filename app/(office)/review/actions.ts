"use server";

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import type { Database } from "@/lib/db/types";
import { text } from "@/lib/forms";
import { loadReportApprovalAssets } from "@/lib/reports/branding.server";
import { missingFields } from "@/lib/reports/fields";
import {
  type BookedJobEquipmentItem,
  buildReportContent,
  checkReportReadiness,
  extractReadings,
  friendlyReportError,
  generateSignedReportPdfBytes,
  parseEditedReportReadings,
  parseRecipients,
  prefillReadingsFromBookedEquipment,
  reportPdfStoragePath,
  supportedMethod,
  validUuid,
} from "@/lib/reports/review";

async function loadBookedJobEquipment(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  jobId: string
): Promise<BookedJobEquipmentItem[]> {
  const { data: assigns } = await supabase
    .from("assignments")
    .select(`
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
    `)
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
      const isExpired = Boolean(eq.calibration_due && eq.calibration_due < a.work_date);
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

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseAdminClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function redirectError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(friendlyReportError(message))}`);
}

function revalidateReportPaths(reportId: string, jobId?: string) {
  revalidatePath("/review");
  revalidatePath(`/review/${reportId}`);
  revalidatePath(`/review/${reportId}/history`);
  revalidatePath("/dashboard");
  revalidatePath("/office");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

export async function prepareReport(fd: FormData) {
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const inspectionId = text(fd, "inspection_id") ?? "";
  const reportNo = text(fd, "report_no") ?? "";
  const reportDate = text(fd, "report_date") ?? new Date().toISOString().slice(0, 10);
  const signatoryId = text(fd, "signatory_id");

  if (!validUuid(inspectionId)) {
    redirectError("/review", "Choose a submitted inspection to prepare a report.");
  }
  if (!reportNo.trim()) {
    redirectError("/review", "Enter the BITA report number.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    redirectError("/review", "Enter a valid report date (YYYY-MM-DD).");
  }
  if (signatoryId && !validUuid(signatoryId)) {
    redirectError("/review", "Choose a valid signatory.");
  }

  const { data: inspection, error: inspErr } = await supabase
    .from("inspections")
    .select("*")
    .eq("id", inspectionId)
    .maybeSingle();

  if (inspErr || !inspection) {
    redirectError("/review", inspErr?.message ?? "The selected inspection could not be found.");
  }

  try {
    reportPdfStoragePath(inspection.job_id, reportNo);
  } catch (err) {
    redirectError("/review", err instanceof Error ? err.message : "Invalid report number.");
  }

  const bookedEquipment = await loadBookedJobEquipment(supabase, inspection.job_id);
  const readings = prefillReadingsFromBookedEquipment(
    extractReadings(inspection.readings),
    bookedEquipment
  );
  const readiness = checkReportReadiness(inspection.method, inspection, readings);
  if (!readiness.ready) {
    redirectError("/review", readiness.blockers.join(" "));
  }

  const content = buildReportContent(readings, inspection.observations, inspection.submitted_at);

  const { data: created, error: insertErr } = await supabase
    .from("reports")
    .insert({
      job_id: inspection.job_id,
      inspection_id: inspection.id,
      method: inspection.method,
      report_no: reportNo.trim(),
      report_date: reportDate,
      content,
      status: "draft",
      prepared_by: person.id,
      signatory_id: signatoryId || null,
    })
    .select("id")
    .single();

  if (insertErr || !created) {
    redirectError("/review", insertErr?.message ?? "Could not prepare report.");
  }

  revalidateReportPaths(created.id, inspection.job_id);
  redirect(`/review/${created.id}?saved=prepared`);
}

export async function refreshReportFromInspection(reportId: string) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const path = `/review/${reportId}`;
  const { data: report } = await supabase
    .from("reports")
    .select("id, job_id, inspection_id, method, status")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) redirect("/review");
  if (!["draft", "returned"].includes(report.status)) {
    redirectError(path, "Only a draft or returned report can be refreshed from field data.");
  }
  if (!report.inspection_id) {
    redirectError(path, "No field inspection is linked to this report.");
  }

  const { data: inspection } = await supabase
    .from("inspections")
    .select("*")
    .eq("id", report.inspection_id)
    .maybeSingle();

  if (!inspection) {
    redirectError(path, "The linked field inspection could not be loaded.");
  }

  const bookedEquipment = await loadBookedJobEquipment(supabase, report.job_id);
  const readings = prefillReadingsFromBookedEquipment(
    extractReadings(inspection.readings),
    bookedEquipment
  );
  const readiness = checkReportReadiness(report.method, inspection, readings);
  if (!readiness.ready) {
    redirectError(path, readiness.blockers.join(" "));
  }

  const content = buildReportContent(readings, inspection.observations, inspection.submitted_at);
  const { error } = await supabase
    .from("reports")
    .update({
      content,
      status: "draft",
    })
    .eq("id", report.id);

  if (error) redirectError(path, error.message);

  revalidateReportPaths(report.id, report.job_id);
  redirect(`${path}?saved=refreshed`);
}

export async function updateReportContent(reportId: string, fd: FormData) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const path = `/review/${reportId}`;
  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) redirect("/review");
  if (report.approved_at || ["approved", "sent"].includes(report.status)) {
    redirectError(
      path,
      "An approved report cannot be edited. Return the report to unlock it first."
    );
  }

  const { data: inspection } = report.inspection_id
    ? await supabase
        .from("inspections")
        .select("*")
        .eq("id", report.inspection_id)
        .maybeSingle()
    : { data: null };

  const currentReadings = extractReadings(report.content, inspection?.readings);
  const editedReadings = parseEditedReportReadings(report.method, fd, currentReadings);
  const reportDateRaw = text(fd, "report_date");
  const reportDate =
    reportDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(reportDateRaw)
      ? reportDateRaw
      : report.report_date;

  const existingObj =
    report.content && typeof report.content === "object" && !Array.isArray(report.content)
      ? (report.content as Record<string, unknown>)
      : {};
  const observations =
    typeof existingObj.observations === "string"
      ? existingObj.observations
      : inspection?.observations ?? null;
  const submittedAt =
    typeof existingObj.submittedAt === "string"
      ? existingObj.submittedAt
      : inspection?.submitted_at ?? null;

  const updatedContent = buildReportContent(editedReadings, observations, submittedAt);

  if (report.inspection_id && supportedMethod(report.method)) {
    const newMissing = missingFields(report.method, editedReadings);
    const syncClient = getServiceClient() ?? supabase;
    await syncClient
      .from("inspections")
      .update({ missing_fields: newMissing })
      .eq("id", report.inspection_id);
  }

  const { error } = await supabase
    .from("reports")
    .update({
      content: updatedContent,
      report_date: reportDate,
    })
    .eq("id", report.id);

  if (error) redirectError(path, error.message);

  revalidateReportPaths(report.id, report.job_id);
  redirect(`${path}?saved=edited`);
}

export async function sendReportForReview(reportId: string) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const path = `/review/${reportId}`;
  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) redirect("/review");
  if (!["draft", "returned"].includes(report.status)) {
    redirectError(path, "Only a draft or returned report can be sent for technical review.");
  }

  const { data: inspection } = report.inspection_id
    ? await supabase.from("inspections").select("*").eq("id", report.inspection_id).maybeSingle()
    : { data: null };

  const readings = extractReadings(report.content, inspection?.readings);
  const readiness = checkReportReadiness(report.method, inspection, readings);
  if (!readiness.ready) {
    redirectError(path, readiness.blockers.join(" "));
  }

  const { error } = await supabase
    .from("reports")
    .update({ status: "in_review" })
    .eq("id", report.id);

  if (error) redirectError(path, error.message);

  await supabase
    .from("jobs")
    .update({ status: "report_in_review" })
    .eq("id", report.job_id)
    .in("status", ["scheduled", "inspection_done"]);

  revalidateReportPaths(report.id, report.job_id);
  redirect(`${path}?saved=in_review`);
}

export async function approveReport(reportId: string, fd: FormData) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const path = `/review/${reportId}`;
  if (!person.roles.includes("reviewer")) {
    redirectError(
      path,
      "Only a technical reviewer can approve a report (AGENTS.md rule 6). Add the Reviewer role in Settings -> Users if needed."
    );
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) redirect("/review");
  if (!["in_review", "draft"].includes(report.status)) {
    redirectError(path, "This report is not waiting for approval.");
  }

  const [inspectionRes, jobRes, bookedEquipment] = await Promise.all([
    report.inspection_id
      ? supabase.from("inspections").select("*").eq("id", report.inspection_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("jobs")
      .select("id, job_no, customers(name)")
      .eq("id", report.job_id)
      .maybeSingle(),
    loadBookedJobEquipment(supabase, report.job_id),
  ]);

  const inspection = inspectionRes.data;
  const job = jobRes.data;
  const readings = prefillReadingsFromBookedEquipment(
    extractReadings(report.content, inspection?.readings),
    bookedEquipment
  );
  const readiness = checkReportReadiness(report.method, inspection, readings);
  if (!readiness.ready) {
    redirectError(path, readiness.blockers.join(" "));
  }

  const expiredEquipment = bookedEquipment.filter((e) => e.is_expired_on_work_date);
  const calibrationOverrideNote =
    text(fd, "calibration_override_note") ?? report.calibration_override_note ?? null;

  if (expiredEquipment.length > 0 && (!calibrationOverrideNote || !calibrationOverrideNote.trim())) {
    const firstExp = expiredEquipment[0]!;
    const label = [firstExp.make, firstExp.model, firstExp.serial_no].filter(Boolean).join(" ");
    redirectError(
      path,
      `Booked equipment ${label} had expired calibration (due ${firstExp.calibration_due}) on work date ${firstExp.work_date}. Enter a calibration override reason to approve this report.`
    );
  }

  const chosenSignatory = text(fd, "signatory_id") || report.signatory_id || person.id;
  if (!validUuid(chosenSignatory)) {
    redirectError(path, "Choose a valid signatory.");
  }

  const approvedAt = new Date().toISOString();
  const storagePath = reportPdfStoragePath(report.job_id, report.report_no);

  const assets = await loadReportApprovalAssets(supabase, {
    approved: true,
    approvedAt,
    signatoryId: chosenSignatory,
    approvedBy: person.id,
  });

  if (assets.approval.approved) {
    const pdfBytes = generateSignedReportPdfBytes({
      reportNo: report.report_no,
      reportDate: report.report_date,
      method: report.method,
      jobNo: job?.job_no ?? report.job_id,
      customerName: job?.customers?.name ?? String(readings.client ?? "Customer"),
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

  const { error } = await supabase
    .from("reports")
    .update({
      status: "approved",
      reviewed_by: person.id,
      approved_by: person.id,
      approved_at: approvedAt,
      signatory_id: chosenSignatory,
      pdf_path: storagePath,
      ...(calibrationOverrideNote && calibrationOverrideNote.trim()
        ? {
            calibration_override_note: calibrationOverrideNote.trim(),
            calibration_override_by: person.id,
          }
        : {}),
    })
    .eq("id", report.id);

  if (error) redirectError(path, error.message);

  revalidateReportPaths(report.id, report.job_id);
  redirect(`${path}?saved=approved`);
}

export async function returnReportToTechnician(reportId: string, fd: FormData) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const path = `/review/${reportId}`;
  const note = text(fd, "note");
  if (!note) {
    redirectError(path, "Enter a clear note explaining what the technician needs to correct.");
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) redirect("/review");
  if (report.status === "sent") {
    redirectError(path, "A sent report cannot be returned.");
  }

  const { error } = await supabase
    .from("reports")
    .update({
      status: "returned",
      reviewed_by: person.id,
      approved_by: null,
      approved_at: null,
      pdf_path: null,
    })
    .eq("id", report.id);

  if (error) redirectError(path, error.message);

  await supabase
    .from("jobs")
    .update({ status: "inspection_done" })
    .eq("id", report.job_id)
    .eq("status", "report_in_review");

  // Notify the technician who submitted the inspection (or first assigned technician on the job)
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
      message: `Report ${report.report_no} returned by ${person.full_name}: ${note}`,
    });
  }

  revalidateReportPaths(report.id, report.job_id);
  redirect(`${path}?saved=returned`);
}

export async function markReportSent(reportId: string, fd: FormData) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const path = `/review/${reportId}`;
  const rawRecipients = text(fd, "sent_to") ?? "";
  let emails: string[];
  try {
    emails = parseRecipients(rawRecipients);
  } catch (err) {
    redirectError(path, err instanceof Error ? err.message : "Enter valid recipient email addresses.");
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) redirect("/review");
  if (!report.approved_at || !["approved", "sent"].includes(report.status)) {
    redirectError(path, "Report must be approved by a technical reviewer before marking it as sent.");
  }

  const sentAt = new Date().toISOString();
  const { error } = await supabase
    .from("reports")
    .update({
      status: "sent",
      sent_at: sentAt,
      sent_to: emails,
    })
    .eq("id", report.id);

  if (error) redirectError(path, error.message);

  await supabase
    .from("jobs")
    .update({ status: "report_sent" })
    .eq("id", report.job_id)
    .in("status", ["scheduled", "inspection_done", "report_in_review"]);

  revalidateReportPaths(report.id, report.job_id);
  redirect(`${path}?saved=sent`);
}

export async function toggleAttachmentInclude(
  reportId: string,
  attachmentId: string,
  include: boolean
) {
  if (!validUuid(reportId) || !validUuid(attachmentId)) redirect("/review");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const path = `/review/${reportId}`;
  const { error } = await supabase
    .from("attachments")
    .update({ include_in_report: include })
    .eq("id", attachmentId);

  if (error) redirectError(path, error.message);

  revalidatePath(path);
  redirect(`${path}?saved=photo`);
}
