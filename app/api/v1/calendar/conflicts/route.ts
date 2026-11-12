import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { checkCalendarConflicts } from "@/lib/modules/calendar/service";
import type { Enums } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const searchParams = request.nextUrl.searchParams;

    const technicianId = searchParams.get("technicianId");
    const workDate = searchParams.get("workDate");
    const endDate = searchParams.get("endDate");
    const excludeAssignmentId = searchParams.get("excludeAssignmentId");
    const rawEquipmentIds = searchParams.get("equipmentIds");
    const equipmentIds = rawEquipmentIds ? rawEquipmentIds.split(",").filter(Boolean) : [];
    const rawMethods = searchParams.get("jobMethods");
    const jobMethods = rawMethods ? (rawMethods.split(",").filter(Boolean) as Enums<"test_method">[]) : [];

    if (!technicianId || !workDate) {
      return apiError("technicianId and workDate are required.", 400);
    }

    const conflicts = await checkCalendarConflicts(auth.supabase, {
      technicianId,
      workDate,
      endDate: endDate || null,
      equipmentIds,
      excludeAssignmentId: excludeAssignmentId || null,
      jobMethods,
    });

    return apiSuccess(conflicts);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to check conflicts";
    return apiError(message, 400);
  }
}

