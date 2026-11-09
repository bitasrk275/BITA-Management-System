import { NextResponse } from "next/server";
import { todayIST } from "@/lib/dates";
import { getSupabaseAdmin } from "@/lib/field/service";
import {
  broadcastTelegramNotification,
  buildExecutiveSnapshot,
  formatExecutiveDigestMessage,
} from "@/lib/modules/telegram/service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const secret = process.env.N8N_WEBHOOK_SECRET?.trim();
    const provided =
      req.headers.get("x-webhook-secret")?.trim() ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

    if (secret && provided !== secret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    let body: { kind?: string; message?: string; date?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // Allow empty body to trigger daily digest
    }

    const supabase = getSupabaseAdmin();
    const kind = (body.kind ?? "digest") as "report" | "invoice" | "payment" | "digest" | "test";

    let message = body.message?.trim() ?? "";
    if (!message) {
      const snap = await buildExecutiveSnapshot(supabase, body.date ?? todayIST());
      message = formatExecutiveDigestMessage(snap);
    }

    const result = await broadcastTelegramNotification(supabase, kind, message);
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to send Telegram notification",
      },
      { status: 500 },
    );
  }
}
