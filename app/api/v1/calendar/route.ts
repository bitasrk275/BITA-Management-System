import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { getCalendarView } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const technicianId = searchParams.get("technicianId");

    const data = await getCalendarView(auth.supabase, {
      startDate,
      endDate,
      technicianId,
    });

    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load calendar";
    return apiError(message, 400);
  }
}

