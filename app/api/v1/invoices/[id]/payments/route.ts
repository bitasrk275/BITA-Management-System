import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { todayIST } from "@/lib/dates";
import { parseRecordPaymentInput } from "@/lib/modules/invoices/schema";
import { recordInvoicePayment } from "@/lib/modules/invoices/service";
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
    .from("payments")
    .select("*")
    .eq("invoice_id", id)
    .order("paid_on", { ascending: false })
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
    return apiError("Only management or office staff can record payments.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON request body.", 400);
  }

  const parsed = parseRecordPaymentInput(body, todayIST());
  if (!parsed.ok) {
    return apiError(parsed.error, 400);
  }

  try {
    const payment = await recordInvoicePayment(auth.supabase, id, parsed.value);
    return apiSuccess(payment, 201);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Could not record payment.",
      400,
    );
  }
}
