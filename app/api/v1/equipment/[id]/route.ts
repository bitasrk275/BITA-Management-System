import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseEquipmentItemInput } from "@/lib/modules/equipment/schema";
import { deleteEquipment, getEquipment, updateEquipment } from "@/lib/modules/equipment/service";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await props.params;

  try {
    const data = await getEquipment(auth.supabase, id);
    if (!data) return apiError("Equipment not found", 404);
    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch equipment";
    return apiError(message, 400);
  }
}

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await props.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  try {
    const parsed = parseEquipmentItemInput(body);
    const data = await updateEquipment(auth.supabase, id, parsed);
    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update equipment";
    return apiError(message, 400);
  }
}

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await props.params;

  try {
    const data = await deleteEquipment(auth.supabase, id);
    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete equipment";
    return apiError(message, 400);
  }
}
