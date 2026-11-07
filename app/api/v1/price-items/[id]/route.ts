import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parsePriceItemInput } from "@/lib/modules/price-items/schema";
import {
  getPriceItemById,
  softDeletePriceItem,
  updatePriceItem,
} from "@/lib/modules/price-items/service";
import { validUuid } from "@/lib/reports/review";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!validUuid(id)) return apiError("Invalid price item ID.", 400);

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { data, error } = await getPriceItemById(auth.supabase, id);
  if (error) return apiError(error, 400);
  if (!data) return apiError("Price item not found.", 404);

  return apiSuccess(data);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!validUuid(id)) return apiError("Invalid price item ID.", 400);

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;
  if (!auth.person.roles.some((r) => r === "management" || r === "office")) {
    return apiError("Only management or office staff can update price items.", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON request body.", 400);
  }

  const parsed = parsePriceItemInput(body);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const { data, error } = await updatePriceItem(auth.supabase, id, parsed.value);
  if (error || !data) return apiError(error ?? "Could not update price item.", 400);

  return apiSuccess(data);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!validUuid(id)) return apiError("Invalid price item ID.", 400);

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const res = await softDeletePriceItem(auth.supabase, id);
  if (!res.ok) return apiError(res.error, 403);

  return apiSuccess({ id, deleted: true });
}
