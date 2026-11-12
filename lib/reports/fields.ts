import type { Enums } from "../db/types";

export type ReportMethod = Extract<Enums<"test_method">, "UT" | "MPT" | "DPT">;
export type ReportMethodInput = ReportMethod | "MT";
export type ReadingValue = string | number | null;
export type ReportFieldKind = "fixed" | "automatic" | "dropdown" | "pick_or_type" | "typed";

export type FieldDefinition = Readonly<{
  key: string;
  label: string;
  required: boolean;
  input: "text" | "date" | "number" | "textarea";
  fieldType?: ReportFieldKind;
  listKey?: string;
  options?: readonly string[];
  readOnly?: boolean;
  fixed?: boolean;
}>;

export const DEFAULT_REPORT_DROPDOWN_OPTIONS: Record<string, readonly string[]> = {
  ut_equipment: [
    "GE USM 36S",
    "Olympus Epoch 650",
    "Krautkramer USM 35X",
    "Modsonic Einstein II",
  ],
  ut_probe: [
    "Ø24x2MHz Normal Probe B2S",
    "Ø10x4MHz Normal Probe",
    "45° 4MHz Angle Probe MWB45-4",
    "60° 4MHz Angle Probe MWB60-4",
    "70° 4MHz Angle Probe MWB70-4",
    "TR Probe SEB2",
  ],
  reference_blocks: [
    "IIW/V2",
    "IIW V1 & V2",
    "V1",
    "V2",
    "Step wedge",
    "IIW/V1 & DGS Block",
  ],
  calibration_method: [
    "Ø 2mm DGS with BW",
    "Ø 3mm DGS with BW",
    "DAC",
    "DGS",
    "BW",
    "AWS",
  ],
  couplant: ["Oil", "Grease", "Gel", "Water"],
  scanning_level: ["+6 dB", "+12 dB", "Reference level"],
  surface_condition: [
    "Proof Machined",
    "Machined",
    "Rough machined",
    "As forged",
    "As cast",
    "Ground",
  ],
  ut_standard: [
    "ASTM A388",
    "EN 10228-3",
    "ASTM A609",
    "ASME Sec V Art. 4",
    "ASME Sec V Art. 5",
    "IS 3664",
  ],
  ut_acceptance: [
    "Clause 2.1",
    "Class 1",
    "Class 2",
    "Class 3",
    "Level 1",
    "Level 2",
    "As per client specification",
  ],
  component_description: [
    "Proof Machined Shaft Forging",
    "Shaft forging",
    "Rotor forging",
    "Casting",
    "Weld joint",
    "Plate",
  ],
  qty_unit: ["No.", "Nos.", "Sets"],
  observation_sentences: [
    "Forging scanned with normal probe all round and no significant indications observed.",
    "Forging scanned with normal probe all round and no significant indications observed. At one spot, recordable indication observed. Refer Annexure.",
    "No recordable defect observed.",
    "Scanned 100% and found satisfactory.",
  ],
  report_result: ["Accepted", "Rejected", "Accepted with remarks"],
};

function field<const K extends string>(
  key: K,
  label: string,
  input: FieldDefinition["input"] = "text",
  required = true,
  extra?: {
    fieldType?: ReportFieldKind;
    listKey?: string;
    options?: readonly string[];
    readOnly?: boolean;
    fixed?: boolean;
  },
) {
  const resolvedOptions =
    extra?.options ?? (extra?.listKey ? DEFAULT_REPORT_DROPDOWN_OPTIONS[extra.listKey] : undefined);
  return {
    key,
    label,
    input,
    required,
    ...(extra?.fieldType ? { fieldType: extra.fieldType } : {}),
    ...(extra?.listKey ? { listKey: extra.listKey } : {}),
    ...(resolvedOptions ? { options: resolvedOptions } : {}),
    ...(extra?.readOnly !== undefined ? { readOnly: extra.readOnly } : {}),
    ...(extra?.fixed !== undefined ? { fixed: extra.fixed } : {}),
  } as const;
}

export const SHARED_FIELDS = [
  field("client", "Client", "text", true, { fieldType: "dropdown" }),
  field("project", "Project", "text", false, { fieldType: "typed" }),
  field("inspection_site", "Inspection site", "text", true, { fieldType: "typed" }),
  field("inspection_date", "Inspection date", "date", true, { fieldType: "dropdown" }),
] as const;

export const TECHNICIAN_FIELDS = [
  field("name", "Technician name", "text", true, { fieldType: "dropdown" }),
  field("qualification", "Qualification", "text", true, { fieldType: "automatic" }),
  field("certificate_no", "Certificate number", "text", true, { fieldType: "automatic" }),
  field("issued_on", "Issue date", "date", true, { fieldType: "automatic" }),
  field("valid_until", "Valid until", "date", true, { fieldType: "automatic" }),
] as const;

