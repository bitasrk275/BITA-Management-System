import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { loadReportApprovalAssets } from "@/lib/reports/branding.server";
import { generateReportDocxBytes } from "@/lib/reports/docx";
import { extractReadings, supportedMethod, validUuid } from "@/lib/reports/review";
import type { ReportDocument } from "@/templates/reports/types";

export async function GET(
  _req: Request,
  context: { params: Promise<{ reportId: string }> }
) {
  const { reportId } = await context.params;
  if (!validUuid(reportId)) {
    return new NextResponse("Invalid report ID", { status: 400 });
  }

  const { supabase, person } = await requireStaff();
  if (!person) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    return new NextResponse("Report not found", { status: 404 });
  }

  if (!supportedMethod(report.method)) {
    return new NextResponse("Word (.docx) layout is available for UT, MPT, and DPT reports.", {
      status: 400,
    });
  }

  const [inspectionRes, attachmentsRes] = await Promise.all([
    report.inspection_id
      ? supabase
          .from("inspections")
          .select("readings")
          .eq("id", report.inspection_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("attachments")
      .select("kind, caption, storage_path")
      .eq("job_id", report.job_id)
      .eq("include_in_report", true)
      .order("uploaded_at", { ascending: true }),
  ]);

  const isApproved =
    (report.status === "approved" || report.status === "sent") && !!report.approved_at;
  const readings = extractReadings(report.content, inspectionRes.data?.readings);
  const attachments = attachmentsRes.data ?? [];

  const assets = await loadReportApprovalAssets(supabase, {
    approved: isApproved,
    approvedAt: report.approved_at,
    signatoryId: report.signatory_id,
    approvedBy: report.approved_by,
  });

  const doc: ReportDocument = {
    reportNumber: report.report_no,
    reportDate: report.report_date,
    letterhead: assets.letterhead,
    readings,
    approval: assets.approval,
    attachments: attachments.map((a) => ({
      kind: a.kind,
      caption: a.caption,
      storagePath: a.storage_path,
    })),
  };

  const docxBytes = await generateReportDocxBytes(report.method, doc);
  const safeFileName = report.report_no.replace(/[^A-Za-z0-9._-]+/g, "-") + ".docx";

  return new NextResponse(Buffer.from(docxBytes), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeFileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
