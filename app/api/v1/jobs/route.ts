import { type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import { parseJobInput } from "@/lib/modules/jobs/schema";
import { createJobRecord, listJobs } from "@/lib/modules/jobs/service";

export async function GET(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const customerId = searchParams.get("customer_id");
  const q = searchParams.get("q");

  const { data, error } = await listJobs(auth.supabase, {
    status,
    customerId,
    q,
  });

  if (error) return apiError(error, 400);
  return apiSuccess(data);
}

export async function POST(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseJobInput(body);
    if (!parsed.ok) return apiError(parsed.error, 400);

    const { data, error } = await createJobRecord(auth.supabase, parsed.value);
    if (error || !data) {
      return apiError(error ?? "Could not create job.", 400);
    }
    return apiSuccess(data, 201);
  } catch (err) {
    return apiError(
      err instanceof Error ? err.message : "Invalid JSON payload.",
      400,
    );
  }
}
