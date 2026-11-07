import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { convertProformaToTaxInvoice } from "@/lib/modules/invoices/service";
import { validUuid } from "@/lib/reports/review";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validUuid(id)) {
    return apiError("Invalid proforma invoice ID.", 400);
  }

  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;
  if (!auth.person.roles.some((r) => r === "management" || r === "office")) {
    return apiError("Only management or office staff can convert a proforma invoice.", 403);
  }

  try {
    const result = await convertProformaToTaxInvoice(auth.supabase, id);
    return apiSuccess(result, result.created ? 201 : 200);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Could not convert proforma to tax invoice.",
      400,
    );
  }
}
