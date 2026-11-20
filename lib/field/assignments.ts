import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Json } from "../db/types";
import { missingFields, reportMethod, type ReportMethodInput } from "../reports/fields";
import { mapToCanonicalTestMethodEnum, resolveFieldsForMethod } from "../modules/settings/templates";

export const MAX_PHOTO_BYTES = 6 * 1024 * 1024; // 6 MB limit per contract

export type TechnicianSiteFile = {
  id: string;
  kind: string;
  caption: string | null;
  storagePath: string;
  fileName: string;
  uploadedAt: string;
};

export type TechnicianJobNote = {
  id: string;
  kind: Enums<"technician_message_kind">;
  body: string;
  receivedAt: string;
};

export type TechnicianLeaveRequestItem = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type TechnicianJobItem = {
  id: string;
  jobId: string;
  jobNo: string;
  customerName: string;
  site: string | null;
  scope: string | null;
  standard?: string | null;
  testMethods: Enums<"test_method">[];
  workDate: string;
  endDate: string | null;
  notes: string | null;
  acknowledgedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  equipment: Array<{
    id: string;
    kind: Enums<"equipment_kind"> | null;
    model: string | null;
    serialNo: string | null;
    calibrationDue: string | null;
  }>;
  inspection: {
    id: string;
    method: Enums<"test_method">;
    status: "draft" | "submitted" | "approved";
    isApproved: boolean;
    missingFields: string[];
    observations: string | null;
    readings: Json;
    submittedAt: string | null;
  } | null;
  attachments?: TechnicianSiteFile[];
  jobNotes?: TechnicianJobNote[];
};

/**
 * Strips quotation titles, reference numbers, and rates/currency amounts from scope text
 * so technicians only see the scope of work (what to test), never quotation numbers or prices.
 */
