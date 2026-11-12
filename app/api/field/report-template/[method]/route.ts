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
import {
  buildSeedTemplates,
  getOrSeedReportTemplates,
  templateConfigsToFieldDefinitions,
} from "../../../../../lib/modules/settings/templates";

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

    const rawMethod = (method || "").trim();
    const canonicalMethod = rawMethod.toUpperCase() === "MT" ? "MPT" : rawMethod;

    const dropdownOptions: Record<string, string[]> = {};
    for (const [k, vals] of Object.entries(DEFAULT_REPORT_DROPDOWN_OPTIONS)) {
      dropdownOptions[k] = [...vals];
    }
    let rememberedDefaults: Record<string, string> = {};

    let fields: readonly FieldDefinition[] = [];

    let templates = buildSeedTemplates();
    if (typeof (supabase as { from?: unknown })?.from === "function") {
      try {
        templates = await getOrSeedReportTemplates(supabase).catch(() => buildSeedTemplates());
        const { data: optData } = await supabase
          .from("settings_options")
          .select("list_key, value")
          .eq("active", true)
          .order("position", { ascending: true });

        for (const opt of optData ?? []) {
          const list = dropdownOptions[opt.list_key] ?? [];
          if (!list.includes(opt.value)) {
            list.push(opt.value);
          }
          dropdownOptions[opt.list_key] = list;
        }
      } catch {
        // Fall back to seed templates
      }
    }

    const methodFields = templates[canonicalMethod] || templates[rawMethod];
    const isStandardMethod =
      canonicalMethod === "UT" || canonicalMethod === "MPT" || canonicalMethod === "DPT";

    if (!methodFields && !isStandardMethod) {
      return NextResponse.json(
        { error: `Unsupported test method '${method}'. Expected UT, MPT (or MT), or DPT.` },
        { status: 400 },
      );
    }

    if (methodFields && methodFields.length > 0) {
      fields = templateConfigsToFieldDefinitions(methodFields, dropdownOptions);
    } else {
      try {
        const legacy = reportMethod(canonicalMethod as ReportMethodInput);
        fields = mergeCustomMethodFields(legacy, templates, dropdownOptions);
      } catch {
        fields = fieldsForMethod(canonicalMethod as ReportMethodInput);
      }
    }

    if (typeof (supabase as { from?: unknown })?.from === "function") {
      try {
        const url = new URL(req.url);
        const customerId = url.searchParams.get("customer_id")?.trim();
        if (customerId) {
          const queryMethod = isStandardMethod ? canonicalMethod : "general_inspection";
          const { data: prevInsp } = await supabase
            .from("inspections")
            .select("readings, jobs!inner(customer_id)")
            .eq("method", queryMethod)
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
        // Ignore customer defaults lookup error
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
