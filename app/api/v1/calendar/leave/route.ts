import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { createLeaveDay, listLeaveDays } from "@/lib/modules/calendar/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireStaff();
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const personId = searchParams.get("personId");

    const leaveDays = await listLeaveDays(supabase, {
      startDate,
      endDate,
      personId,
    });

    return NextResponse.json({ ok: true, data: leaveDays });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list leave days";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireStaff();
    const body = await request.json();

    if (!body.personId || !body.leaveDate) {
      return NextResponse.json(
        { ok: false, error: "personId and leaveDate are required." },
        { status: 400 }
      );
    }

    const leaveDay = await createLeaveDay(
      supabase,
      {
        personId: body.personId,
        leaveDate: body.leaveDate,
        reason: body.reason || null,
      },
      user.id
    );

    return NextResponse.json({ ok: true, data: leaveDay }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create leave day";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
