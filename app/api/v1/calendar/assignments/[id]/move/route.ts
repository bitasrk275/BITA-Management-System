import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { moveCalendarAssignment } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await props.params;
    const body = await request.json();

    if (!body.newWorkDate) {
      return apiError("newWorkDate is required.", 400);
    }

    const updated = await moveCalendarAssignment(auth.supabase, {
      assignmentId: id,
      newWorkDate: body.newWorkDate,
      newEndDate: body.newEndDate || null,
      newTechnicianId: body.newTechnicianId || null,
      force: Boolean(body.force),
    });

    return apiSuccess(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to move assignment";
    return apiError(message, 400);
  }
}

