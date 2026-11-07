import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parsePriceItemInput } from "@/lib/modules/price-items/schema";
import { createPriceItem, listPriceItems } from "@/lib/modules/price-items/service";

export async function GET(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const activeOnly = searchParams.get("active") === "true" || searchParams.get("active") === "1";

  const { data, error } = await listPriceItems(auth.supabase, {
    activeOnly,
    search: q,
  });

  if (error) {
    return apiError(error, 400);
  }
  return apiSuccess(data);
}

export async function POST(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;
  if (!auth.person.roles.some((r) => r === "management" || r === "office")) {
    return apiError("Only management or office staff can create price items.", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON request body.", 400);
  }

  const parsed = parsePriceItemInput(body);
  if (!parsed.ok) {
    return apiError(parsed.error, 400);
  }

  const { data, error } = await createPriceItem(auth.supabase, parsed.value);
  if (error || !data) {
    return apiError(error ?? "Could not create price item.", 400);
  }

  return apiSuccess(data, 201);
}
