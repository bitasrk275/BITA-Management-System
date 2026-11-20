import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { validUuid } from "@/lib/reports/review";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validUuid(id)) {
    return NextResponse.json({ error: "Invalid receipt ID." }, { status: 400 });
  }

  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { data: receipt } = await supabase
    .from("payment_receipts")
    .select("id, advice_path")
    .eq("id", id)
    .maybeSingle();

  if (!receipt || !receipt.advice_path) {
    return NextResponse.json({ error: "Payment advice file not found." }, { status: 404 });
  }

  const { data: fileBlob, error: dlErr } = await supabase.storage
    .from("documents")
    .download(receipt.advice_path);

  if (dlErr || !fileBlob) {
    return NextResponse.json(
      { error: dlErr?.message ?? "Could not download payment advice file." },
      { status: 404 },
    );
  }

  const filename = receipt.advice_path.split("/").pop() || `payment-advice-${id}.pdf`;
  const bytes = Buffer.from(await fileBlob.arrayBuffer());

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": fileBlob.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
