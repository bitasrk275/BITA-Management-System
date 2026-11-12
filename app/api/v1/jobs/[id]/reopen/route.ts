import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { reopenJobRecord } from "@/lib/modules/jobs/service";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { data, error } = await reopenJobRecord(
    auth.supabase,
    id,
    auth.person.roles,
  );
  if (error || !data) {
    return apiError(error ?? "Could not reopen job", 400);
  }

  return apiSuccess({ job: data });
}
