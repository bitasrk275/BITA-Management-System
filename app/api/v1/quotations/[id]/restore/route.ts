import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { restoreQuotationRecord } from "@/lib/modules/quotations/service";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const res = await restoreQuotationRecord(auth.supabase, id);
  if (!res.ok) return apiError(res.error, 400);
  return apiSuccess({ id, restored: true });
}
