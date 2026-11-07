import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { getCalibrationAlerts } from "@/lib/modules/equipment/service";

export async function GET(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const thresholdDaysParam = url.searchParams.get("threshold_days");
  const thresholdDays = thresholdDaysParam ? parseInt(thresholdDaysParam, 10) : undefined;
  const refDateStr = url.searchParams.get("ref_date") ?? undefined;

  try {
    const alerts = await getCalibrationAlerts(auth.supabase, {
      thresholdDays,
      refDateStr,
    });
    return apiSuccess(alerts);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch calibration alerts";
    return apiError(message, 400);
  }
}
