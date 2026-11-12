import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseReturnReportInput } from "@/lib/modules/reports/schema";
import { returnReportRecord } from "@/lib/modules/reports/service";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseReturnReportInput(body);
    if (!parsed.ok) return apiError(parsed.error, 400);

    const { data, error } = await returnReportRecord(
      auth.supabase,
      id,
      { id: auth.person.id, full_name: auth.person.full_name },
      parsed.value.note,
    );

    if (error || !data) {
      return apiError(error ?? "Could not return report.", 400);
    }
    return apiSuccess(data);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Invalid JSON payload.",
      400,
    );
  }
}
