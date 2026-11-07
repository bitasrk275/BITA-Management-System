import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import type { Json } from "@/lib/db/types";
import { parseSettingsOptionInput } from "@/lib/modules/settings/schema";
import {
  createSettingsOption,
  listSettings,
  listSettingsOptions,
  upsertSetting,
} from "@/lib/modules/settings/service";

export async function GET(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const listKey = url.searchParams.get("list_key") ?? undefined;
  const activeOnly = url.searchParams.get("active") === "1";

  const [settingsRes, optionsRes] = await Promise.all([
    listSettings(auth.supabase),
    listSettingsOptions(auth.supabase, { listKey, activeOnly }),
  ]);

  if (settingsRes.error) return apiError(settingsRes.error, 400);
  if (optionsRes.error) return apiError(optionsRes.error, 400);

  return apiSuccess({
    settings: settingsRes.data,
    options: optionsRes.data,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  if (typeof body.key === "string" && body.value !== undefined) {
    const { data, error } = await upsertSetting(
      auth.supabase,
      body.key,
      body.value as Json,
      typeof body.description === "string" ? body.description : undefined,
      auth.person.id,
    );
    if (error || !data) {
      const status = (error ?? "").toLowerCase().includes("row-level security") ? 403 : 400;
      return apiError(error ?? "Could not update setting.", status);
    }
    return apiSuccess(data);
  }

  if (typeof body.list_key === "string") {
    const parsed = parseSettingsOptionInput(body);
    if (!parsed.ok) return apiError(parsed.error, 400);
    const { data, error } = await createSettingsOption(auth.supabase, parsed.value);
    if (error || !data) return apiError(error ?? "Could not create option.", 400);
    return apiSuccess(data, 201);
  }

  return apiError("Provide either { key, value } for settings or { list_key, value } for options.", 400);
}
