import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/field/service";
import { authenticateDevice } from "../../../../../lib/field/auth";
import {
  fieldsForMethod,
  reportMethod,
  REPEATING_GROUPS,
  type ReportMethodInput,
} from "../../../../../lib/reports/fields";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ method: string }> },
) {
  try {
    const { method } = await params;
    const supabase = getSupabaseAdmin();
    const authResult = await authenticateDevice(supabase, req.headers.get("authorization"));

    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    let canonicalMethod;
    try {
      canonicalMethod = reportMethod(method as ReportMethodInput);
    } catch {
      return NextResponse.json(
        { error: `Unsupported test method '${method}'. Expected UT, MPT (or MT), or DPT.` },
        { status: 400 },
      );
    }

    const fields = fieldsForMethod(canonicalMethod);

    return NextResponse.json({
      method: canonicalMethod,
      fields,
      repeatingGroups: REPEATING_GROUPS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