export const ITEM_FIELDS = [
  field("description", "Component description", "textarea", true, {
    fieldType: "dropdown",
    listKey: "component_description",
  }),
  field("identification_no", "Identification numbers (SR No. / H No. / Mat Code)", "textarea", false, {
    fieldType: "typed",
  }),
  field("size", "Size (Ø / thickness × length mm)", "text", false, {
    fieldType: "typed",
  }),
  field("quantity", "Quantity", "number", true, { fieldType: "typed" }),
  field("qty_unit", "Unit", "text", false, {
    fieldType: "dropdown",
    listKey: "qty_unit",
  }),
  field("observations", "Observations / remarks", "textarea", true, {
    fieldType: "dropdown",
    listKey: "observation_sentences",
  }),
  field("result", "Result", "text", false, {
    fieldType: "dropdown",
    listKey: "report_result",
  }),
] as const;

// BITA UT Report Fields spec (1-29) and paper formats. MT is stored as MPT in the database enum.
export const METHOD_FIELDS = {
  UT: [
    field("equipment", "Equipment used", "text", true, {
      fieldType: "dropdown",
      listKey: "ut_equipment",
    }),
    field("equipment_serial", "Equipment serial number", "text", true, {
      fieldType: "automatic",
    }),
    field("equipment_calibration", "Equipment calibration dates", "text", false, {
      fieldType: "automatic",
    }),
    field("probes", "Probe used", "text", true, {
      fieldType: "dropdown",
      listKey: "ut_probe",
    }),
    field("reference_blocks", "Reference blocks", "text", true, {
      fieldType: "dropdown",
      listKey: "reference_blocks",
    }),
    field("calibration_method", "Calibration method (DGS / DAC / BW)", "text", false, {
      fieldType: "dropdown",
      listKey: "calibration_method",
    }),
    field("screen_range", "Screen range", "text", true, {
      fieldType: "typed",
    }),
    field("sensitivity", "Sensitivity level", "text", true, {
      fieldType: "typed",
    }),
    field("scanning_level", "Scanning level", "text", true, {
      fieldType: "dropdown",
      listKey: "scanning_level",
    }),
    field("couplant", "Couplant", "text", true, {
      fieldType: "dropdown",
      listKey: "couplant",
    }),
    field("surface_condition", "Surface condition", "text", true, {
      fieldType: "dropdown",
      listKey: "surface_condition",
    }),
    field("standard", "Standard followed", "text", true, {
      fieldType: "pick_or_type",
      listKey: "ut_standard",
    }),
    field("acceptance_criteria", "Acceptance criteria", "text", true, {
      fieldType: "pick_or_type",
      listKey: "ut_acceptance",
    }),
  ],
  MPT: [
    field("equipment", "Yoke / equipment used", "text", true, { fieldType: "dropdown" }),
    field("equipment_serial", "Equipment serial number", "text", true, { fieldType: "automatic" }),
    field("magnetic_medium", "Magnetic medium", "text", true, { fieldType: "dropdown" }),
    field("standard", "Standard followed", "text", true, { fieldType: "pick_or_type" }),
    field("magnetisation_method", "Magnetisation method", "text", true, { fieldType: "dropdown" }),
    field("current", "Current used", "text", true, { fieldType: "dropdown" }),
    field("visible_light_intensity", "Visible light intensity", "text", true, { fieldType: "typed" }),
    field("black_light", "Black light device", "text", false, { fieldType: "dropdown" }),
    field("black_light_intensity", "Black light intensity", "text", true, { fieldType: "typed" }),
    field("test_block", "Test block", "text", true, { fieldType: "dropdown" }),
    field("yoke_lifting_capacity", "Lifting capacity of yoke", "text", true, { fieldType: "typed" }),
  ],
  DPT: [
    field("component_description", "Component description", "textarea", true, {
      fieldType: "dropdown",
      listKey: "component_description",
    }),
    field("cleaner", "Cleaner", "text", true, { fieldType: "dropdown" }),
    field("cleaner_batch", "Cleaner batch number", "text", true, { fieldType: "typed" }),
    field("penetrant", "Penetrant", "text", true, { fieldType: "dropdown" }),
    field("penetrant_batch", "Penetrant batch number", "text", true, { fieldType: "typed" }),
    field("developer", "Developer", "text", true, { fieldType: "dropdown" }),
    field("developer_batch", "Developer batch number", "text", true, { fieldType: "typed" }),
    field("standard", "Standard followed", "text", true, { fieldType: "pick_or_type" }),
    field("dwell_time", "Dwell time", "text", true, { fieldType: "typed" }),
    field("developing_time", "Developing time", "text", true, { fieldType: "typed" }),
  ],
} as const satisfies Record<ReportMethod, readonly FieldDefinition[]>;

export const REPEATING_GROUPS = [
  { key: "technicians", label: "Testing carried out by", minimumRows: 1, fields: TECHNICIAN_FIELDS },
  { key: "items", label: "Inspected items", minimumRows: 1, fields: ITEM_FIELDS },
] as const;

