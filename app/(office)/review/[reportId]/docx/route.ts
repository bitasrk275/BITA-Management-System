import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { generateReportDocxDownload } from "@/lib/modules/reports/service";

export async function GET(
  _req: Request,
  context: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await context.params;
  const { supabase, person } = await requireStaff();
  if (!person) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const res = await generateReportDocxDownload(supabase, reportId);
  if (!res.ok) {
    return new NextResponse(res.error, { status: res.status });
  }

  return new NextResponse(Buffer.from(res.bytes), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${res.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
