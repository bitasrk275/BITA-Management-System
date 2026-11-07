import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseEquipmentTypeInput } from "@/lib/modules/equipment/schema";
import { createEquipmentType, listEquipmentTypes } from "@/lib/modules/equipment/service";

export async function GET() {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const data = await listEquipmentTypes(auth.supabase);
    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list equipment types";
    return apiError(message, 400);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  try {
    const parsed = parseEquipmentTypeInput(body);
    const data = await createEquipmentType(auth.supabase, parsed);
    return apiSuccess(data, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create equipment type";
    return apiError(message, 400);
  }
}
