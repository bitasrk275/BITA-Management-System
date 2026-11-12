import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { generateReportPdfDownload } from "@/lib/modules/reports/service";

export async function GET(
  _req: Request,
  context: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await context.params;
  const { supabase, person } = await requireStaff();
  if (!person) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const res = await generateReportPdfDownload(supabase, reportId);
  if (!res.ok) {
    return new NextResponse(res.error, { status: res.status });
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
