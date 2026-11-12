import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { createLeaveDay, listLeaveDays } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const personId = searchParams.get("personId");

    const leaveDays = await listLeaveDays(auth.supabase, {
      startDate,
      endDate,
      personId,
    });

    return apiSuccess(leaveDays);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list leave days";
    return apiError(message, 400);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    if (!body.personId || !body.leaveDate) {
      return apiError("personId and leaveDate are required.", 400);
    }

    const leaveDay = await createLeaveDay(
      auth.supabase,
      {
        personId: body.personId,
        leaveDate: body.leaveDate,
        reason: body.reason || null,
      },
      auth.user.id
    );

    return apiSuccess(leaveDay, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create leave day";
    return apiError(message, 400);
  }
}

