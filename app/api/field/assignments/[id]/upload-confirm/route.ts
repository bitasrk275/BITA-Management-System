import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../../lib/field/service";
import { authenticateDevice } from "../../../../../../lib/field/auth";
import { confirmDirectUpload } from "../../../../../../lib/field/assignments";

export const runtime = "nodejs";

/**
 * Confirms a completed direct Supabase storage upload and creates the attachment row.
 * Strictly enforces that storagePath is located inside `jobs/${job_id}/`.
 */
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

    const body = await req.json().catch(() => null);
    if (!body || typeof body.storagePath !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid storagePath in confirmation." },
        { status: 400 },
      );
    }

    const result = await confirmDirectUpload(
      supabase,
      id,
      authResult.auth.technician.id,
      {
        storagePath: body.storagePath,
        kind: typeof body.kind === "string" ? body.kind : null,
        caption: typeof body.caption === "string" ? body.caption : null,
        linkInspection: Boolean(body.linkInspection),
        contentType: typeof body.contentType === "string" ? body.contentType : null,
      },
    );

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
