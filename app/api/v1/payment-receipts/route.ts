import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import {
  listJobsForPaymentsReceived,
  recordMultiJobPaymentReceipt,
} from "@/lib/modules/invoices/payments-received";
import { validUuid } from "@/lib/reports/review";

export async function GET(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;
  if (!auth.person.roles.some((r) => r === "management" || r === "office")) {
    return apiError("Only management or office staff can view payment receipts.", 403);
  }

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customer_id");

  try {
    const data = await listJobsForPaymentsReceived(auth.supabase, {
      customerId: customerId && validUuid(customerId) ? customerId : null,
    });
    return apiSuccess(data);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Could not load payment receipts.",
      400,
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;
  if (!auth.person.roles.some((r) => r === "management" || r === "office")) {
    return apiError("Only management or office staff can record payment receipts.", 403);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return apiError("Invalid JSON request body.", 400);
    }
    body = raw as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON request body.", 400);
  }

  const rawJobIds = Array.isArray(body.job_ids) ? body.job_ids : [];
  const jobIds = rawJobIds
    .map((id) => String(id ?? "").trim())
    .filter((id) => validUuid(id));

  if (jobIds.length === 0) {
    return apiError("Provide at least one valid job_id in job_ids.", 400);
  }

  try {
    const result = await recordMultiJobPaymentReceipt(auth.supabase, {
      job_ids: jobIds,
      customer_id:
        typeof body.customer_id === "string" && validUuid(body.customer_id)
          ? body.customer_id
          : null,
      received_on: typeof body.received_on === "string" ? body.received_on : null,
      amount:
        body.amount !== null && body.amount !== undefined && body.amount !== ""
          ? Number(body.amount)
          : null,
      mode: typeof body.mode === "string" ? body.mode : "NEFT",
      reference: typeof body.reference === "string" ? body.reference : null,
      advice_path: typeof body.advice_path === "string" ? body.advice_path : null,
      tds_by_job_id:
        body.tds_by_job_id && typeof body.tds_by_job_id === "object"
          ? (body.tds_by_job_id as Record<string, number>)
          : undefined,
      notes: typeof body.notes === "string" ? body.notes : null,
      created_by: auth.person.id,
    });
    return apiSuccess(result, 201);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Could not record payment receipt.",
      400,
    );
  }
}
