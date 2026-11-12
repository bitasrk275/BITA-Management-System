import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth";
import {
  jobRegisterToCsv,
  jobRegisterToExcelXml,
  loadJobRegisterRows,
} from "@/lib/modules/jobs/register-export";

export async function GET(request: NextRequest) {
  const { supabase, person } = await requireStaff();
  if (!person) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const fy = searchParams.get("fy");
  const month = searchParams.get("month");
  const customerId = searchParams.get("customer_id");
  const format = (searchParams.get("format") ?? "csv").toLowerCase();

  const { data, error } = await loadJobRegisterRows(supabase, {
    fy,
    month,
    customerId,
  });

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

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
