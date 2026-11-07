import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { deleteLeaveDay } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireStaff();
    const { id } = await props.params;

    const result = await deleteLeaveDay(supabase, id);
    return NextResponse.json({ ok: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete leave day";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
