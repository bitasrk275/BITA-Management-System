import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { checkCalendarConflicts } from "@/lib/modules/calendar/service";
import type { Enums } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireStaff();
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
      return NextResponse.json(
        { ok: false, error: "technicianId and workDate are required." },
        { status: 400 }
      );
    }

    const conflicts = await checkCalendarConflicts(supabase, {
      technicianId,
      workDate,
      endDate: endDate || null,
      equipmentIds,
      excludeAssignmentId: excludeAssignmentId || null,
      jobMethods,
    });

    return NextResponse.json({ ok: true, data: conflicts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to check conflicts";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
