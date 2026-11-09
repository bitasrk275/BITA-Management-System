import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import {
  toB2bCsv,
  toB2cCsv,
  toCombinedGstCsv,
  toCreditNotesCsv,
  toGstExcelXml,
} from "@/lib/invoices";
import { loadGstExportData } from "../load";

export async function GET(req: Request) {
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = (url.searchParams.get("format") ?? "combined").toLowerCase();

  const { fromDate, toDate, report } = await loadGstExportData(supabase, {
    month,
    from,
    to,
  });

  if (format === "b2b") {
    const csv = toB2bCsv(report);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="BITA-GSTR1-B2B-${fromDate}-to-${toDate}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (format === "b2c") {
    const csv = toB2cCsv(report);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="BITA-GSTR1-B2C-${fromDate}-to-${toDate}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (format === "credit_notes" || format === "cn") {
    const csv = toCreditNotesCsv(report);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="BITA-GSTR1-CreditNotes-${fromDate}-to-${toDate}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (format === "excel" || format === "xls") {
    const xml = toGstExcelXml(report);
    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="BITA-GSTR1-${fromDate}-to-${toDate}.xls"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const csv = toCombinedGstCsv(report);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="BITA-GSTR1-${fromDate}-to-${toDate}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
