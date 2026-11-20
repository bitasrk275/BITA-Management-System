import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../../lib/field/service";
import { authenticateDevice } from "../../../../../../lib/field/auth";
import { createDirectUploadUrl } from "../../../../../../lib/field/assignments";

export const runtime = "nodejs";

/**
 * Generates a signed Supabase upload URL for direct client upload (up to 25 MB).
 * Bypasses Vercel serverless function 4.5 MB request payload limit.
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

    const body = await req.json().catch(() => ({}));
    const fileName = typeof body.fileName === "string" ? body.fileName : "upload";
    const contentType = typeof body.contentType === "string" ? body.contentType : null;

    const result = await createDirectUploadUrl(
      supabase,
      id,
      authResult.auth.technician.id,
      { fileName, contentType },
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
