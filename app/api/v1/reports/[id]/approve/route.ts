import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseApproveReportInput } from "@/lib/modules/reports/schema";
import { approveReportRecord } from "@/lib/modules/reports/service";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const parsed = parseApproveReportInput(body);
  const { data, error } = await approveReportRecord(
    auth.supabase,
    id,
    { id: auth.person.id, roles: auth.person.roles },
    parsed,
  );

  if (error || !data) {
    return apiError(error ?? "Could not approve report.", 400);
  }
  return apiSuccess(data);
}
