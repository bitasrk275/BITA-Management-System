import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseCreateInvoiceFromReportsInput } from "@/lib/modules/invoices/schema";
import {
  createDraftInvoiceFromReports,
  listInvoicePendingReports,
} from "@/lib/modules/invoices/service";

export async function GET() {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const [invoicesRes, pendingReports] = await Promise.all([
    auth.supabase
      .from("invoices")
      .select(
        "id, job_id, kind, report_id, invoice_no, number, invoice_date, due_date, customer_po_number, taxable_value, cgst, sgst, igst, total, balance, status, issued_at, jobs(job_no, customer_id, customers(name, gstin)), invoice_reports(report_id, reports(report_no, method))",
      )
      .order("invoice_date", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false }),
    listInvoicePendingReports(auth.supabase).catch(() => []),
  ]);

  if (invoicesRes.error) {
    return apiError(invoicesRes.error.message, 400);
  }

  return apiSuccess({
    invoices: invoicesRes.data ?? [],
    pending_reports_count: pendingReports.length,
  });
}

export async function POST(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;
  if (!auth.person.roles.some((r) => r === "management" || r === "office")) {
    return apiError("Only management or office staff can prepare invoices.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON request body.", 400);
  }

  const parsed = parseCreateInvoiceFromReportsInput(body);
  if (!parsed.ok) {
    return apiError(parsed.error, 400);
  }

  try {
    const result = await createDraftInvoiceFromReports(auth.supabase, parsed.value);
    return apiSuccess(result, result.created ? 201 : 200);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Could not prepare draft invoice.",
      400,
    );
  }
}
