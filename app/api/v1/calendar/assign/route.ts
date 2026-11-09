import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { assignCalendarJob } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireStaff();
    const body = await request.json();

    if (!body.jobId || !body.technicianId || !body.workDate) {
      return NextResponse.json(
        { ok: false, error: "jobId, technicianId, and workDate are required." },
        { status: 400 }
      );
    }

    const assignment = await assignCalendarJob(supabase, {
      jobId: body.jobId,
      technicianId: body.technicianId,
      workDate: body.workDate,
      endDate: body.endDate || null,
      equipmentIds: Array.isArray(body.equipmentIds) ? body.equipmentIds : [],
      notes: body.notes || null,
      force: Boolean(body.force),
    });

    return NextResponse.json({ ok: true, data: assignment }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to assign job";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
