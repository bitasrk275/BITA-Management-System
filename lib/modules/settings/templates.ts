import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Json } from "../../db/types";
import {
  DEFAULT_REPORT_DROPDOWN_OPTIONS,
  type FieldDefinition,
  type ReportFieldKind,
} from "../../reports/fields";
import {
  createSettingsOption,
  getSetting,
  listSettingsOptions,
  upsertSetting,
} from "./service";

export type TemplateFieldKind = "fixed" | "dropdown" | "typed";

export type TemplateFieldConfig = {
  key: string;
  label: string;
  kind: TemplateFieldKind;
  input: "text" | "date" | "number" | "textarea";
  options?: string[];
  required: boolean;
  fixed?: boolean;
};

export type ReportTemplatesMap = Record<string, TemplateFieldConfig[]>;

export interface TestMethodOption {
  id: string;
  code: string;
  label: string;
  position: number;
  active: boolean;
}

export const STANDARD_TEST_METHODS = [
  { code: "UT", label: "Ultrasonic Testing (UT)" },
  { code: "MPT", label: "Magnetic Particle Testing (MPT)" },
  { code: "DPT", label: "Dye Penetrant Testing (DPT)" },
  { code: "RT", label: "Radiographic Testing (RT)" },
  { code: "VT", label: "Visual Testing (VT)" },
  { code: "hardness", label: "Hardness Testing" },
  { code: "metallography", label: "Metallography" },
  { code: "RLA", label: "Remaining Life Assessment (RLA)" },
  { code: "certification", label: "Certification" },
  { code: "general_inspection", label: "General Inspection" },
] as const;

export function parseTestMethodValue(raw: string): { code: string; label: string } {
  const trimmed = (raw || "").trim();
  if (trimmed.includes("|")) {
    const parts = trimmed.split("|");
    const code = (parts[0] || "").trim();
    const label = parts.slice(1).join("|").trim() || code;
    return { code, label };
  }
  return { code: trimmed, label: trimmed };
}

/**
 * Returns configured test methods from settings_options (list_key = 'test_methods').
 * If none exist yet, automatically seeds the 10 standard test methods.
 */
export async function getOrSeedTestMethods(
  supabase: SupabaseClient<Database>,
): Promise<TestMethodOption[]> {
  const { data: existing } = await listSettingsOptions(supabase, { listKey: "test_methods" });
  if (existing && existing.length > 0) {
    return existing.map((opt) => {
      const { code, label } = parseTestMethodValue(opt.value);
      return {
        id: opt.id,
        code,
        label,
        position: opt.position,
        active: opt.active,
      };
    });
  }

  // Seed default 10 methods into settings_options
  const seeded: TestMethodOption[] = [];
  for (let i = 0; i < STANDARD_TEST_METHODS.length; i++) {
    const item = STANDARD_TEST_METHODS[i];
    const { data } = await createSettingsOption(supabase, {
      list_key: "test_methods",
      value: `${item.code} | ${item.label}`,
      position: (i + 1) * 10,
      active: true,
    });
    if (data) {
      seeded.push({
        id: data.id,
        code: item.code,
        label: item.label,
        position: data.position,
        active: data.active,
      });
    }
  }

  return seeded;
}

export async function getActiveTestMethods(
  supabase: SupabaseClient<Database>,
): Promise<TestMethodOption[]> {
  const all = await getOrSeedTestMethods(supabase);
  return all.filter((m) => m.active);
}

/**
 * Maps any test method code (including custom ones) to a valid PostgreSQL enum value
 * ('UT' | 'MPT' | 'DPT' | 'RT' | 'VT' | 'hardness' | 'metallography' | 'RLA' | 'certification' | 'general_inspection')
 */
export function mapToCanonicalTestMethodEnum(code: string): Enums<"test_method"> {
  const c = (code || "").trim();
  if (c.toUpperCase() === "MT") return "MPT";
  if (
    [
      "UT",
      "MPT",
      "DPT",
      "RT",
      "VT",
      "hardness",
      "metallography",
      "RLA",
      "certification",
      "general_inspection",
    ].includes(c)
  ) {
    return c as Enums<"test_method">;
  }
  // Try case-insensitive matching for standard codes
  const upper = c.toUpperCase();
  if (upper === "UT" || upper === "MPT" || upper === "DPT" || upper === "RT" || upper === "VT" || upper === "RLA") {
    return upper as Enums<"test_method">;
  }
  const lower = c.toLowerCase();
  if (lower === "hardness" || lower === "metallography" || lower === "certification" || lower === "general_inspection") {
    return lower as Enums<"test_method">;
  }
  return "general_inspection";
}

/**
 * Builds standard seed templates for UT (29 fields), MPT, and DPT from lib/reports/fields.ts
 */
