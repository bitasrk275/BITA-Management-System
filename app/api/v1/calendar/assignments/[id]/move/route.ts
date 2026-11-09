import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { moveCalendarAssignment } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireStaff();
    const { id } = await props.params;
    const body = await request.json();

    if (!body.newWorkDate) {
      return NextResponse.json(
        { ok: false, error: "newWorkDate is required." },
        { status: 400 }
      );
    }

    const updated = await moveCalendarAssignment(supabase, {
      assignmentId: id,
      newWorkDate: body.newWorkDate,
      newEndDate: body.newEndDate || null,
      newTechnicianId: body.newTechnicianId || null,
      force: Boolean(body.force),
    });

    return NextResponse.json({ ok: true, data: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to move assignment";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
