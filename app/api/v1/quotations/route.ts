import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseQuotationInput } from "@/lib/modules/quotations/schema";
import {
  createQuotationRecord,
  listQuotations,
} from "@/lib/modules/quotations/service";

export async function GET(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const customerId = searchParams.get("customer_id");
  const q = searchParams.get("q");

  const { data, error } = await listQuotations(auth.supabase, {
    status,
    customerId,
    q,
  });

  if (error) return apiError(error, 400);
  return apiSuccess(data);
}

export async function POST(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseQuotationInput(body);
    if (!parsed.ok) return apiError(parsed.error, 400);

    const { data, error } = await createQuotationRecord(
      auth.supabase,
      parsed.value,
    );
    if (error || !data) {
      return apiError(error ?? "Could not create quotation.", 400);
    }
    return apiSuccess(data, 201);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Invalid JSON payload.",
      400,
    );
  }
}
