import { NextResponse, type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import {
  jobRegisterToCsv,
  jobRegisterToExcelXml,
  loadJobRegisterRows,
} from "@/lib/modules/jobs/register-export";

export async function GET(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const fy = searchParams.get("fy");
  const month = searchParams.get("month");
  const customerId = searchParams.get("customer_id");
  const format = (searchParams.get("format") ?? "json").toLowerCase();

  const { data, error } = await loadJobRegisterRows(auth.supabase, {
    fy,
    month,
    customerId,
  });

  if (error) return apiError(error, 400);

  const suffix = month || (fy && fy !== "all" ? `FY-${fy}` : "all");

  if (format === "xls" || format === "excel") {
    const xml = jobRegisterToExcelXml(data);
    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="bita-jobs-register-${suffix}.xls"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "csv") {
    const csv = jobRegisterToCsv(data);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bita-jobs-register-${suffix}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return apiSuccess(data);
}