export function buildSeedTemplates(): ReportTemplatesMap {
  const shared: TemplateFieldConfig[] = [
    { key: "client", label: "Client", kind: "dropdown", input: "text", required: true },
    { key: "project", label: "Project", kind: "typed", input: "text", required: false },
    { key: "inspection_site", label: "Inspection site", kind: "typed", input: "text", required: true },
    { key: "inspection_date", label: "Inspection date", kind: "dropdown", input: "date", required: true },
  ];

  const ut: TemplateFieldConfig[] = [
    ...shared,
    {
      key: "equipment",
      label: "Equipment used",
      kind: "dropdown",
      input: "text",
      required: true,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.ut_equipment],
    },
    { key: "equipment_serial", label: "Equipment serial number", kind: "fixed", input: "text", required: true, fixed: true },
    { key: "equipment_calibration", label: "Equipment calibration dates", kind: "fixed", input: "text", required: false, fixed: true },
    {
      key: "probes",
      label: "Probe used",
      kind: "dropdown",
      input: "text",
      required: true,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.ut_probe],
    },
    {
      key: "reference_blocks",
      label: "Reference blocks",
      kind: "dropdown",
      input: "text",
      required: true,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.reference_blocks],
    },
    {
      key: "calibration_method",
      label: "Calibration method (DGS / DAC / BW)",
      kind: "dropdown",
      input: "text",
      required: false,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.calibration_method],
    },
    { key: "screen_range", label: "Screen range", kind: "typed", input: "text", required: true },
    { key: "sensitivity", label: "Sensitivity level", kind: "typed", input: "text", required: true },
    {
      key: "scanning_level",
      label: "Scanning level",
      kind: "dropdown",
      input: "text",
      required: true,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.scanning_level],
    },
    {
      key: "couplant",
      label: "Couplant",
      kind: "dropdown",
      input: "text",
      required: true,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.couplant],
    },
    {
      key: "surface_condition",
      label: "Surface condition",
      kind: "dropdown",
      input: "text",
      required: true,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.surface_condition],
    },
    {
      key: "standard",
      label: "Standard followed",
      kind: "dropdown",
      input: "text",
      required: true,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.ut_standard],
    },
    {
      key: "acceptance_criteria",
      label: "Acceptance criteria",
      kind: "dropdown",
      input: "text",
      required: true,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.ut_acceptance],
    },
  ];

  const mpt: TemplateFieldConfig[] = [
    ...shared,
    { key: "equipment", label: "Yoke / equipment used", kind: "dropdown", input: "text", required: true },
    { key: "equipment_serial", label: "Equipment serial number", kind: "fixed", input: "text", required: true, fixed: true },
    { key: "magnetic_medium", label: "Magnetic medium", kind: "dropdown", input: "text", required: true },
    { key: "standard", label: "Standard followed", kind: "dropdown", input: "text", required: true },
    { key: "magnetisation_method", label: "Magnetisation method", kind: "dropdown", input: "text", required: true },
    { key: "current", label: "Current used", kind: "dropdown", input: "text", required: true },
    { key: "visible_light_intensity", label: "Visible light intensity", kind: "typed", input: "text", required: true },
    { key: "black_light", label: "Black light device", kind: "dropdown", input: "text", required: false },
    { key: "black_light_intensity", label: "Black light intensity", kind: "typed", input: "text", required: true },
    { key: "test_block", label: "Test block", kind: "dropdown", input: "text", required: true },
    { key: "yoke_lifting_capacity", label: "Lifting capacity of yoke", kind: "typed", input: "text", required: true },
  ];

  const dpt: TemplateFieldConfig[] = [
    ...shared,
    {
      key: "component_description",
      label: "Component description",
      kind: "dropdown",
      input: "textarea",
      required: true,
      options: [...DEFAULT_REPORT_DROPDOWN_OPTIONS.component_description],
    },
    { key: "cleaner", label: "Cleaner", kind: "dropdown", input: "text", required: true },
    { key: "cleaner_batch", label: "Cleaner batch number", kind: "typed", input: "text", required: true },
    { key: "penetrant", label: "Penetrant", kind: "dropdown", input: "text", required: true },
    { key: "penetrant_batch", label: "Penetrant batch number", kind: "typed", input: "text", required: true },
    { key: "developer", label: "Developer", kind: "dropdown", input: "text", required: true },
    { key: "developer_batch", label: "Developer batch number", kind: "typed", input: "text", required: true },
    { key: "standard", label: "Standard followed", kind: "dropdown", input: "text", required: true },
    { key: "dwell_time", label: "Dwell time", kind: "typed", input: "text", required: true },
    { key: "developing_time", label: "Developing time", kind: "typed", input: "text", required: true },
  ];

  const general: TemplateFieldConfig[] = [
    ...shared,
    { key: "equipment", label: "Equipment / instrument used", kind: "typed", input: "text", required: false },
    { key: "equipment_serial", label: "Equipment serial number", kind: "fixed", input: "text", required: false, fixed: true },
    { key: "standard", label: "Standard / procedure followed", kind: "typed", input: "text", required: true },
    { key: "surface_condition", label: "Surface condition", kind: "typed", input: "text", required: false },
    { key: "acceptance_criteria", label: "Acceptance criteria", kind: "typed", input: "text", required: false },
  ];

  return {
    UT: ut,
    MPT: mpt,
    DPT: dpt,
    RT: general,
    VT: general,
    hardness: general,
    metallography: general,
    RLA: general,
    certification: general,
    general_inspection: general,
  };
}

