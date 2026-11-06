import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { generateInvoicePdfBytes } from "@/lib/invoices";
import { validUuid } from "@/lib/reports/review";
import { loadInvoiceTemplateInput } from "../load-template-input";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validUuid(id)) {
    return NextResponse.json({ error: "Invalid invoice ID." }, { status: 400 });
  }

  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const loaded = await loadInvoiceTemplateInput(supabase, id);
  if (!loaded) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const pdfBytes = generateInvoicePdfBytes(loaded.input);

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${loaded.filenameBase}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
