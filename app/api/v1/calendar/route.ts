import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { getCalendarView } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireStaff();
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const technicianId = searchParams.get("technicianId");

    const data = await getCalendarView(supabase, {
      startDate,
      endDate,
      technicianId,
    });

    return NextResponse.json({ ok: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load calendar";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
