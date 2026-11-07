"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendlyError, text } from "@/lib/forms";
import { notifyTechnician } from "../../../../../lib/field/notify";

export async function assignTechnician(jobId: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const person_id = text(fd, "person_id");
  const work_date = text(fd, "work_date");
  const notes = text(fd, "notes");
  const equipmentIds = fd
    .getAll("equipment_ids")
    .map((v) => String(v).trim())
    .filter(Boolean);

  if (!person_id) {
    redirect(`/jobs/${jobId}/assign?error=` + encodeURIComponent("Please select a technician."));
  }
  if (!work_date) {
    redirect(`/jobs/${jobId}/assign?error=` + encodeURIComponent("Please select a work date."));
  }

  const { data: assignment, error } = await supabase
    .from("assignments")
    .insert({
      job_id: jobId,
      person_id,
      work_date,
      notes,
      notified_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !assignment) {
    redirect(
      `/jobs/${jobId}/assign?error=` +
        encodeURIComponent(friendlyError(error?.message ?? "Could not create assignment.")),
    );
  }

  if (equipmentIds.length > 0) {
    const rows = equipmentIds.map((equipment_id) => ({
      assignment_id: assignment.id,
      equipment_id,
    }));
    const { error: eqError } = await supabase.from("assignment_equipment").insert(rows);
    if (eqError) {
      revalidatePath(`/jobs/${jobId}`);
      revalidatePath(`/jobs/${jobId}/assign`);
      redirect(
        `/jobs/${jobId}/assign?error=` +
          encodeURIComponent("Technician assigned, but equipment was not saved: " + friendlyError(eqError.message)),
      );
    }
  }

  // Advance job status from enquiry_received or awaiting_approval to scheduled when first assigned.
  const { data: job } = await supabase
    .from("jobs")
    .select("status, customer_id, customers (name)")
    .eq("id", jobId)
    .maybeSingle();

  if (job && (job.status === "enquiry_received" || job.status === "awaiting_approval")) {
    await supabase.from("jobs").update({ status: "scheduled" }).eq("id", jobId);
  }

  // Push notification to technician's linked phones (T34 / docs/FIELD_APP.md)
  const customerName = (job?.customers as { name?: string } | null)?.name || "Customer";
  await notifyTechnician(
    supabase,
    person_id,
    {
      title: "New Job Assigned",
      body: `New job: ${customerName} · ${work_date}`,
      data: { jobId, assignmentId: assignment.id },
    },
  ).catch(() => null);

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/assign`);
  redirect(`/jobs/${jobId}/assign?saved=1`);
}

export async function updateAssignment(jobId: string, assignmentId: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const work_date = text(fd, "work_date");
  const notes = text(fd, "notes");
  const equipmentIds = fd
    .getAll("equipment_ids")
    .map((v) => String(v).trim())
    .filter(Boolean);

  if (!work_date) {
    redirect(`/jobs/${jobId}/assign?error=` + encodeURIComponent("Work date is required."));
  }

  const { error } = await supabase
    .from("assignments")
    .update({ work_date, notes })
    .eq("id", assignmentId)
    .eq("job_id", jobId);

  if (error) {
    redirect(`/jobs/${jobId}/assign?error=` + encodeURIComponent(friendlyError(error.message)));
  }

  const { error: deleteEqError } = await supabase
    .from("assignment_equipment")
    .delete()
    .eq("assignment_id", assignmentId);

  if (deleteEqError) {
    redirect(`/jobs/${jobId}/assign?error=` + encodeURIComponent(friendlyError(deleteEqError.message)));
  }

  if (equipmentIds.length > 0) {
    const { error: insertEqError } = await supabase.from("assignment_equipment").insert(
      equipmentIds.map((equipment_id) => ({
        assignment_id: assignmentId,
        equipment_id,
      })),
    );
    if (insertEqError) {
      redirect(`/jobs/${jobId}/assign?error=` + encodeURIComponent(friendlyError(insertEqError.message)));
    }
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/assign`);
  redirect(`/jobs/${jobId}/assign?saved=1`);
}

export async function removeAssignment(jobId: string, assignmentId: string) {
  const { supabase } = await requireStaff();
  const { error } = await supabase
    .from("assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("job_id", jobId);

  if (error) {
    redirect(`/jobs/${jobId}/assign?error=` + encodeURIComponent(friendlyError(error.message)));
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/assign`);
  redirect(`/jobs/${jobId}/assign?saved=1`);
}
