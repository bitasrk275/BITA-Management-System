import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseCustomerInput } from "@/lib/modules/customers/schema";
import { createCustomerRecord, listCustomers } from "@/lib/modules/customers/service";

export async function GET(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const { data, error } = await listCustomers(auth.supabase, { q });
  if (error) return apiError(error, 400);

  return apiSuccess(data);
}

export async function POST(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const parsed = parseCustomerInput(body);
  if (!parsed.ok) {
    return apiError(parsed.error, 400);
  }

  const { data, error } = await createCustomerRecord(auth.supabase, parsed.value);
  if (error || !data) {
    return apiError(error ?? "Could not create customer.", 400);
  }

  return apiSuccess(data, 201);
}
