import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/field/service";
import { authenticateDevice } from "../../../../lib/field/auth";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const authResult = await authenticateDevice(supabase, req.headers.get("authorization"));

    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await req.json().catch(() => ({}));
    const { pushToken } = body;

    const { error } = await supabase
      .from("technician_devices")
      .update({ push_token: pushToken || null })
      .eq("id", authResult.auth.deviceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
