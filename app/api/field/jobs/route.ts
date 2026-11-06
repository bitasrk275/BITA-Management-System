import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/field/service";
import { authenticateDevice } from "../../../../lib/field/auth";
import { getTechnicianJobs } from "../../../../lib/field/assignments";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const authResult = await authenticateDevice(supabase, req.headers.get("authorization"));

    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const jobs = await getTechnicianJobs(supabase, authResult.auth.technician.id);
    return NextResponse.json(jobs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
