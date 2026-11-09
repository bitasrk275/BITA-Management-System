import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../../lib/field/service";
import { authenticateDevice } from "../../../../../../lib/field/auth";
import { submitInspectionReport } from "../../../../../../lib/field/assignments";
import { broadcastTelegramNotification } from "../../../../../../lib/modules/telegram/service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const authResult = await authenticateDevice(supabase, req.headers.get("authorization"));

    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await req.json().catch(() => ({}));
    const { method, readings, observations, draft } = body;

    const result = await submitInspectionReport(supabase, id, authResult.auth.technician.id, {
      method,
      readings,
      observations,
      draft,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (!draft && typeof (supabase as { from?: unknown })?.from === "function") {
      try {
        await broadcastTelegramNotification(
          supabase,
          "report",
          `📝 *Field Report Submitted*\n• *Technician:* ${authResult.auth.technician.name}\n• *Method:* ${method}\n• *Status:* Ready for Technical Review`,
        );
      } catch {
        // Non-blocking notification
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
