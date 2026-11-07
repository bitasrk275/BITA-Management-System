import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { loadReportApprovalAssets } from "@/lib/reports/branding.server";
import {
  extractReadings,
  generateReportPdfBytes,
  reportPdfStoragePath,
  validUuid,
} from "@/lib/reports/review";

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

  const isApproved =
    (report.status === "approved" || report.status === "sent") && !!report.approved_at;
  const safeFileName =
    report.report_no.replace(/[^A-Za-z0-9._-]+/g, "-") +
    (isApproved ? ".pdf" : "-draft.pdf");

  if (isApproved) {
    const storagePath =
      report.pdf_path || reportPdfStoragePath(report.job_id, report.report_no);
    const { data: storedBlob } = await supabase.storage
      .from("reports")
      .download(storagePath);

    if (storedBlob && storedBlob.size > 0) {
      const ab = await storedBlob.arrayBuffer();
      return new NextResponse(ab, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFileName}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
  }

  const [inspectionRes, jobRes, attachmentsRes] = await Promise.all([
    report.inspection_id
      ? supabase
          .from("inspections")
          .select("readings")
          .eq("id", report.inspection_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("jobs")
      .select("job_no, customers(name)")
      .eq("id", report.job_id)
      .maybeSingle(),
    supabase
      .from("attachments")
      .select("kind, caption, storage_path")
      .eq("job_id", report.job_id)
      .eq("include_in_report", true)
      .order("uploaded_at", { ascending: true }),
  ]);

  const readings = extractReadings(report.content, inspectionRes.data?.readings);
  const attachments = attachmentsRes.data ?? [];
  const assets = await loadReportApprovalAssets(supabase, {
    approved: isApproved,
    approvedAt: report.approved_at,
    signatoryId: report.signatory_id,
    approvedBy: report.approved_by,
  });

  const pdfBytes = generateReportPdfBytes({
    reportNo: report.report_no,
    reportDate: report.report_date,
    method: report.method,
    jobNo: jobRes.data?.job_no ?? report.job_id,
    customerName: jobRes.data?.customers?.name ?? String(readings.client ?? "Customer"),
    readings,
    letterhead: assets.letterhead,
    approval: assets.approval,
    attachments: attachments.map((a) => ({
      kind: a.kind,
      caption: a.caption,
      storagePath: a.storage_path,
    })),
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
