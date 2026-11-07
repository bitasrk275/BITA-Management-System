import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { restoreCustomerRecord } from "@/lib/modules/customers/service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const res = await restoreCustomerRecord(auth.supabase, id);
  if (!res.ok) {
    const status = res.error.toLowerCase().includes("only management") ? 403 : 400;
    return apiError(res.error, status);
  }

  return apiSuccess({ id, restored: true });
}
