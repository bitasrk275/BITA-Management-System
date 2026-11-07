import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../../lib/field/service";
import { authenticateDevice } from "../../../../../../lib/field/auth";
import {
  uploadFieldAttachment,
  MAX_PHOTO_BYTES,
} from "../../../../../../lib/field/assignments";

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

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { error: "Invalid multipart form data." },
        { status: 400 },
      );
    }

    const file = formData.get("file");
    if (!file || typeof file === "string" || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing or invalid file in upload." },
        { status: 400 },
      );
    }

    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 6 MB size limit." },
        { status: 400 },
      );
    }

    const caption = typeof formData.get("caption") === "string"
      ? (formData.get("caption") as string).trim()
      : null;

    const kind = typeof formData.get("kind") === "string"
      ? (formData.get("kind") as string).trim()
      : "site_photo";

    const fileName = (file as File).name || "field-photo.jpg";
    const contentType = file.type || "image/jpeg";
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const result = await uploadFieldAttachment(supabase, id, authResult.auth.technician.id, {
      fileBuffer,
      fileName,
      contentType,
      caption,
      kind,
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
