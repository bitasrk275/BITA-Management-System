"use server";

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { Constants, type Database, type Enums } from "@/lib/db/types";
import { text } from "@/lib/forms";
import { parseApproveReportInput, parseReturnReportInput } from "@/lib/modules/reports/schema";
import {
  approveReportRecord,
  loadBookedJobEquipmentForReport,
  markReportSentRecord,
  returnReportRecord,
} from "@/lib/modules/reports/service";
import { missingFields } from "@/lib/reports/fields";
import { resolveFieldsForMethod } from "@/lib/modules/settings/templates";
import { buildJobReportPrefill, loadReportLookups, mergePrefill } from "@/lib/modules/reports/prefill";
import {
  buildReportContent,
  checkReportReadiness,
  extractReadings,
  friendlyReportError,
  parseEditedReportReadings,
  prefillReadingsFromBookedEquipment,
  reportPdfStoragePath,
  validUuid,
} from "@/lib/reports/review";

const loadBookedJobEquipment = loadBookedJobEquipmentForReport;

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

function revalidateReportPaths(reportId: string, jobId?: string | null) {
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
    redirectError("/review/new", "Choose a submitted inspection to prepare a report.");
  }
  if (!reportNo.trim()) {
    redirectError("/review/new", "Enter the BITA report number.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    redirectError("/review/new", "Enter a valid report date (YYYY-MM-DD).");
  }
  if (signatoryId && !validUuid(signatoryId)) {
    redirectError("/review/new", "Choose a valid signatory.");
  }

  const { data: inspection, error: inspErr } = await supabase
    .from("inspections")
    .select("*")
    .eq("id", inspectionId)
    .maybeSingle();

  if (inspErr || !inspection) {
    redirectError("/review/new", inspErr?.message ?? "The selected inspection could not be found.");
  }

  try {
    reportPdfStoragePath(inspection.job_id, reportNo);
  } catch (err) {
    redirectError("/review/new", err instanceof Error ? err.message : "Invalid report number.");
  }

  const [bookedEquipment, methodFields] = await Promise.all([
    loadBookedJobEquipment(supabase, inspection.job_id),
    resolveFieldsForMethod(supabase, inspection.method),
  ]);
  const [jobPrefill, lookups] = await Promise.all([
    buildJobReportPrefill(supabase, inspection.job_id, inspection.method),
    loadReportLookups(supabase, inspection.method),
  ]);
  const readings = mergePrefill(
    prefillReadingsFromBookedEquipment(extractReadings(inspection.readings), bookedEquipment),
    jobPrefill,
    lookups.technicians,
  );
  const readiness = checkReportReadiness(inspection.method, inspection, readings, methodFields);
  if (!readiness.ready) {
    redirectError("/review/new", readiness.blockers.join(" "));
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
    redirectError("/review/new", insertErr?.message ?? "Could not prepare report.");
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

  const [bookedEquipment, methodFields] = await Promise.all([
    report.job_id ? loadBookedJobEquipment(supabase, report.job_id) : Promise.resolve([]),
    resolveFieldsForMethod(supabase, report.method),
  ]);
  const readings = prefillReadingsFromBookedEquipment(
    extractReadings(inspection.readings),
    bookedEquipment
  );
  const readiness = checkReportReadiness(report.method, inspection, readings, methodFields);
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

  const methodFields = await resolveFieldsForMethod(supabase, report.method);
  const currentReadings = extractReadings(report.content, inspection?.readings);
  const editedReadings = parseEditedReportReadings(report.method, fd, currentReadings, methodFields);
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

  if (report.inspection_id) {
    const newMissing = missingFields(report.method, editedReadings, methodFields);
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
  if (!report.job_id) {
    redirectError(path, "Link this report to a job before sending it for review.");
  }

  const { data: inspection } = report.inspection_id
    ? await supabase.from("inspections").select("*").eq("id", report.inspection_id).maybeSingle()
    : { data: null };

  const methodFields = await resolveFieldsForMethod(supabase, report.method);
  const readings = extractReadings(report.content, inspection?.readings);
  const readiness = checkReportReadiness(report.method, inspection, readings, methodFields);
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
  const parsed = parseApproveReportInput(fd);
  const { data, error } = await approveReportRecord(
    supabase,
    reportId,
    { id: person.id, roles: person.roles },
    parsed,
  );

  if (error || !data) {
    redirectError(path, error ?? "Could not approve report.");
  }

  revalidateReportPaths(data.id, data.job_id);
  redirect(`${path}?saved=approved`);
}

export async function returnReportToTechnician(reportId: string, fd: FormData) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const path = `/review/${reportId}`;
  const parsed = parseReturnReportInput(fd);
  if (!parsed.ok) {
    redirectError(path, parsed.error);
  }

  const { data, error } = await returnReportRecord(
    supabase,
    reportId,
    { id: person.id, full_name: person.full_name },
    parsed.value.note,
  );

  if (error || !data) {
    redirectError(path, error ?? "Could not return report.");
  }

  revalidateReportPaths(data.id, data.job_id);
  redirect(`${path}?saved=returned`);
}

export async function markReportSent(reportId: string, fd: FormData) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const path = `/review/${reportId}`;
  const rawRecipients = text(fd, "sent_to") ?? "";
  const { data, error } = await markReportSentRecord(
    supabase,
    reportId,
    rawRecipients,
  );

  if (error || !data) {
    redirectError(path, error ?? "Could not mark report as sent.");
  }

  revalidateReportPaths(data.id, data.job_id);
  revalidatePath("/jobs");
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

// "Create report" on its own: no field data needed, and the job can be chosen now or linked later.
export async function createBlankReport(fd: FormData) {
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");
  const back = "/review/new";

  const method = text(fd, "method") ?? "";
  const reportNo = (text(fd, "report_no") ?? "").trim();
  const reportDate = text(fd, "report_date") ?? new Date().toISOString().slice(0, 10);
  const jobId = text(fd, "job_id");
  const signatoryId = text(fd, "signatory_id");

  if (!(Constants.public.Enums.test_method as readonly string[]).includes(method)) {
    redirectError(back, "Choose the test method.");
  }
  if (!reportNo) redirectError(back, "Enter the BITA report number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) redirectError(back, "Enter a valid report date.");
  if (jobId && !validUuid(jobId)) redirectError(back, "Choose a valid job.");
  if (signatoryId && !validUuid(signatoryId)) redirectError(back, "Choose a valid signatory.");

  const startReadings = jobId
    ? mergePrefill({}, await buildJobReportPrefill(supabase, jobId, method as Enums<"test_method">))
    : {};
  const { data: created, error } = await supabase
    .from("reports")
    .insert({
      job_id: jobId || null,
      inspection_id: null,
      method: method as Enums<"test_method">,
      report_no: reportNo,
      report_date: reportDate,
      content: buildReportContent(startReadings, null, null),
      status: "draft",
      prepared_by: person.id,
      signatory_id: signatoryId || null,
    })
    .select("id")
    .single();
  if (error || !created) redirectError(back, error?.message ?? "Could not create the report.");

  revalidateReportPaths(created.id, jobId);
  redirect(`/review/${created.id}?saved=prepared`);
}

// Link a report that was created on its own to a job (or move it to another job before approval).
export async function linkReportToJob(reportId: string, fd: FormData) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase } = await requireStaff();
  const path = `/review/${reportId}`;
  const jobId = text(fd, "job_id");
  if (!jobId || !validUuid(jobId)) redirectError(path, "Choose the job to link this report to.");

  const { data: report } = await supabase
    .from("reports")
    .select("id, status, job_id, method, content")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) redirect("/review");
  if (report.status === "approved" || report.status === "sent") {
    redirectError(path, "An approved report cannot be moved to another job.");
  }

  const [prefill, lookups] = await Promise.all([
    buildJobReportPrefill(supabase, jobId, report.method),
    loadReportLookups(supabase, report.method),
  ]);
  const content = buildReportContent(
    mergePrefill(extractReadings(report.content), prefill, lookups.technicians),
  );
  const { error } = await supabase.from("reports").update({ job_id: jobId, content }).eq("id", reportId);
  if (error) redirectError(path, error.message);

  revalidateReportPaths(reportId, jobId);
  if (report.job_id) revalidatePath(`/jobs/${report.job_id}`);
  redirect(`${path}?saved=linked`);
}

// "Fill from job": fills the blank fields of a draft report from its job (client, site, date,
// technicians with qualifications, booked equipment with serial and calibration). Typed values stay.
export async function fillReportFromJob(reportId: string) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase } = await requireStaff();
  const path = `/review/${reportId}`;
  const { data: report } = await supabase
    .from("reports")
    .select("id, status, job_id, method, content")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) redirect("/review");
  if (!report.job_id) redirectError(path, "Link this report to a job first.");
  if (report.status === "approved" || report.status === "sent") {
    redirectError(path, "An approved report cannot be changed.");
  }
  const [prefill, lookups] = await Promise.all([
    buildJobReportPrefill(supabase, report.job_id, report.method),
    loadReportLookups(supabase, report.method),
  ]);
  const content = buildReportContent(
    mergePrefill(extractReadings(report.content), prefill, lookups.technicians),
  );
  const { error } = await supabase.from("reports").update({ content }).eq("id", reportId);
  if (error) redirectError(path, error.message);
  revalidateReportPaths(reportId, report.job_id);
  redirect(`${path}?saved=filled`);
}
