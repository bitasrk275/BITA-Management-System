"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { text } from "@/lib/forms";
import {
  assignCalendarJob,
  createLeaveDay,
  deleteCalendarAssignment,
  deleteLeaveDay,
  moveCalendarAssignment,
} from "@/lib/modules/calendar/service";
import { createClient } from "@/lib/supabase/server";

export type CalendarModalResult =
  | { ok: true; date?: string; message: string }
  | { ok: false; error: string };

export async function submitAssignJobModalAction(formData: FormData): Promise<CalendarModalResult> {
  await requireStaff();
  const supabase = await createClient();

  const jobId = text(formData, "job_id");
  const technicianId = text(formData, "technician_id");
  const workDate = text(formData, "work_date");
  const endDate = text(formData, "end_date");
  const notes = text(formData, "notes");
  const force = formData.get("force") === "1" || formData.get("force") === "true" || formData.get("force") === "on";

  const rawEquip = formData.getAll("equipment_ids");
  const equipmentIds = rawEquip.map((v) => String(v).trim()).filter(Boolean);

  if (!jobId || !technicianId || !workDate) {
    return { ok: false, error: "Job, technician, and work date are required." };
  }

  try {
    await assignCalendarJob(supabase, {
      jobId,
      technicianId,
      workDate,
      endDate: endDate || null,
      equipmentIds,
      notes: notes || null,
      force,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to assign job";
    return { ok: false, error: msg };
  }

  revalidatePath("/calendar");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/assign`);
  revalidatePath("/dashboard");
  revalidatePath("/office");

  return {
    ok: true,
    date: workDate,
    message: "Job scheduled and technician notified.",
  };
}

export async function submitMoveAssignmentModalAction(formData: FormData): Promise<CalendarModalResult> {
  await requireStaff();
  const supabase = await createClient();

  const assignmentId = text(formData, "assignment_id");
  const newWorkDate = text(formData, "new_work_date");
  const newEndDate = text(formData, "new_end_date");
  const newTechnicianId = text(formData, "new_technician_id");
  const force = formData.get("force") === "1" || formData.get("force") === "true" || formData.get("force") === "on";

  if (!assignmentId || !newWorkDate) {
    return { ok: false, error: "Assignment ID and new date are required." };
  }

  try {
    await moveCalendarAssignment(supabase, {
      assignmentId,
      newWorkDate,
      newEndDate: newEndDate || null,
      newTechnicianId: newTechnicianId || undefined,
      force,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to move assignment";
    return { ok: false, error: msg };
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath("/office");

  return {
    ok: true,
    date: newWorkDate,
    message: "Assignment updated and technician notified.",
  };
}

export async function submitDeleteAssignmentModalAction(assignmentId: string): Promise<CalendarModalResult> {
  await requireStaff();
  const supabase = await createClient();

  if (!assignmentId) {
    return { ok: false, error: "Assignment ID is required." };
  }

  try {
    await deleteCalendarAssignment(supabase, assignmentId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to remove assignment";
    return { ok: false, error: msg };
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath("/office");

  return {
    ok: true,
    message: "Job unassigned from calendar.",
  };
}

export async function submitRecordLeaveModalAction(formData: FormData): Promise<CalendarModalResult> {
  const { user } = await requireStaff();
  const supabase = await createClient();

  const personId = text(formData, "person_id");
  const leaveDate = text(formData, "leave_date");
  const reason = text(formData, "reason");

  if (!personId || !leaveDate) {
    return { ok: false, error: "Technician and leave date are required." };
  }

  try {
    await createLeaveDay(
      supabase,
      {
        personId,
        leaveDate,
        reason: reason || null,
      },
      user.id
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to record leave";
    return { ok: false, error: msg };
  }

  revalidatePath("/calendar");

  return {
    ok: true,
    date: leaveDate,
    message: "Technician leave recorded.",
  };
}

export async function assignJobFromCalendarAction(formData: FormData) {
  const res = await submitAssignJobModalAction(formData);
  const workDate = text(formData, "work_date") ?? "";
  const jobId = text(formData, "job_id") ?? "";
  if (!res.ok) {
    redirect(`/calendar?error=${encodeURIComponent(res.error)}&jobId=${jobId}&date=${workDate}`);
  }
  redirect(`/calendar?saved=assigned&date=${res.date ?? workDate}`);
}

export async function moveAssignmentAction(formData: FormData) {
  const res = await submitMoveAssignmentModalAction(formData);
  const newWorkDate = text(formData, "new_work_date") ?? "";
  if (!res.ok) {
    redirect(`/calendar?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/calendar?saved=moved&date=${res.date ?? newWorkDate}`);
}

export async function deleteAssignmentAction(formData: FormData) {
  const assignmentId = text(formData, "assignment_id") ?? "";
  const res = await submitDeleteAssignmentModalAction(assignmentId);
  if (!res.ok) {
    redirect(`/calendar?error=${encodeURIComponent(res.error)}`);
  }
  redirect("/calendar?saved=unassigned");
}

export async function recordLeaveAction(formData: FormData) {
  const res = await submitRecordLeaveModalAction(formData);
  const leaveDate = text(formData, "leave_date") ?? "";
  if (!res.ok) {
    redirect(`/calendar?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/calendar?saved=leave&date=${res.date ?? leaveDate}`);
}

export async function deleteLeaveAction(formData: FormData) {
  await requireStaff();
  const supabase = await createClient();

  const leaveId = text(formData, "leave_id");
  if (!leaveId) {
    redirect("/calendar?error=" + encodeURIComponent("Leave ID is required."));
  }

  try {
    await deleteLeaveDay(supabase, leaveId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete leave";
    redirect(`/calendar?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/calendar");
  redirect("/calendar?saved=leave_deleted");
}