type SharedKey = (typeof SHARED_FIELDS)[number]["key"];
type MethodKey = (typeof METHOD_FIELDS)[ReportMethod][number]["key"];
export type TechnicianReadings = Partial<Record<(typeof TECHNICIAN_FIELDS)[number]["key"], ReadingValue>>;
export type ItemReadings = Partial<Record<(typeof ITEM_FIELDS)[number]["key"], ReadingValue>>;
export type ReportReadings = Partial<Record<SharedKey | MethodKey, ReadingValue>> & {
  component_header_id?: ReadingValue;
  technicians?: readonly TechnicianReadings[];
  items?: readonly ItemReadings[];
};

export function reportMethod(method: ReportMethodInput): ReportMethod {
  if (method === "MT") return "MPT";
  if (method !== "UT" && method !== "MPT" && method !== "DPT") throw new Error("Unsupported report method.");
  return method;
}

export function fieldsForMethod(method: ReportMethodInput): readonly FieldDefinition[] {
  return [...SHARED_FIELDS, ...METHOD_FIELDS[reportMethod(method)]];
}

export function mergeCustomMethodFields(
  method: ReportMethodInput,
  customTemplatesJson?: unknown,
  customDropdownOptions?: Record<string, readonly string[]>,
): readonly FieldDefinition[] {
  const canonical = reportMethod(method);
  const baseFields = fieldsForMethod(canonical);
  const merged = new Map<string, FieldDefinition>();

  for (const f of baseFields) {
    const dynamicOpts = f.listKey && customDropdownOptions?.[f.listKey];
    if (dynamicOpts && dynamicOpts.length > 0) {
      const combined = Array.from(new Set([...(f.options ?? []), ...dynamicOpts]));
      merged.set(f.key, { ...f, options: combined });
    } else {
      merged.set(f.key, f);
    }
  }

  if (customTemplatesJson && typeof customTemplatesJson === "object" && !Array.isArray(customTemplatesJson)) {
    const methodList = (customTemplatesJson as Record<string, unknown>)[canonical];
    if (Array.isArray(methodList)) {
      const validInputs = new Set<FieldDefinition["input"]>(["text", "date", "number", "textarea"]);
      for (const raw of methodList) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const obj = raw as Record<string, unknown>;
        const key = typeof obj.key === "string" ? obj.key.trim() : "";
        const label = typeof obj.label === "string" ? obj.label.trim() : "";
        if (!key || !label) continue;
        const input =
          typeof obj.input === "string" && validInputs.has(obj.input as FieldDefinition["input"])
            ? (obj.input as FieldDefinition["input"])
            : "text";
        const required = obj.required !== undefined ? Boolean(obj.required) : false;
        if (obj.hidden === true) {
          merged.delete(key);
        } else {
          const prev = merged.get(key);
          merged.set(key, {
            ...prev,
            key,
            label,
            input,
            required,
          });
        }
      }
    }
  }

  return Array.from(merged.values());
}

/**
 * Memory helper ("Remember per customer", BITA UT Report Fields page 3):
 * Extracts reusable customer-level defaults from a previous inspection's readings.
 */
export const CUSTOMER_REMEMBERED_FIELD_KEYS = [
  "standard",
  "acceptance_criteria",
  "surface_condition",
  "scanning_level",
  "calibration_method",
  "couplant",
  "reference_blocks",
] as const;

export function extractCustomerRememberedDefaults(
  readings: unknown,
): Record<string, string> {
  const r = record(readings);
  const out: Record<string, string> = {};
  for (const k of CUSTOMER_REMEMBERED_FIELD_KEYS) {
    const val = r[k];
    if (typeof val === "string" && val.trim()) {
      out[k] = val.trim();
    }
  }
  return out;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasReading(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : typeof value === "number" && Number.isFinite(value);
}

/** Stable paths suitable for inspections.missing_fields and field-level form messages.
 * Rows are checked individually: one complete technician/item cannot hide another incomplete row.
 * Measures such as zero are present; null, whitespace, booleans and objects are not readings.
 */
export function missingFields(
  method: ReportMethodInput | string,
  readings: unknown,
  customFields?: readonly FieldDefinition[],
): string[] {
  const values = record(readings);
  const missing: string[] = [];
  let scalarFields: readonly FieldDefinition[] = [];
  if (customFields) {
    scalarFields = customFields;
  } else {
    try {
      scalarFields = fieldsForMethod(method as ReportMethodInput);
    } catch {
      scalarFields = [];
    }
  }
  for (const definition of scalarFields) {
    if (definition.required && (!Object.hasOwn(values, definition.key) || !hasReading(values[definition.key]))) missing.push(definition.key);
  }
  for (const group of REPEATING_GROUPS) {
    const rows = Object.hasOwn(values, group.key) ? values[group.key] : undefined;
    if (!Array.isArray(rows) || rows.length < group.minimumRows) { missing.push(group.key); continue; }
    // Array.from also visits holes in sparse input instead of silently treating them as complete.
    Array.from(rows).forEach((row, index) => {
      const entries = record(row);
      for (const definition of group.fields) {
        if (definition.required && (!Object.hasOwn(entries, definition.key) || !hasReading(entries[definition.key]))) missing.push(`${group.key}.${index}.${definition.key}`);
      }
    });
  }
  return missing;
}
