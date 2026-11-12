import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { getReportDetail } from "@/lib/modules/reports/service";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { data, error } = await getReportDetail(auth.supabase, id);
  if (error) return apiError(error, 400);
  if (!data) return apiError("Report not found.", 404);
  return apiSuccess(data);
}
