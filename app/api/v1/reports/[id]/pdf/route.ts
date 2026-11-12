import { NextResponse, type NextRequest } from "next/server";
import { requireApiStaff } from "@/lib/api/v1";
import { generateReportPdfDownload } from "@/lib/modules/reports/service";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const res = await generateReportPdfDownload(auth.supabase, id);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }

  return new NextResponse(Buffer.from(res.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${res.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
