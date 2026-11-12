import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { listReports } from "@/lib/modules/reports/service";

export async function GET(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const invoicePendingParam = searchParams.get("invoice_pending");
  const invoicePending =
    invoicePendingParam === "1" ||
    invoicePendingParam === "true" ||
    status === "invoice_pending";
  const jobId = searchParams.get("job_id");
  const method = searchParams.get("method");

  const { data, error } = await listReports(auth.supabase, {
    status,
    invoicePending,
    jobId,
    method,
  });

  if (error) return apiError(error, 400);
  return apiSuccess(data);
}
