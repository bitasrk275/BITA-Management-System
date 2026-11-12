"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendlyError } from "@/lib/forms";
import { parseJobInput } from "@/lib/modules/jobs/schema";
import {
  createJobRecord,
  deleteJobRecord,
  updateJobRecord,
} from "@/lib/modules/jobs/service";
import { isJobReadyToClose } from "./closure";

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

  if (data.enquiry_id) {
    revalidatePath(`/enquiries/${data.enquiry_id}`);
    revalidatePath("/enquiries");
  }
  if (data.quotation_id) {
    revalidatePath(`/quotations/${data.quotation_id}`);
    revalidatePath("/quotations");
  }
  const fileError = await savePoFile(supabase, data.id, fd);
  redirect(
    `/jobs/${data.id}` +
      (fileError
        ? "?error=" +
          encodeURIComponent("Job saved, but the PO file was not: " + fileError)
        : ""),
  );
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
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    redirect(
      `/jobs/${id}?error=` +
        encodeURIComponent("Only management or office staff can close a job."),
    );
  }

  const [jobRes, reportsRes, invoicesRes] = await Promise.all([
    supabase.from("jobs").select("id, status").eq("id", id).maybeSingle(),
    supabase.from("reports").select("status, sent_at").eq("job_id", id),
    supabase.from("invoices").select("kind, balance").eq("job_id", id),
  ]);

  if (!jobRes.data) redirect("/jobs");

  const ready = isJobReadyToClose({
    status: jobRes.data.status,
    reports: reportsRes.data ?? [],
    invoices: invoicesRes.data ?? [],
  });

  if (!ready) {
    redirect(
      `/jobs/${id}?error=` +
        encodeURIComponent(
          "Job can only be closed once the report is sent and no invoice balance is outstanding.",
        ),
    );
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    redirect(
      `/jobs/${id}?error=` + encodeURIComponent(friendlyError(error.message)),
    );
  }

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath("/office");
  redirect(`/jobs/${id}?saved=closed`);
}

export async function deleteJobAction(jobId: string) {
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