export function sanitizeTechnicianScope(rawScope: string | null | undefined): string | null {
  if (!rawScope) return null;
  let s = rawScope.trim();
  if (!s) return null;

  // Strip leading "Quotation for " / "Quote for " / "Quotation: "
  s = s.replace(/^(?:quotation|quote)\s*(?:for|:|-|–|—)\s*/i, "");
  // Strip quotation reference numbers like BITA/QTN/26-27/0001 or QTN-0001
  s = s.replace(/\b(?:BITA\/)?QTN[\/-][\w\/-]+/gi, "");
  // Strip currency / rate clauses (e.g. "@ ₹1,500", "₹ 15,000", "Rs. 2500/-", "INR 5000", "minimum charge ...")
  s = s.replace(/@?\s*(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d+)?(?:\s*\/-)?(?:\s*per\s+[\w.]+)?/gi, "");
  s = s.replace(/(?:rate|minimum\s+charge|total)[:\s]*(?:₹|Rs\.?|INR)?\s*[\d,]+(?:\.\d+)?(?:\s*\/-)?(?:\s*per\s+[\w.]+)?/gi, "");
  s = s.replace(/\+\s*\d+%\s*GST/gi, "");
  // Clean up dangling separators and symbols
  s = s
    .replace(/\(\s*\)/g, "")
    .replace(/\s*[@·|—–-]\s*(?=[@·|—–-]|$)/g, "")
    .replace(/^\s*[@·|—–:-]\s*/, "")
    .replace(/\s*[@·|—–:-]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return s || "NDT Inspection";
}

export function inferStandardForJob(
  methods: Enums<"test_method">[],
  scope: string | null | undefined,
  readings?: Json | null,
): string {
  if (readings && typeof readings === "object" && !Array.isArray(readings)) {
    const std = (readings as Record<string, unknown>).standard;
    if (typeof std === "string" && std.trim()) {
      return std.trim();
    }
  }
  const text = scope || "";
  const match = text.match(/\b((?:ASME|ASTM|IS|ISO|API|EN|BS)\s+[A-Z0-9.\-\s/]{2,25})/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  const primary = methods[0] || "UT";
  switch (primary) {
    case "UT":
      return "ASME Sec V Art 4 / IS 3664";
    case "MPT":
      return "ASME Sec V Art 7 / IS 3703";
    case "DPT":
      return "ASME Sec V Art 6 / IS 3658";
    case "RT":
      return "ASME Sec V Art 2";
    case "VT":
      return "ASME Sec V Art 9";
    default:
      return "As per applicable NDT specification";
  }
}

/**
 * Returns assignments for the technician: upcoming plus the last 14 days.
 */
function inferTestMethods(
  rawMethods: Enums<"test_method">[] | null | undefined,
  scope: string | null | undefined,
): Enums<"test_method">[] {
  if (Array.isArray(rawMethods) && rawMethods.length > 0) {
    return rawMethods;
  }
  const text = (scope || "").toUpperCase();
  const inferred: Enums<"test_method">[] = [];
  if (/\bUT\b|ULTRASONIC/.test(text)) inferred.push("UT");
  if (/\bMPT\b|\bMT\b|\bMPI\b|MAGNETIC/.test(text)) inferred.push("MPT");
  if (/\bDPT\b|\bPT\b|\bLPI\b|PENETRANT/.test(text)) inferred.push("DPT");
  if (/\bRT\b|RADIOGRAPH/.test(text)) inferred.push("RT");
  if (/\bVT\b|VISUAL/.test(text)) inferred.push("VT");
  return inferred.length > 0 ? inferred : ["UT"];
}

export async function getTechnicianJobs(
  supabase: SupabaseClient<Database>,
  personId: string,
  nowMs = Date.now(),
): Promise<TechnicianJobItem[]> {
  // 14 days ago in ISO date string format (YYYY-MM-DD)
  const fourteenDaysAgo = new Date(nowMs - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // 1. Fetch assignments for this technician
  const { data: assignments, error: assignError } = await supabase
    .from("assignments")
    .select(`
      id,
      job_id,
      person_id,
      work_date,
      end_date,
      notes,
      acknowledged_at,
      started_at,
      completed_at,
      jobs!inner (
        id,
        job_no,
        site,
        scope,
        test_methods,
        customer_id,
        customers!inner (
          id,
          name
        )
      )
    `)
    .eq("person_id", personId)
    .gte("work_date", fourteenDaysAgo)
    .order("work_date", { ascending: true });

  if (assignError || !assignments) {
    throw new Error(`Failed to load technician jobs: ${assignError?.message || "Unknown error"}`);
  }

  if (assignments.length === 0) {
    return [];
  }

  const assignmentIds = assignments.map((a) => a.id);

  // 2. Fetch equipment assigned to these assignments
  const { data: assignEquip } = await supabase
    .from("assignment_equipment")
    .select(`
      assignment_id,
      equipment (
        id,
        kind,
        model,
        serial_no,
        calibration_due
      )
    `)
    .in("assignment_id", assignmentIds);

  const equipByAssignment = new Map<
    string,
    Array<{
      id: string;
      kind: Enums<"equipment_kind"> | null;
      model: string | null;
      serialNo: string | null;
      calibrationDue: string | null;
    }>
  >();

  if (assignEquip) {
    for (const item of assignEquip) {
      if (!item.equipment) continue;
      const eq = item.equipment;
      const list = equipByAssignment.get(item.assignment_id) || [];
      list.push({
        id: eq.id,
        kind: eq.kind,
        model: eq.model,
        serialNo: eq.serial_no,
        calibrationDue: eq.calibration_due,
      });
      equipByAssignment.set(item.assignment_id, list);
    }
  }

  // 3. Fetch inspections for these assignments
  const { data: inspections } = await supabase
    .from("inspections")
    .select(`
      id,
      assignment_id,
      method,
      missing_fields,
      observations,
      readings,
      submitted_at
    `)
    .in("assignment_id", assignmentIds);

  // Check if any of these inspections have approved reports
  const inspectionIds = inspections?.map((i) => i.id) || [];
  const reportsByInspection = new Map<string, { status: string; approved_at: string | null }>();
  if (inspectionIds.length > 0) {
    const { data: reports } = await supabase
      .from("reports")
      .select("inspection_id, status, approved_at")
      .in("inspection_id", inspectionIds);

    if (reports) {
      for (const rep of reports) {
        if (rep.inspection_id) {
          reportsByInspection.set(rep.inspection_id, {
            status: rep.status,
            approved_at: rep.approved_at,
          });
        }
      }
    }
  }

  const inspectionByAssignment = new Map<string, TechnicianJobItem["inspection"]>();

  if (inspections) {
    for (const insp of inspections) {
      if (!insp.assignment_id) continue;
      const rep = insp.id ? reportsByInspection.get(insp.id) : undefined;
      const isApproved = Boolean(
        rep && (rep.status === "approved" || rep.status === "sent" || Boolean(rep.approved_at))
      );

      inspectionByAssignment.set(insp.assignment_id, {
        id: insp.id,
        method: insp.method,
        status: isApproved ? "approved" : insp.submitted_at ? "submitted" : "draft",
        isApproved,
        missingFields: insp.missing_fields || [],
        observations: insp.observations,
        readings: insp.readings,
        submittedAt: insp.submitted_at,
      });
    }
  }

  // 4. Fetch site attachments and technician notes for these jobs (safe against partial test mocks)
  const jobIds = Array.from(new Set(assignments.map((a) => a.job_id)));
  const attachmentsByJob = new Map<string, TechnicianSiteFile[]>();
  const notesByJob = new Map<string, TechnicianJobNote[]>();

  try {
    const attTable = supabase.from("attachments");
    if (attTable && typeof attTable.select === "function" && jobIds.length > 0) {
      const { data: attRows } = await attTable
        .select("id, job_id, kind, caption, storage_path, uploaded_at")
        .in("job_id", jobIds)
        .order("uploaded_at", { ascending: false });
      if (Array.isArray(attRows)) {
        for (const r of attRows) {
          const list = attachmentsByJob.get(r.job_id) || [];
          list.push({
            id: r.id,
            kind: r.kind,
            caption: r.caption,
            storagePath: r.storage_path,
            fileName: r.storage_path.split("/").pop() || r.storage_path,
            uploadedAt: r.uploaded_at,
          });
          attachmentsByJob.set(r.job_id, list);
        }
      }
    }
  } catch {
    // ignore on partial mocks
  }

  try {
    const msgTable = supabase.from("technician_messages");
    if (msgTable && typeof msgTable.select === "function" && jobIds.length > 0) {
      const { data: msgRows } = await msgTable
        .select("id, job_id, kind, body, received_at")
        .in("job_id", jobIds)
        .order("received_at", { ascending: false });
      if (Array.isArray(msgRows)) {
        for (const m of msgRows) {
          if (!m.job_id || !m.body) continue;
          const list = notesByJob.get(m.job_id) || [];
          list.push({
            id: m.id,
            kind: m.kind,
            body: m.body,
            receivedAt: m.received_at,
          });
          notesByJob.set(m.job_id, list);
        }
      }
    }
  } catch {
    // ignore on partial mocks
  }

  // Combine results
  return assignments.map((a) => {
    // Supabase nested relation casting
    const job = a.jobs as unknown as {
      id: string;
      job_no: string;
      site: string | null;
      scope: string | null;
      test_methods: Enums<"test_method">[];
      customers: { id: string; name: string };
    };
    const methods = inferTestMethods(job.test_methods, job.scope);
    const insp = inspectionByAssignment.get(a.id) || null;
    const cleanScope = sanitizeTechnicianScope(job.scope);

    return {
      id: a.id,
      jobId: a.job_id,
      jobNo: job.job_no,
      customerName: job.customers?.name ?? "Customer",
      site: job.site,
      scope: cleanScope,
      standard: inferStandardForJob(methods, cleanScope, insp?.readings),
      testMethods: methods,
      workDate: a.work_date,
      endDate: a.end_date ?? null,
      notes: a.notes,
      acknowledgedAt: a.acknowledged_at,
      startedAt: a.started_at,
      completedAt: a.completed_at,
      equipment: equipByAssignment.get(a.id) || [],
      inspection: insp,
      attachments: attachmentsByJob.get(a.job_id) || [],
      jobNotes: notesByJob.get(a.job_id) || [],
    };
  });
}

/**
 * Checks that an assignment exists and belongs to the calling technician.
 * Returns null if not found or belongs to another technician (for 404).
 */
export async function verifyTechnicianAssignment(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
) {
  const { data: assignment, error } = await supabase
    .from("assignments")
    .select("id, job_id, person_id, work_date, acknowledged_at, started_at, completed_at")
    .eq("id", assignmentId)
    .maybeSingle();

  if (error || !assignment) return null;
  if (assignment.person_id !== personId) return null;

  return assignment;
}

/**
 * Acknowledges an assignment for the technician.
 */
export async function acknowledgeAssignment(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
): Promise<{ ok: boolean; acknowledgedAt: string } | { error: string; status: number }> {
  const assignment = await verifyTechnicianAssignment(supabase, assignmentId, personId);
  if (!assignment) {
    return { error: "Assignment not found", status: 404 };
  }

  const acknowledgedAt = new Date().toISOString();
  const { error } = await supabase
    .from("assignments")
    .update({ acknowledged_at: acknowledgedAt })
    .eq("id", assignmentId);

  if (error) {
    return { error: `Failed to acknowledge assignment: ${error.message}`, status: 500 };
  }

  return { ok: true, acknowledgedAt };
}

/**
 * Marks work started on an assignment.
 */
export async function startAssignment(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
): Promise<{ ok: boolean; startedAt: string } | { error: string; status: number }> {
  const assignment = await verifyTechnicianAssignment(supabase, assignmentId, personId);
  if (!assignment) {
    return { error: "Assignment not found", status: 404 };
  }

  const startedAt = new Date().toISOString();
  const { error } = await supabase
    .from("assignments")
    .update({ started_at: startedAt })
    .eq("id", assignmentId);

  if (error) {
    return { error: `Failed to record start of work: ${error.message}`, status: 500 };
  }

  return { ok: true, startedAt };
}

/**
 * Upserts inspection report (draft or final).
 * When draft is false and nothing required is missing, marks submitted,
 * marks assignment completed, and marks job inspection_done.
 */
export async function submitInspectionReport(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
  params: {
    method: ReportMethodInput;
    readings: unknown;
    observations?: string | null;
    draft?: boolean;
  },
): Promise<
  | {
      ok: true;
      id: string;
      draft: boolean;
      missingFields: string[];
      submittedAt: string | null;
    }
  | { error: string; status: number }
> {
  const assignment = await verifyTechnicianAssignment(supabase, assignmentId, personId);
  if (!assignment) {
    return { error: "Assignment not found", status: 404 };
  }

  let canonicalMethod: Enums<"test_method">;
  try {
    canonicalMethod = reportMethod(params.method);
  } catch {
    canonicalMethod = mapToCanonicalTestMethodEnum(String(params.method ?? ""));
  }

  const resolvedFields = await resolveFieldsForMethod(
    supabase,
    String(params.method ?? canonicalMethod),
  );
  const missing = missingFields(params.method, params.readings, resolvedFields);
  const isDraft = params.draft !== false;
  const canFinalize = !isDraft && missing.length === 0;
  const now = new Date().toISOString();

  // Check if an inspection already exists for this assignment
  const { data: existingInspection } = await supabase
    .from("inspections")
    .select("id, readings, observations, submitted_at")
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  // If inspection exists, check if there is an approved report.
  // Per Phase 2 / A1: a submitted report CAN be edited and resubmitted from the phone
  // until the office approves it; after approval, only the office edits (409 lock).
  let existingReport: { id: string; status: string; approved_at: string | null } | null = null;
  if (existingInspection) {
    const { data: rep } = await supabase
      .from("reports")
      .select("id, status, approved_at")
      .eq("inspection_id", existingInspection.id)
      .maybeSingle();
    existingReport = rep;

    const isApproved = Boolean(
      rep && (rep.status === "approved" || rep.status === "sent" || Boolean(rep.approved_at))
    );

    if (isApproved) {
      return {
        error: "This report has been approved by the office and is locked. Contact the office to make changes.",
        status: 409,
      };
    }
  }

  // If this is an edit of an already submitted report, log the diff to inspection_edits & audit_log
  const isEditOfSubmitted = Boolean(existingInspection?.submitted_at);
  if (isEditOfSubmitted && existingInspection) {
    const oldReadings = (existingInspection.readings ?? {}) as Record<string, unknown>;
    const newReadings = (params.readings ?? {}) as Record<string, unknown>;
    const diff: Record<string, { old: unknown; new: unknown }> = {};

    const allKeys = new Set([...Object.keys(oldReadings), ...Object.keys(newReadings)]);
    for (const k of allKeys) {
      const oldVal = oldReadings[k];
      const newVal = newReadings[k];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diff[k] = { old: oldVal ?? null, new: newVal ?? null };
      }
    }

    const obsChanged = (existingInspection.observations ?? "") !== (params.observations ?? "");
    if (obsChanged) {
      diff["observations"] = {
        old: existingInspection.observations ?? null,
        new: params.observations ?? null,
      };
    }

    if (Object.keys(diff).length > 0) {
      await supabase.from("inspection_edits").insert({
        assignment_id: assignmentId,
        inspection_id: existingInspection.id,
        job_id: assignment.job_id,
        edited_by: personId,
        edited_at: now,
        old_readings: (existingInspection.readings ?? {}) as Json,
        new_readings: (params.readings ?? {}) as Json,
        diff: diff as unknown as Json,
        old_observations: existingInspection.observations ?? null,
        new_observations: params.observations ?? null,
      });

      await supabase.from("audit_log").insert({
        action: "update",
        table_name: "inspections",
        record_id: existingInspection.id,
        changed_by_person: personId,
        changed_fields: Object.keys(diff),
        old_row: (existingInspection.readings ?? {}) as Json,
        new_row: (params.readings ?? {}) as Json,
      });
    }
  }

  let inspectionId: string;
  const effectiveSubmittedAt = isEditOfSubmitted && existingInspection
    ? existingInspection.submitted_at
    : canFinalize
      ? now
      : null;

  if (existingInspection) {
    inspectionId = existingInspection.id;
    const { error: updateError } = await supabase
      .from("inspections")
      .update({
        method: canonicalMethod,
        readings: (params.readings ?? {}) as Json,
        observations: params.observations ?? null,
        missing_fields: missing,
        submitted_by: personId,
        submitted_at: effectiveSubmittedAt,
      })
      .eq("id", inspectionId);

    if (updateError) {
      return { error: `Failed to update inspection: ${updateError.message}`, status: 500 };
    }

    // If report was returned, resubmitting sets it back to waiting for review
    if (existingReport && existingReport.status === "returned" && canFinalize) {
      await supabase.from("reports").update({ status: "in_review" }).eq("id", existingReport.id);
    }
  } else {
    const { data: newInspection, error: insertError } = await supabase
      .from("inspections")
      .insert({
        job_id: assignment.job_id,
        assignment_id: assignmentId,
        method: canonicalMethod,
        readings: (params.readings ?? {}) as Json,
        observations: params.observations ?? null,
        missing_fields: missing,
        submitted_by: personId,
        submitted_at: effectiveSubmittedAt,
      })
      .select("id")
      .single();

    if (insertError || !newInspection) {
      return { error: `Failed to create inspection: ${insertError?.message || "Unknown error"}`, status: 500 };
    }
    inspectionId = newInspection.id;
  }

  if (canFinalize || isEditOfSubmitted) {
    // 1. Mark assignment completed
    await supabase
      .from("assignments")
      .update({ completed_at: now })
      .eq("id", assignmentId);

    // 2. Advance job status to inspection_done
    await supabase
      .from("jobs")
      .update({ status: "inspection_done" })
      .eq("id", assignment.job_id);
  }

  return {
    ok: true,
    id: inspectionId,
    draft: isDraft,
    missingFields: missing,
    submittedAt: effectiveSubmittedAt,
  };
}

const VALID_ATTACHMENT_KINDS = new Set([
  "site_photo",
  "defect_photo",
  "drawing",
  "purchase_order",
  "supporting_document",
  "other",
]);

function resolveAttachmentKind(
  explicitKind: string | undefined | null,
  contentType: string | undefined | null,
  fileName: string,
): string {
  if (explicitKind && VALID_ATTACHMENT_KINDS.has(explicitKind)) {
    return explicitKind;
  }
  const lowerMime = (contentType || "").toLowerCase();
  const lowerName = (fileName || "").toLowerCase();
  if (
    lowerMime.startsWith("image/") ||
    /\.(jpg|jpeg|png|webp|heic|gif)$/i.test(lowerName)
  ) {
    return "site_photo";
  }
  if (/\.(dwg|dxf)$/i.test(lowerName)) {
    return "drawing";
  }
  if (
    lowerMime === "application/pdf" ||
    /\.(pdf|doc|docx|xls|xlsx|txt|csv)$/i.test(lowerName)
  ) {
    return "supporting_document";
  }
  return "other";
}

/**
 * Uploads a photo/drawing/document attachment for an assignment.
 * Enforces 6 MB maximum and saves under documents/jobs/<job id>/<timestamp>-<name>.
 * When linkInspection is false (default for job-level site file uploads), inspection_id is stored as null.
 */
export async function uploadFieldAttachment(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
  params: {
    fileBuffer: Buffer;
    fileName: string;
    contentType: string;
    caption?: string | null;
    kind?: "site_photo" | "defect_photo" | "drawing" | "supporting_document" | "other" | string;
    linkInspection?: boolean;
  },
): Promise<
  | { ok: true; attachmentId: string; storagePath: string; kind: string; fileName: string }
  | { error: string; status: number }
> {
  const assignment = await verifyTechnicianAssignment(supabase, assignmentId, personId);
  if (!assignment) {
    return { error: "Assignment not found", status: 404 };
  }

  if (params.fileBuffer.length > MAX_PHOTO_BYTES) {
    return { error: "File size exceeds the 6 MB limit.", status: 400 };
  }

  const cleanName = (params.fileName || "photo.jpg").replace(/[^\w.-]+/g, "_");
  const timestamp = Date.now();
  const storagePath = `jobs/${assignment.job_id}/${timestamp}-${cleanName}`;

  // Upload to Supabase Storage bucket 'documents'
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, params.fileBuffer, {
      contentType: params.contentType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return { error: `Storage upload failed: ${uploadError.message}`, status: 500 };
  }

  let inspectionId: string | null = null;
  if (params.linkInspection) {
    const { data: insp } = await supabase
      .from("inspections")
      .select("id")
      .eq("assignment_id", assignmentId)
      .maybeSingle();
    inspectionId = insp?.id ?? null;
  }

  const kind = resolveAttachmentKind(params.kind, params.contentType, cleanName);

  // Record attachment in the database (inspection_id null for direct job site files)
  const { data: att, error: dbError } = await supabase
    .from("attachments")
    .insert({
      job_id: assignment.job_id,
      inspection_id: inspectionId,
      kind,
      caption: params.caption ?? null,
      storage_path: storagePath,
      uploaded_by: personId,
    })
    .select("id")
    .single();

  if (dbError || !att) {
    return { error: `Failed to save attachment metadata: ${dbError?.message || "Unknown error"}`, status: 500 };
  }

  return {
    ok: true,
    attachmentId: att.id,
    storagePath,
    kind,
    fileName: cleanName,
  };
}

/**
 * Creates a signed upload URL for a technician assignment file.
 * Directly uploads to Supabase storage bypassing Vercel's 4.5 MB request body limit,
 * supporting files up to 25 MB.
 */
export async function createDirectUploadUrl(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
  params: {
    fileName: string;
    contentType?: string | null;
  },
): Promise<
  | {
      ok: true;
      signedUrl: string;
      token: string;
      storagePath: string;
      jobId: string;
    }
  | { error: string; status: number }
> {
  const assignment = await verifyTechnicianAssignment(supabase, assignmentId, personId);
  if (!assignment) {
    return { error: "Assignment not found", status: 404 };
  }

  const rawName = (params.fileName || "").trim() || "upload";
  const cleanName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `jobs/${assignment.job_id}/${Date.now()}-${cleanName}`;

  try {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUploadUrl(storagePath, { upsert: false });

    if (error || !data) {
      return {
        error: `Failed to create signed upload URL: ${error?.message || "Storage error"}`,
        status: 500,
      };
    }

    return {
      ok: true,
      signedUrl: data.signedUrl,
      token: data.token,
      storagePath,
      jobId: assignment.job_id,
    };
  } catch (err) {
    return {
      error: `Storage error: ${err instanceof Error ? err.message : "Unknown error"}`,
      status: 500,
    };
  }
}

/**
 * Confirms a direct storage upload and records the attachment row in the database.
 * Strictly verifies that the storagePath belongs under this job's folder (`jobs/${job_id}/`).
 */
export async function confirmDirectUpload(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
  params: {
    storagePath: string;
    kind?: string | null;
    caption?: string | null;
    linkInspection?: boolean;
    contentType?: string | null;
  },
): Promise<
  | {
      ok: true;
      attachmentId: string;
      storagePath: string;
      kind: string;
      fileName: string;
    }
  | { error: string; status: number }
> {
  const assignment = await verifyTechnicianAssignment(supabase, assignmentId, personId);
  if (!assignment) {
    return { error: "Assignment not found", status: 404 };
  }

  const storagePath = (params.storagePath || "").trim();
  const expectedPrefix = `jobs/${assignment.job_id}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    return {
      error: "Invalid storage path: file must be located inside the assigned job directory.",
      status: 403,
    };
  }

  let inspectionId: string | null = null;
  if (params.linkInspection) {
    const { data: insp } = await supabase
      .from("inspections")
      .select("id")
      .eq("assignment_id", assignmentId)
      .maybeSingle();
    inspectionId = insp?.id ?? null;
  }

  const rawFileName = storagePath.split("/").pop() || "file";
  const cleanName = rawFileName.replace(/^\d+-/, "");
  const kind = resolveAttachmentKind(params.kind, params.contentType, cleanName);

  const { data: att, error: dbError } = await supabase
    .from("attachments")
    .insert({
      job_id: assignment.job_id,
      inspection_id: inspectionId,
      kind,
      caption: params.caption ?? null,
      storage_path: storagePath,
      uploaded_by: personId,
    })
    .select("id")
    .single();

  if (dbError || !att) {
    return {
      error: `Failed to save attachment metadata: ${dbError?.message || "Unknown error"}`,
      status: 500,
    };
  }

  return {
    ok: true,
    attachmentId: att.id,
    storagePath,
    kind,
    fileName: cleanName,
  };
}

/**
 * Lists files uploaded against the job for a technician's assignment.
 */
export async function listAssignmentFiles(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
): Promise<{ ok: true; files: TechnicianSiteFile[] } | { error: string; status: number }> {
  const assignment = await verifyTechnicianAssignment(supabase, assignmentId, personId);
  if (!assignment) {
    return { error: "Assignment not found", status: 404 };
  }

  const { data, error } = await supabase
    .from("attachments")
    .select("id, kind, caption, storage_path, uploaded_at")
    .eq("job_id", assignment.job_id)
    .order("uploaded_at", { ascending: false });

  if (error) {
    return { error: `Failed to load files: ${error.message}`, status: 500 };
  }

  const files: TechnicianSiteFile[] = (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    caption: r.caption,
    storagePath: r.storage_path,
    fileName: r.storage_path.split("/").pop() || r.storage_path,
    uploadedAt: r.uploaded_at,
  }));

  return { ok: true, files };
}

/**
 * Records a message from a technician (delay, leave, equipment problem, site issue, note).
 */
export async function createTechnicianMessage(
  supabase: SupabaseClient<Database>,
  personId: string,
  params: {
    kind: Enums<"technician_message_kind">;
    body: string;
    jobId?: string | null;
    assignmentId?: string | null;
  },
): Promise<{ ok: true; messageId: string } | { error: string; status: number }> {
  if (!params.body || !params.body.trim()) {
    return { error: "Message body cannot be empty.", status: 400 };
  }

  const validKinds: Enums<"technician_message_kind">[] = [
    "delay",
    "leave",
    "equipment_problem",
    "site_issue",
    "note",
    "other",
  ];

  if (!validKinds.includes(params.kind)) {
    return {
      error: `Invalid message kind. Expected one of: ${validKinds.join(", ")}`,
      status: 400,
    };
  }

  const payload: Database["public"]["Tables"]["technician_messages"]["Insert"] = {
    person_id: personId,
    kind: params.kind,
    body: params.body.trim(),
    job_id: params.jobId || null,
    ...(params.assignmentId ? { assignment_id: params.assignmentId } : {}),
  };

  let { data, error } = await supabase
    .from("technician_messages")
    .insert(payload)
    .select("id")
    .single();

  // Fallback if live database has not yet had 'note' added to technician_message_kind enum
  if (error && params.kind === "note") {
    const retry = await supabase
      .from("technician_messages")
      .insert({ ...payload, kind: "other" })
      .select("id")
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) {
    return { error: `Failed to record message: ${error?.message || "Unknown error"}`, status: 500 };
  }

  return { ok: true, messageId: data.id };
}

/**
 * Adds a technician note/comment directly on an assigned job.
 */
export async function createAssignmentJobNote(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
  body: string,
): Promise<{ ok: true; noteId: string; receivedAt: string } | { error: string; status: number }> {
  const assignment = await verifyTechnicianAssignment(supabase, assignmentId, personId);
  if (!assignment) {
    return { error: "Assignment not found", status: 404 };
  }

  const res = await createTechnicianMessage(supabase, personId, {
    kind: "note",
    body,
    jobId: assignment.job_id,
    assignmentId: assignment.id,
  });

  if ("error" in res) {
    return res;
  }

  return {
    ok: true,
    noteId: res.messageId,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Lists notes/messages for a technician's assigned job.
 */
export async function listAssignmentJobNotes(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  personId: string,
): Promise<{ ok: true; notes: TechnicianJobNote[] } | { error: string; status: number }> {
  const assignment = await verifyTechnicianAssignment(supabase, assignmentId, personId);
  if (!assignment) {
    return { error: "Assignment not found", status: 404 };
  }

  const { data, error } = await supabase
    .from("technician_messages")
    .select("id, kind, body, received_at")
    .eq("job_id", assignment.job_id)
    .order("received_at", { ascending: false });

  if (error) {
    return { error: `Failed to load job notes: ${error.message}`, status: 500 };
  }

  const notes: TechnicianJobNote[] = (data ?? [])
    .filter((r) => Boolean(r.body))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      body: r.body || "",
      receivedAt: r.received_at,
    }));

  return { ok: true, notes };
}

function toIsoDateStr(val: unknown): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val ?? "").slice(0, 10);
}

/**
 * Submits a leave request from a technician (dates + reason).
 * Office approves/rejects in the office app; approved leave creates leave_days rows.
 */
export async function submitTechnicianLeaveRequest(
  supabase: SupabaseClient<Database>,
  personId: string,
  params: {
    startDate: string;
    endDate?: string | null;
    reason?: string | null;
  },
): Promise<
  | { ok: true; request: TechnicianLeaveRequestItem }
  | { error: string; status: number }
> {
  const start = (params.startDate || "").trim();
  const end = (params.endDate || params.startDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { error: "Please provide valid dates in YYYY-MM-DD format.", status: 400 };
  }
  if (end < start) {
    return { error: "End date cannot be earlier than start date.", status: 400 };
  }

  const cleanReason = params.reason?.trim() || null;

  const { data, error } = await supabase
    .from("leave_requests")
    .insert({
      person_id: personId,
      start_date: start,
      end_date: end,
      reason: cleanReason,
      status: "pending",
    })
    .select("id, start_date, end_date, reason, status, review_note, reviewed_at, created_at")
    .single();

  if (error || !data) {
    return { error: `Failed to submit leave request: ${error?.message || "Unknown error"}`, status: 500 };
  }

  return {
    ok: true,
    request: {
      id: data.id,
      startDate: toIsoDateStr(data.start_date),
      endDate: toIsoDateStr(data.end_date),
      reason: data.reason,
      status: (data.status as "pending" | "approved" | "rejected") || "pending",
      reviewNote: data.review_note,
      reviewedAt: data.reviewed_at,
      createdAt: String(data.created_at),
    },
  };
}

/**
 * Lists leave requests and approved leave days for a technician.
 */
export async function listTechnicianLeave(
  supabase: SupabaseClient<Database>,
  personId: string,
): Promise<
  | {
      ok: true;
      requests: TechnicianLeaveRequestItem[];
      approvedDays: Array<{ id: string; leaveDate: string; reason: string | null }>;
    }
  | { error: string; status: number }
> {
  const [reqRes, daysRes] = await Promise.all([
    supabase
      .from("leave_requests")
      .select("id, start_date, end_date, reason, status, review_note, reviewed_at, created_at")
      .eq("person_id", personId)
      .order("start_date", { ascending: false }),
    supabase
      .from("leave_days")
      .select("id, leave_date, reason")
      .eq("person_id", personId)
      .order("leave_date", { ascending: false }),
  ]);

  const requests: TechnicianLeaveRequestItem[] = (reqRes.data ?? []).map((r) => ({
    id: r.id,
    startDate: toIsoDateStr(r.start_date),
    endDate: toIsoDateStr(r.end_date),
    reason: r.reason,
    status: (r.status as "pending" | "approved" | "rejected") || "pending",
    reviewNote: r.review_note,
    reviewedAt: r.reviewed_at,
    createdAt: String(r.created_at),
  }));

  const approvedDays = (daysRes.data ?? []).map((d) => ({
    id: d.id,
    leaveDate: toIsoDateStr(d.leave_date),
    reason: d.reason,
  }));

  return { ok: true, requests, approvedDays };
}
