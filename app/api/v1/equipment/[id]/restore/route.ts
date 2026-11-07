import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { restoreEquipment } from "@/lib/modules/equipment/service";

export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { id } = await props.params;

  try {
    const data = await restoreEquipment(auth.supabase, id);
    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to restore equipment";
    return apiError(message, 400);
  }
}
