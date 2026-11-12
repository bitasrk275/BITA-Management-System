import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { assignCalendarJob } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    if (!body.jobId || !body.technicianId || !body.workDate) {
      return apiError("jobId, technicianId, and workDate are required.", 400);
    }

    const assignment = await assignCalendarJob(auth.supabase, {
      jobId: body.jobId,
      technicianId: body.technicianId,
      workDate: body.workDate,
      endDate: body.endDate || null,
      equipmentIds: Array.isArray(body.equipmentIds) ? body.equipmentIds : [],
      notes: body.notes || null,
      force: Boolean(body.force),
    });

    return apiSuccess(assignment, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to assign job";
    return apiError(message, 400);
  }
}

