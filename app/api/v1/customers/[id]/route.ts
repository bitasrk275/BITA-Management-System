import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseCustomerInput } from "@/lib/modules/customers/schema";
import {
  deleteCustomerRecord,
  getCustomerDetail,
  updateCustomerRecord,
} from "@/lib/modules/customers/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { data, error } = await getCustomerDetail(auth.supabase, id);
  if (error) return apiError(error, 400);
  if (!data) return apiError("Customer not found.", 404);

  return apiSuccess(data);
}

async function handleUpdate(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
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

  const { data, error } = await updateCustomerRecord(auth.supabase, id, parsed.value);
  if (error || !data) {
    return apiError(error ?? "Could not update customer.", 400);
  }

  return apiSuccess(data);
}

export const PATCH = handleUpdate;
export const PUT = handleUpdate;

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const res = await deleteCustomerRecord(auth.supabase, id);
  if (!res.ok) {
    const status = res.error.toLowerCase().includes("only management") ? 403 : 400;
    return apiError(res.error, status);
  }

  return apiSuccess({ id, deleted: true });
}
