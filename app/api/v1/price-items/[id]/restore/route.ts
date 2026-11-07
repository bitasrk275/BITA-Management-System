import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { restorePriceItem } from "@/lib/modules/price-items/service";
import { validUuid } from "@/lib/reports/review";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!validUuid(id)) return apiError("Invalid price item ID.", 400);

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const res = await restorePriceItem(auth.supabase, id);
  if (!res.ok) return apiError(res.error, 403);

  return apiSuccess({ id, restored: true });
}
