import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { deleteCalendarAssignment } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await props.params;

    const result = await deleteCalendarAssignment(auth.supabase, id);
    return apiSuccess(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel assignment";
    return apiError(message, 400);
  }
}

