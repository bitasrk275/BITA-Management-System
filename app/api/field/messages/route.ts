import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/field/service";
import { authenticateDevice } from "../../../../lib/field/auth";
import { createTechnicianMessage } from "../../../../lib/field/assignments";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const authResult = await authenticateDevice(supabase, req.headers.get("authorization"));

    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const json = await req.json().catch(() => ({}));
    const { kind, body, jobId } = json;

    const result = await createTechnicianMessage(supabase, authResult.auth.technician.id, {
      kind,
      body,
      jobId,
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
