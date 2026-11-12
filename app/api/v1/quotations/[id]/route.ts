import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseQuotationInput } from "@/lib/modules/quotations/schema";
import {
  deleteQuotationRecord,
  getQuotationDetail,
  updateQuotationRecord,
} from "@/lib/modules/quotations/service";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { data, error } = await getQuotationDetail(auth.supabase, id);
  if (error) return apiError(error, 400);
  if (!data) return apiError("Quotation not found.", 404);
  return apiSuccess(data);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseQuotationInput(body);
    if (!parsed.ok) return apiError(parsed.error, 400);

    const { data, error } = await updateQuotationRecord(
      auth.supabase,
      id,
      parsed.value,
      { id: auth.person.id, roles: auth.person.roles },
    );
    if (error || !data) {
      return apiError(error ?? "Could not update quotation.", 400);
    }
    return apiSuccess(data);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Invalid JSON payload.",
      400,
    );
  }
}

export const PUT = PATCH;

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const res = await deleteQuotationRecord(
    auth.supabase,
    id,
    auth.person.roles,
  );
  if (!res.ok) return apiError(res.error, 400);
  return apiSuccess({ id, deleted: true });
}
