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

export async function assignJobFromCalendarAction(formData: FormData) {
  await requireStaff();
  const supabase = await createClient();

  const jobId = text(formData, "job_id");
  const technicianId = text(formData, "technician_id");
  const workDate = text(formData, "work_date");
  const endDate = text(formData, "end_date");
  const notes = text(formData, "notes");
  const force = formData.get("force") === "1" || formData.get("force") === "true";

  const rawEquip = formData.getAll("equipment_ids");
  const equipmentIds = rawEquip.map((v) => String(v).trim()).filter(Boolean);

  if (!jobId || !technicianId || !workDate) {
    redirect("/calendar?error=" + encodeURIComponent("Job, technician, and work date are required."));
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
    redirect(`/calendar?error=${encodeURIComponent(msg)}&jobId=${jobId}&date=${workDate}`);
  }

  revalidatePath("/calendar");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  redirect(`/calendar?saved=assigned&date=${workDate}`);
}

export async function moveAssignmentAction(formData: FormData) {
  await requireStaff();
  const supabase = await createClient();

  const assignmentId = text(formData, "assignment_id");
  const newWorkDate = text(formData, "new_work_date");
  const newEndDate = text(formData, "new_end_date");
  const newTechnicianId = text(formData, "new_technician_id");
  const force = formData.get("force") === "1" || formData.get("force") === "true";

  if (!assignmentId || !newWorkDate) {
    redirect("/calendar?error=" + encodeURIComponent("Assignment ID and new date are required."));
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
    redirect(`/calendar?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  redirect(`/calendar?saved=moved&date=${newWorkDate}`);
}

export async function deleteAssignmentAction(formData: FormData) {
  await requireStaff();
  const supabase = await createClient();

  const assignmentId = text(formData, "assignment_id");
  if (!assignmentId) {
    redirect("/calendar?error=" + encodeURIComponent("Assignment ID is required."));
  }

  try {
    await deleteCalendarAssignment(supabase, assignmentId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to remove assignment";
    redirect(`/calendar?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  redirect("/calendar?saved=unassigned");
}

export async function recordLeaveAction(formData: FormData) {
  const { user } = await requireStaff();
  const supabase = await createClient();

  const personId = text(formData, "person_id");
  const leaveDate = text(formData, "leave_date");
  const reason = text(formData, "reason");

  if (!personId || !leaveDate) {
    redirect("/calendar?error=" + encodeURIComponent("Technician and leave date are required."));
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
    redirect(`/calendar?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/calendar");
  redirect(`/calendar?saved=leave&date=${leaveDate}`);
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
