import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { todayIST } from "@/lib/dates";
import { parseCreateCreditNoteInput } from "@/lib/modules/invoices/schema";
import { createCreditNoteForInvoice } from "@/lib/modules/invoices/service";
import { validUuid } from "@/lib/reports/review";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validUuid(id)) {
    return apiError("Invalid invoice ID.", 400);
  }

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("credit_notes")
    .select("*")
    .eq("invoice_id", id)
    .order("credit_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return apiError(error.message, 400);
  }
  return apiSuccess(data ?? []);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validUuid(id)) {
    return apiError("Invalid invoice ID.", 400);
  }

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;
  if (!auth.person.roles.some((r) => r === "management" || r === "office")) {
    return apiError("Only management or office staff can issue credit notes.", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON request body.", 400);
  }

  const parsed = parseCreateCreditNoteInput(
    { ...body, invoice_id: id },
    todayIST(),
  );
  if (!parsed.ok) {
    return apiError(parsed.error, 400);
  }

  try {
    const creditNote = await createCreditNoteForInvoice(
      auth.supabase,
      parsed.value,
    );
    return apiSuccess(creditNote, 201);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Could not issue credit note.",
      400,
    );
  }
}
