import { type NextRequest } from "next/server";
import {
  apiError,
  apiSuccess,
  requireApiStaff,
} from "@/lib/api/v1";
import { checkAiEnv } from "@/lib/env";
import { buildEnquiryPrefillFromEmail } from "@/lib/modules/enquiries/ai-assist";

export async function POST(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const aiEnv = checkAiEnv();
  if (!aiEnv.apiKey) {
    return apiError("AI extraction is not configured on this server.", 503);
  }

  let raw: Record<string, unknown> = {};
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON request body.", 400);
  }

  const rawEmail =
    typeof raw.raw_email === "string"
      ? raw.raw_email
      : typeof raw.email === "string"
        ? raw.email
        : "";

  const res = await buildEnquiryPrefillFromEmail(auth.supabase, rawEmail);
  if (!res.ok) {
    return apiError(res.error, 400);
  }

  return apiSuccess(res.data);
}
