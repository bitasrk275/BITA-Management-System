import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/field/service";
import { redeemPairingCode } from "../../../../lib/field/pairing";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { code, deviceName, pushToken } = body;

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    const supabase = getSupabaseAdmin();
    const result = await redeemPairingCode(supabase, {
      code,
      deviceName,
      pushToken,
      ip,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      deviceId: result.deviceId,
      secret: result.secret,
      technician: {
        name: result.technician.name,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
