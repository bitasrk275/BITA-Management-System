import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parsePoFieldsInput } from "@/lib/modules/po/schema";
import { checkPoUtilization, saveJobPoFile, updateJobPoFields } from "@/lib/modules/po/service";
import { validUuid } from "@/lib/reports/review";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!validUuid(id)) {
    return apiError("Invalid job ID.", 400);
  }

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { data: job, error } = await auth.supabase
    .from("jobs")
    .select("id, job_no, customer_id, po_number, po_date, po_value, po_path")
    .eq("id", id)
    .maybeSingle();

  if (error || !job) {
    return apiError(error?.message ?? "Job not found.", 404);
  }

  const utilization = await checkPoUtilization(auth.supabase, {
    jobId: job.id,
    customerId: job.customer_id,
    poNumber: job.po_number,
    poValue: job.po_value,
  });

  return apiSuccess({
    job_id: job.id,
    job_no: job.job_no,
    po_number: job.po_number,
    po_date: job.po_date,
    po_value: job.po_value,
    po_path: job.po_path,
    utilization,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!validUuid(id)) {
    return apiError("Invalid job ID.", 400);
  }

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;
  if (!auth.person.roles.some((r) => r === "management" || r === "office")) {
    return apiError("Only management or office staff can update PO details.", 403);
  }

  let rawBody: FormData | Record<string, unknown>;
  let poFile: File | null = null;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const fd = await request.formData();
    rawBody = fd;
    const candidate = fd.get("po_file");
    if (candidate instanceof File && candidate.size > 0) {
      poFile = candidate;
    }
  } else {
    try {
      rawBody = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON request body.", 400);
    }
  }

  const parsed = parsePoFieldsInput(rawBody);
  if (!parsed.ok) {
    return apiError(parsed.error, 400);
  }

  const updateRes = await updateJobPoFields(auth.supabase, id, parsed.value);
  if (!updateRes.ok) {
    return apiError(updateRes.error, 400);
  }

  let fileError: string | null = null;
  if (poFile) {
    const fileRes = await saveJobPoFile(auth.supabase, id, poFile);
    fileError = fileRes.error;
  }

  const utilization = await checkPoUtilization(auth.supabase, {
    jobId: id,
    poNumber: parsed.value.po_number,
    poValue: parsed.value.po_value,
  });

  return apiSuccess({
    job_id: id,
    ...parsed.value,
    file_error: fileError,
    utilization,
  });
}
