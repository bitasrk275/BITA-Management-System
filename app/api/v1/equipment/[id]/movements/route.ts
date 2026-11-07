import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseEquipmentMovementInput } from "@/lib/modules/equipment/schema";
import { listEquipmentMovements, recordEquipmentMovement } from "@/lib/modules/equipment/service";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await props.params;

  try {
    const data = await listEquipmentMovements(auth.supabase, id);
    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list equipment movements";
    return apiError(message, 400);
  }
}

export async function POST(
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
    const parsed = parseEquipmentMovementInput({
      ...body,
      equipment_id: id,
      moved_by: auth.person.id,
    });
    const data = await recordEquipmentMovement(auth.supabase, parsed);
    return apiSuccess(data, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record movement";
    return apiError(message, 400);
  }
}
