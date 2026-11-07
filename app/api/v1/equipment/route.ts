import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import {
  type CalibrationStatus,
  type EquipmentStatus,
  parseEquipmentItemInput,
} from "@/lib/modules/equipment/schema";
import { createEquipment, listEquipment } from "@/lib/modules/equipment/service";

export async function GET(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status: EquipmentStatus | "all" | undefined =
    statusParam === "in_office" || statusParam === "at_site" || statusParam === "out_for_calibration"
      ? statusParam
      : undefined;

  const typeId = url.searchParams.get("type_id") ?? undefined;
  const search = url.searchParams.get("search") ?? url.searchParams.get("q") ?? undefined;
  const calParam = url.searchParams.get("calibration_status");
  const calibrationStatus: CalibrationStatus | undefined =
    calParam === "valid" || calParam === "due_soon" || calParam === "expired" || calParam === "unknown"
      ? calParam
      : undefined;

  try {
    const data = await listEquipment(auth.supabase, {
      status,
      typeId,
      search,
      calibrationStatus,
    });
    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list equipment";
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
    const parsed = parseEquipmentItemInput(body);
    const data = await createEquipment(auth.supabase, parsed);
    return apiSuccess(data, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create equipment";
    return apiError(message, 400);
  }
}
