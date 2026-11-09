import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/field/service";
import { authenticateDevice } from "../../../../../lib/field/auth";
import {
  DEFAULT_REPORT_DROPDOWN_OPTIONS,
  extractCustomerRememberedDefaults,
  fieldsForMethod,
  mergeCustomMethodFields,
  reportMethod,
  REPEATING_GROUPS,
  type FieldDefinition,
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

    let fields: readonly FieldDefinition[] = fieldsForMethod(canonicalMethod);
    const dropdownOptions: Record<string, string[]> = {};
    for (const [k, vals] of Object.entries(DEFAULT_REPORT_DROPDOWN_OPTIONS)) {
      dropdownOptions[k] = [...vals];
    }
    let rememberedDefaults: Record<string, string> = {};

    if (typeof (supabase as { from?: unknown })?.from === "function") {
      try {
        const url = new URL(req.url);
        const customerId = url.searchParams.get("customer_id")?.trim();

        const [tplRes, optRes] = await Promise.all([
          supabase.from("settings").select("value").eq("key", "report_templates").maybeSingle(),
          supabase
            .from("settings_options")
            .select("list_key, value")
            .eq("active", true)
            .order("position", { ascending: true }),
        ]);
        for (const opt of optRes.data ?? []) {
          const list = dropdownOptions[opt.list_key] ?? [];
          if (!list.includes(opt.value)) {
            list.push(opt.value);
          }
          dropdownOptions[opt.list_key] = list;
        }
        fields = mergeCustomMethodFields(
          canonicalMethod,
          tplRes.data?.value,
          dropdownOptions,
        );

        if (customerId) {
          const { data: prevInsp } = await supabase
            .from("inspections")
            .select("readings, jobs!inner(customer_id)")
            .eq("method", canonicalMethod)
            .eq("jobs.customer_id", customerId)
            .not("submitted_at", "is", null)
            .order("submitted_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (prevInsp?.readings) {
            rememberedDefaults = extractCustomerRememberedDefaults(prevInsp.readings);
          }
        }
      } catch {
        // Fall back to static METHOD_FIELDS if settings lookup fails
      }
    }

    return NextResponse.json({
      method: canonicalMethod,
      fields,
      repeatingGroups: REPEATING_GROUPS,
      dropdownOptions,
      rememberedDefaults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
