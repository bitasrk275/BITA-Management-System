import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseAcceptQuotationInput } from "@/lib/modules/po/schema";
import { acceptQuotationAndRecordPo } from "@/lib/modules/po/service";
import { validUuid } from "@/lib/reports/review";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!validUuid(id)) {
    return apiError("Invalid quotation ID.", 400);
  }

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  let rawBody: FormData | Record<string, unknown> | null = null;
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
      rawBody = null;
    }
  }

  const parsed = parseAcceptQuotationInput(rawBody);
  if (!parsed.ok) {
    return apiError(parsed.error, 400);
  }

  const result = await acceptQuotationAndRecordPo(
    auth.supabase,
    id,
    { id: auth.person.id, roles: auth.person.roles },
    parsed.value,
    poFile,
  );

  if (!result.ok) {
    return apiError(result.error, 400);
  }

  return apiSuccess({
    quotation_id: result.quotationId,
    job_id: result.jobId,
    job_no: result.jobNo,
    file_error: result.fileError,
  });
}
