import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { listInvoicePendingReports } from "@/lib/modules/invoices/service";

export async function GET() {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const pending = await listInvoicePendingReports(auth.supabase);
    return apiSuccess({
      count: pending.length,
      reports: pending,
    });
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Could not load invoice-pending reports.",
      400,
    );
  }
}
