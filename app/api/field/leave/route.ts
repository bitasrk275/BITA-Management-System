import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/field/service";
import { authenticateDevice } from "../../../../lib/field/auth";
import {
  listTechnicianLeave,
  submitTechnicianLeaveRequest,
} from "../../../../lib/field/assignments";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const authResult = await authenticateDevice(supabase, req.headers.get("authorization"));

    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const result = await listTechnicianLeave(supabase, authResult.auth.technician.id);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const authResult = await authenticateDevice(supabase, req.headers.get("authorization"));

    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const json = await req.json().catch(() => ({}));
    const startDate = typeof json?.startDate === "string" ? json.startDate : "";
    const endDate = typeof json?.endDate === "string" ? json.endDate : startDate;
    const reason = typeof json?.reason === "string" ? json.reason : null;

    const result = await submitTechnicianLeaveRequest(supabase, authResult.auth.technician.id, {
      startDate,
      endDate,
      reason,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
