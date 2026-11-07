"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { Constants, type Enums } from "@/lib/db/types";
import { friendlyError, text } from "@/lib/forms";
import { parsePoValue } from "@/lib/modules/po/schema";
import { isJobReadyToClose } from "./closure";

type Supabase = Awaited<ReturnType<typeof requireStaff>>["supabase"];

function jobFields(fd: FormData) {
  const methods = fd
    .getAll("test_methods")
    .map(String)
    .filter((m): m is Enums<"test_method"> => (Constants.public.Enums.test_method as readonly string[]).includes(m));
  const poValRes = parsePoValue(fd, "po_value");
  return {
    fields: {
      customer_id: text(fd, "customer_id") ?? "",
      enquiry_id: text(fd, "enquiry_id"),
      quotation_id: text(fd, "quotation_id"),
      site: text(fd, "site"),
      scope: text(fd, "scope"),
      test_methods: methods,
      po_number: text(fd, "po_number"),
      po_date: text(fd, "po_date"),
      po_value: poValRes.ok ? poValRes.value : null,
    },
    poValueError: poValRes.ok ? null : poValRes.error,
  };
}

// Stores the PO file in the private documents bucket and records its path on the job.
async function savePoFile(supabase: Supabase, jobId: string, fd: FormData): Promise<string | null> {
  const file = fd.get("po_file");
  if (!(file instanceof File) || file.size === 0) return null;
  const path = `po/${jobId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type });
  if (error) return error.message;
  const { error: updateError } = await supabase.from("jobs").update({ po_path: path }).eq("id", jobId);
  return updateError?.message ?? null;
}

export async function createJob(fd: FormData) {
  const { supabase } = await requireStaff();
  const { fields, poValueError } = jobFields(fd);
  if (poValueError) {
    redirect("/jobs/new?error=" + encodeURIComponent(poValueError));
  }

  if (fields.quotation_id && !fields.enquiry_id) {
    const { data: qt } = await supabase
      .from("quotations")
      .select("enquiry_id")
      .eq("id", fields.quotation_id)
      .maybeSingle();
    if (qt?.enquiry_id) {
      fields.enquiry_id = qt.enquiry_id;
    }
  }

  const { data, error } = await supabase.from("jobs").insert(fields).select("id").single();
  if (error) redirect("/jobs/new?error=" + encodeURIComponent(friendlyError(error.message)));

  if (fields.enquiry_id) {
    await supabase.from("enquiries").update({ status: "converted" }).eq("id", fields.enquiry_id);
    revalidatePath(`/enquiries/${fields.enquiry_id}`);
    revalidatePath("/enquiries");
  }
  if (fields.quotation_id) {
    revalidatePath(`/quotations/${fields.quotation_id}`);
    revalidatePath("/quotations");
  }
  const fileError = await savePoFile(supabase, data.id, fd);
  redirect(`/jobs/${data.id}` + (fileError ? "?error=" + encodeURIComponent("Job saved, but the PO file was not: " + fileError) : ""));
}

export async function updateJob(id: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const { fields, poValueError } = jobFields(fd);
  if (poValueError) {
    redirect(`/jobs/${id}?error=` + encodeURIComponent(poValueError));
  }
  const status = text(fd, "status") as Enums<"job_status"> | null;
  const { error } = await supabase
    .from("jobs")
    .update({
      ...fields,
      ...(status ? { status, closed_at: status === "closed" ? new Date().toISOString() : null } : {}),
    })
    .eq("id", id);
  if (error) redirect(`/jobs/${id}?error=` + encodeURIComponent(friendlyError(error.message)));
  const fileError = await savePoFile(supabase, id, fd);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  redirect(`/jobs/${id}` + (fileError ? "?error=" + encodeURIComponent("PO file not saved: " + fileError) : "?saved=1"));
}

export async function closeJob(id: string) {
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    redirect(`/jobs/${id}?error=` + encodeURIComponent("Only management or office staff can close a job."));
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
        encodeURIComponent("Job can only be closed once the report is sent and no invoice balance is outstanding.")
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
    redirect(`/jobs/${id}?error=` + encodeURIComponent(friendlyError(error.message)));
  }

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath("/office");
  redirect(`/jobs/${id}?saved=closed`);
}
