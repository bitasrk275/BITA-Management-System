import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Json } from "../db/types";
import { missingFields, reportMethod, type ReportMethodInput } from "../reports/fields";

export const MAX_PHOTO_BYTES = 6 * 1024 * 1024; // 6 MB limit per contract

export type TechnicianJobItem = {
  id: string;
  jobId: string;
  jobNo: string;
  customerName: string;
  site: string | null;
  scope: string | null;
  testMethods: Enums<"test_method">[];
  workDate: string;
  notes: string | null;
  acknowledgedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  equipment: Array<{
    id: string;
    kind: Enums<"equipment_kind">;
    model: string | null;
    serialNo: string | null;
    calibrationDue: string | null;
  }>;
  inspection: {
    id: string;
    method: Enums<"test_method">;
    status: "draft" | "submitted";
    missingFields: string[];
    observations: string | null;
    readings: Json;
    submittedAt: string | null;
  } | null;
};

/**
 * Returns assignments for the technician: upcoming plus the last 14 days.
 */
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
      kind: Enums<"equipment_kind">;
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

  const inspectionByAssignment = new Map<string, TechnicianJobItem["inspection"]>();

  if (inspections) {
    for (const insp of inspections) {
      if (!insp.assignment_id) continue;
      inspectionByAssignment.set(insp.assignment_id, {
        id: insp.id,
        method: insp.method,
        status: insp.submitted_at ? "submitted" : "draft",
        missingFields: insp.missing_fields || [],
        observations: insp.observations,
        readings: insp.readings,
        submittedAt: insp.submitted_at,
      });
    }
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

    return {
      id: a.id,
      jobId: a.job_id,
      jobNo: job.job_no,
      customerName: job.customers?.name ?? "Customer",
      site: job.site,
      scope: job.scope,
      testMethods: job.test_methods || [],
      workDate: a.work_date,
      notes: a.notes,
      acknowledgedAt: a.acknowledged_at,
      startedAt: a.started_at,
      completedAt: a.completed_at,
      equipment: equipByAssignment.get(a.id) || [],
      inspection: inspectionByAssignment.get(a.id) || null,
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
    return { error: "Invalid test method. Supported methods: UT, MPT (or MT), DPT.", status: 400 };
  }

  const missing = missingFields(params.method, params.readings);
  const isDraft = params.draft !== false;
  const canFinalize = !isDraft && missing.length === 0;
  const now = new Date().toISOString();

  // Check if an inspection already exists for this assignment
  const { data: existingInspection } = await supabase
    .from("inspections")
    .select("id, submitted_at")
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  // Once submitted, the office works from it; the phone can no longer change or reopen it.
  if (existingInspection?.submitted_at) {
    return { error: "This report was already submitted. Ask the office to make changes.", status: 409 };
  }

  let inspectionId: string;

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
        submitted_at: canFinalize ? now : null,
      })
      .eq("id", inspectionId);

    if (updateError) {
      return { error: `Failed to update inspection: ${updateError.message}`, status: 500 };
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
        submitted_at: canFinalize ? now : null,
      })
      .select("id")
      .single();

    if (insertError || !newInspection) {
      return { error: `Failed to create inspection: ${insertError?.message || "Unknown error"}`, status: 500 };
    }
    inspectionId = newInspection.id;
  }

  if (canFinalize) {
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
    submittedAt: canFinalize ? now : null,
  };
}

/**
 * Uploads a photo/drawing attachment for an assignment.
 * Enforces 6 MB maximum and saves under documents/jobs/<job id>/<timestamp>-<name>.
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
    kind?: "site_photo" | "defect_photo" | "drawing" | string;
  },
): Promise<
  | { ok: true; attachmentId: string; storagePath: string }
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
      contentType: params.contentType || "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    return { error: `Storage upload failed: ${uploadError.message}`, status: 500 };
  }

  // Look up existing inspection for this assignment if any
  const { data: insp } = await supabase
    .from("inspections")
    .select("id")
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  const kind = params.kind || "site_photo";

  // Record attachment in the database
  const { data: att, error: dbError } = await supabase
    .from("attachments")
    .insert({
      job_id: assignment.job_id,
      inspection_id: insp?.id ?? null,
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
  };
}

/**
 * Records a message from a technician (delay, leave, equipment problem, site issue).
 */
export async function createTechnicianMessage(
  supabase: SupabaseClient<Database>,
  personId: string,
  params: {
    kind: Enums<"technician_message_kind">;
    body: string;
    jobId?: string | null;
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
    "other",
  ];

  if (!validKinds.includes(params.kind)) {
    return {
      error: `Invalid message kind. Expected one of: ${validKinds.join(", ")}`,
      status: 400,
    };
  }

  const { data, error } = await supabase
    .from("technician_messages")
    .insert({
      person_id: personId,
      kind: params.kind,
      body: params.body.trim(),
      job_id: params.jobId || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: `Failed to record message: ${error?.message || "Unknown error"}`, status: 500 };
  }

  return { ok: true, messageId: data.id };
}
