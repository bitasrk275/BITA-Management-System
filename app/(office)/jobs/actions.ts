"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendlyError, text } from "@/lib/forms";
import { assignCalendarJob } from "@/lib/modules/calendar/service";
import { resolveCustomerFromForm } from "@/lib/modules/customers/inline";
import { parseJobInput } from "@/lib/modules/jobs/schema";
import {
  closeJobRecord,
  createJobRecord,
  deleteJobRecord,
  reopenJobRecord,
  updateJobRecord,
} from "@/lib/modules/jobs/service";

type Supabase = Awaited<ReturnType<typeof requireStaff>>["supabase"];

async function savePoFile(
  supabase: Supabase,
  jobId: string,
  fd: FormData,
): Promise<string | null> {
  const file = fd.get("po_file");
  if (!(file instanceof File) || file.size === 0) return null;
  const path = `po/${jobId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const { error } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType: file.type });
  if (error) return error.message;
  const { error: updateError } = await supabase
    .from("jobs")
    .update({ po_path: path })
    .eq("id", jobId);
  return updateError?.message ?? null;
}

export async function createJob(fd: FormData) {
  const { supabase } = await requireStaff();
  const customer = await resolveCustomerFromForm(supabase, fd);
  if (!customer.ok) {
    redirect("/jobs/new?error=" + encodeURIComponent(customer.error));
  }
  fd.set("customer_id", customer.customerId);
  const parsed = parseJobInput(fd);
  if (!parsed.ok) {
    redirect("/jobs/new?error=" + encodeURIComponent(parsed.error));
  }

  const { data, error } = await createJobRecord(supabase, parsed.value);
  if (error || !data) {
    redirect(
      "/jobs/new?error=" +
        encodeURIComponent(friendlyError(error ?? "Could not create job.")),
    );
  }

  if (customer.created) revalidatePath("/customers");
  if (data.enquiry_id) {
    revalidatePath(`/enquiries/${data.enquiry_id}`);
    revalidatePath("/enquiries");
  }
  if (data.quotation_id) {
    revalidatePath(`/quotations/${data.quotation_id}`);
    revalidatePath("/quotations");
  }
  const problems: string[] = [];
  const fileError = await savePoFile(supabase, data.id, fd);
  if (fileError) problems.push("the PO file was not saved: " + fileError);

  // Schedule on the same screen: one assignment per technician, same dates and equipment.
  const workDate = text(fd, "work_date");
  const technicianIds = fd.getAll("technician_ids").map(String).filter(Boolean);
  const equipmentIds = fd.getAll("equipment_ids").map(String).filter(Boolean);
  if (workDate && technicianIds.length > 0) {
    for (const [i, technicianId] of technicianIds.entries()) {
      try {
        await assignCalendarJob(supabase, {
          jobId: data.id,
          technicianId,
          workDate,
          endDate: text(fd, "end_date"),
          // Equipment travels with the first technician, so it is booked once.
          equipmentIds: i === 0 ? equipmentIds : [],
          notes: null,
          force: false,
        });
      } catch (err) {
        problems.push(err instanceof Error ? err.message : "a technician could not be scheduled");
      }
    }
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
  } else if (technicianIds.length > 0 && !workDate) {
    problems.push("no start date was given, so it is not on the calendar yet");
  }

  const note = problems.length
    ? "?error=" + encodeURIComponent("Job created, but " + problems.join("; ") + ". Schedule it from the Calendar.")
    : "";
  if (!problems.length && text(fd, "return_to") === "calendar" && workDate) {
    redirect(`/calendar?date=${workDate}&saved=1`);
  }
  redirect(`/jobs/${data.id}` + note);
}

export async function updateJob(id: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const parsed = parseJobInput(fd);
  if (!parsed.ok) {
    redirect(`/jobs/${id}?error=` + encodeURIComponent(parsed.error));
  }

  const { error } = await updateJobRecord(supabase, id, parsed.value);
  if (error) {
    redirect(
      `/jobs/${id}?error=` + encodeURIComponent(friendlyError(error)),
    );
  }

  const fileError = await savePoFile(supabase, id, fd);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  redirect(
    `/jobs/${id}` +
      (fileError
        ? "?error=" + encodeURIComponent("PO file not saved: " + fileError)
        : "?saved=1"),
  );
}

export async function closeJob(id: string) {
  const { supabase, person } = await requireStaff();
  const { error } = await closeJobRecord(supabase, id, person?.roles);
  if (error) {
    redirect(
      `/jobs/${id}?error=` + encodeURIComponent(friendlyError(error)),
    );
  }

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath("/office");
  redirect(`/jobs/${id}?saved=closed`);
}

export async function reopenJob(id: string) {
  const { supabase, person } = await requireStaff();
  const { error } = await reopenJobRecord(supabase, id, person?.roles);
  if (error) {
    redirect(
      `/jobs/${id}?error=` + encodeURIComponent(friendlyError(error)),
    );
  }

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath("/office");
  redirect(`/jobs/${id}?saved=reopened`);
}

export async function deleteJob(jobId: string) {
  const { supabase, person } = await requireStaff();
  const res = await deleteJobRecord(supabase, jobId, person?.roles);
  if (!res.ok) {
    redirect(
      `/jobs/${jobId}?error=` + encodeURIComponent(friendlyError(res.error)),
    );
  }
  revalidatePath("/jobs");
  revalidatePath("/recycle-bin");
  redirect("/jobs?deleted=1");
}

export async function deleteJobAction(jobId: string) {
  return deleteJob(jobId);
}