export function normalizeReportTemplates(val: unknown): ReportTemplatesMap {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return buildSeedTemplates();
  }
  const obj = val as Record<string, unknown>;
  const result: ReportTemplatesMap = {};

  for (const [method, fieldsRaw] of Object.entries(obj)) {
    if (!Array.isArray(fieldsRaw)) continue;
    const cleanFields: TemplateFieldConfig[] = [];
    for (const f of fieldsRaw) {
      if (!f || typeof f !== "object") continue;
      const fObj = f as Record<string, unknown>;
      const key = typeof fObj.key === "string" ? fObj.key.trim() : "";
      const label = typeof fObj.label === "string" ? fObj.label.trim() : "";
      if (!key || !label) continue;

      const kind: TemplateFieldKind =
        fObj.kind === "fixed" || fObj.fieldType === "fixed" || fObj.fieldType === "automatic"
          ? "fixed"
          : fObj.kind === "dropdown" || fObj.fieldType === "dropdown" || fObj.fieldType === "pick_or_type"
            ? "dropdown"
            : "typed";

      const validInputs = ["text", "date", "number", "textarea"];
      const input =
        typeof fObj.input === "string" && validInputs.includes(fObj.input)
          ? (fObj.input as TemplateFieldConfig["input"])
          : "text";

      const required = Boolean(fObj.required);
      const fixed = Boolean(fObj.fixed || kind === "fixed");

      let options: string[] | undefined;
      if (Array.isArray(fObj.options)) {
        options = fObj.options.map((o) => String(o).trim()).filter(Boolean);
      }

      cleanFields.push({
        key,
        label,
        kind,
        input,
        required,
        ...(fixed ? { fixed: true } : {}),
        ...(options && options.length > 0 ? { options } : {}),
      });
    }
    result[method] = cleanFields;
  }

  // Ensure at least UT, MPT, and DPT are present
  const defaultSeeds = buildSeedTemplates();
  for (const m of ["UT", "MPT", "DPT"]) {
    if (!result[m] || result[m].length === 0) {
      result[m] = defaultSeeds[m];
    }
  }

  return result;
}

export async function getOrSeedReportTemplates(
  supabase: SupabaseClient<Database>,
): Promise<ReportTemplatesMap> {
  const { data } = await getSetting(supabase, "report_templates");
  if (data?.value && typeof data.value === "object" && !Array.isArray(data.value)) {
    const normalized = normalizeReportTemplates(data.value);
    // If the database had empty object or missing UT, re-seed
    if (Object.keys(normalized).length >= 3 && normalized.UT?.length > 0) {
      return normalized;
    }
  }

  // Seed default templates
  const seeds = buildSeedTemplates();
  await upsertSetting(
    supabase,
    "report_templates",
    seeds as unknown as Json,
    "Dynamic ordered report fields per NDT test method",
    null,
  );

  return seeds;
}

/**
 * Converts TemplateFieldConfig[] to the FieldDefinition[] contract expected by the phone app and field API
 */
export function templateConfigsToFieldDefinitions(
  configs: readonly TemplateFieldConfig[],
  customDropdownOptions?: Record<string, readonly string[]>,
): FieldDefinition[] {
  return configs.map((c) => {
    let fieldType: ReportFieldKind = "typed";
    if (c.kind === "fixed" || c.fixed) {
      fieldType = "automatic";
    } else if (c.kind === "dropdown") {
      fieldType = "dropdown";
    }

    const dynamicOpts = customDropdownOptions?.[c.key];
    const combinedOptions = Array.from(
      new Set([...(c.options ?? []), ...(dynamicOpts ?? [])]),
    );

    return {
      key: c.key,
      label: c.label,
      required: c.required,
      input: c.input,
      fieldType,
      fixed: Boolean(c.fixed || c.kind === "fixed"),
      readOnly: Boolean(c.fixed || c.kind === "fixed"),
      ...(combinedOptions.length > 0 ? { options: combinedOptions } : {}),
    };
  });
}
