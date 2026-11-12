import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  STANDARD_TEST_METHODS,
  buildSeedTemplates,
  getActiveTestMethods,
  getOrSeedReportTemplates,
  getOrSeedTestMethods,
  mapToCanonicalTestMethodEnum,
  normalizeReportTemplates,
  parseTestMethodValue,
  templateConfigsToFieldDefinitions,
  type ReportTemplatesMap,
  type TemplateFieldConfig,
} from "@/lib/modules/settings/templates";
import { parseJobInput } from "@/lib/modules/jobs/schema";
import { GET as getReportTemplateRoute } from "@/app/api/field/report-template/[method]/route";
import * as fieldAuth from "@/lib/field/auth";
import * as fieldService from "@/lib/field/service";
import { submitInspectionReport } from "@/lib/field/assignments";

describe("G8: Settings: Test methods and report templates", () => {
  describe("parseTestMethodValue", () => {
    it("parses code and label when separated by pipe", () => {
      expect(parseTestMethodValue("UT | Ultrasonic Testing (UT)")).toEqual({
        code: "UT",
        label: "Ultrasonic Testing (UT)",
      });
      expect(parseTestMethodValue("ET | Eddy Current Testing")).toEqual({
        code: "ET",
        label: "Eddy Current Testing",
      });
      expect(parseTestMethodValue(" ECT | Eddy Current Testing ")).toEqual({
        code: "ECT",
        label: "Eddy Current Testing",
      });
    });

    it("parses plain code when no pipe is present", () => {
      expect(parseTestMethodValue("RT")).toEqual({
        code: "RT",
        label: "RT",
      });
      expect(parseTestMethodValue("hardness")).toEqual({
        code: "hardness",
        label: "hardness",
      });
    });

    it("handles whitespace and empty strings gracefully", () => {
      expect(parseTestMethodValue("")).toEqual({
        code: "",
        label: "",
      });
      expect(parseTestMethodValue("   ")).toEqual({
        code: "",
        label: "",
      });
    });
  });

  describe("mapToCanonicalTestMethodEnum", () => {
    it("maps standard enum test methods directly", () => {
      expect(mapToCanonicalTestMethodEnum("UT")).toBe("UT");
      expect(mapToCanonicalTestMethodEnum("MPT")).toBe("MPT");
      expect(mapToCanonicalTestMethodEnum("DPT")).toBe("DPT");
      expect(mapToCanonicalTestMethodEnum("RT")).toBe("RT");
      expect(mapToCanonicalTestMethodEnum("VT")).toBe("VT");
      expect(mapToCanonicalTestMethodEnum("hardness")).toBe("hardness");
      expect(mapToCanonicalTestMethodEnum("metallography")).toBe("metallography");
      expect(mapToCanonicalTestMethodEnum("RLA")).toBe("RLA");
      expect(mapToCanonicalTestMethodEnum("certification")).toBe("certification");
      expect(mapToCanonicalTestMethodEnum("general_inspection")).toBe("general_inspection");
    });

    it("maps MT alias to MPT", () => {
      expect(mapToCanonicalTestMethodEnum("MT")).toBe("MPT");
      expect(mapToCanonicalTestMethodEnum("mt")).toBe("MPT");
    });

    it("maps case-insensitively for standard codes", () => {
      expect(mapToCanonicalTestMethodEnum("ut")).toBe("UT");
      expect(mapToCanonicalTestMethodEnum("Hardness")).toBe("hardness");
      expect(mapToCanonicalTestMethodEnum("rla")).toBe("RLA");
    });

    it("maps novel/custom methods safely to general_inspection for Postgres enum compliance", () => {
      expect(mapToCanonicalTestMethodEnum("ET")).toBe("general_inspection");
      expect(mapToCanonicalTestMethodEnum("ECT")).toBe("general_inspection");
      expect(mapToCanonicalTestMethodEnum("Acoustic Emission")).toBe("general_inspection");
    });
  });

  describe("buildSeedTemplates", () => {
    it("builds seed templates with all required methods", () => {
      const templates = buildSeedTemplates();
      expect(templates).toHaveProperty("UT");
      expect(templates).toHaveProperty("MPT");
      expect(templates).toHaveProperty("DPT");
      expect(templates).toHaveProperty("general_inspection");
    });

    it("UT template contains 17 scalar fields matching the 29-field spec", () => {
      const utFields = buildSeedTemplates().UT;
      expect(utFields).toHaveLength(17);

      const keys = utFields.map((f) => f.key);
      // 4 shared fields
      expect(keys).toContain("client");
      expect(keys).toContain("project");
      expect(keys).toContain("inspection_site");
      expect(keys).toContain("inspection_date");

      // 13 UT-specific fields
      expect(keys).toContain("equipment");
      expect(keys).toContain("equipment_serial");
      expect(keys).toContain("equipment_calibration");
      expect(keys).toContain("probes");
      expect(keys).toContain("reference_blocks");
      expect(keys).toContain("calibration_method");
      expect(keys).toContain("screen_range");
      expect(keys).toContain("sensitivity");
      expect(keys).toContain("scanning_level");
      expect(keys).toContain("couplant");
      expect(keys).toContain("surface_condition");
      expect(keys).toContain("standard");
      expect(keys).toContain("acceptance_criteria");

      // Verify kind assignments
      const equip = utFields.find((f) => f.key === "equipment");
      expect(equip?.kind).toBe("dropdown");
      expect(equip?.options && equip.options.length).toBeGreaterThan(0);

      const serial = utFields.find((f) => f.key === "equipment_serial");
      expect(serial?.kind).toBe("fixed");
      expect(serial?.fixed).toBe(true);
    });

    it("MPT template contains 15 scalar fields", () => {
      const mptFields = buildSeedTemplates().MPT;
      expect(mptFields).toHaveLength(15);
      const keys = mptFields.map((f) => f.key);
      expect(keys).toContain("magnetic_medium");
      expect(keys).toContain("magnetisation_method");
      expect(keys).toContain("current");
      expect(keys).toContain("black_light");
    });

    it("DPT template contains 14 scalar fields", () => {
      const dptFields = buildSeedTemplates().DPT;
      expect(dptFields).toHaveLength(14);
      const keys = dptFields.map((f) => f.key);
      expect(keys).toContain("cleaner");
      expect(keys).toContain("cleaner_batch");
      expect(keys).toContain("penetrant");
      expect(keys).toContain("penetrant_batch");
      expect(keys).toContain("developer");
      expect(keys).toContain("developer_batch");
      expect(keys).toContain("dwell_time");
      expect(keys).toContain("developing_time");
    });
  });

  describe("normalizeReportTemplates", () => {
    it("returns default seeds when input is null, undefined, or empty", () => {
      expect(normalizeReportTemplates(null)).toHaveProperty("UT");
      expect(normalizeReportTemplates(undefined)).toHaveProperty("UT");
      expect(normalizeReportTemplates({})).toHaveProperty("UT");
    });

    it("normalizes and sanitizes field definitions from stored JSON", () => {
      const input = {
        UT: [
          { key: "custom_temp", label: "Surface Temperature", kind: "typed", input: "number", required: true },
          { key: "invalid", label: "" }, // invalid, should be skipped
        ],
      };
      const res = normalizeReportTemplates(input);
      expect(res.UT.some((f) => f.key === "custom_temp")).toBe(true);
      expect(res.UT.some((f) => f.key === "invalid")).toBe(false);
      // MPT and DPT fall back to seeds if missing
      expect(res).toHaveProperty("MPT");
      expect(res).toHaveProperty("DPT");
    });
  });

  describe("templateConfigsToFieldDefinitions", () => {
    it("converts TemplateFieldConfig to FieldDefinition contract", () => {
      const configs: TemplateFieldConfig[] = [
        { key: "temp", label: "Temperature", kind: "typed", input: "number", required: true },
        {
          key: "couplant",
          label: "Couplant",
          kind: "dropdown",
          input: "text",
          required: false,
          options: ["Gel", "Oil"],
        },
        { key: "serial", label: "Serial", kind: "fixed", input: "text", required: true, fixed: true },
      ];

      const defs = templateConfigsToFieldDefinitions(configs, {
        couplant: ["Water"],
      });

      expect(defs).toHaveLength(3);

      expect(defs[0]).toEqual({
        key: "temp",
        label: "Temperature",
        required: true,
        input: "number",
        fieldType: "typed",
        fixed: false,
        readOnly: false,
      });

      expect(defs[1].fieldType).toBe("dropdown");
      expect(defs[1].options).toEqual(["Gel", "Oil", "Water"]);

      expect(defs[2].fieldType).toBe("automatic");
      expect(defs[2].fixed).toBe(true);
      expect(defs[2].readOnly).toBe(true);
    });
  });

  describe("getOrSeedTestMethods and getActiveTestMethods", () => {
    it("seeds 10 standard test methods when settings_options is empty", async () => {
      const insertedRows: Array<{ list_key: string; value: string; position: number; active: boolean; id: string }> = [];

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "settings_options") {
            return {
              select: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              eq: vi.fn().mockImplementation((col: string, val: unknown) => {
                if (col === "list_key" && val === "test_methods") {
                  return Promise.resolve({ data: insertedRows, error: null });
                }
                return Promise.resolve({ data: [], error: null });
              }),
              insert: vi.fn().mockImplementation((row: unknown) => {
                const inserted = {
                  id: `opt-${insertedRows.length + 1}`,
                  ...(row as { list_key: string; value: string; position: number; active: boolean }),
                };
                insertedRows.push(inserted);
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
                };
              }),
            };
          }
          return { select: vi.fn() };
        }),
      } as unknown as SupabaseClient<Database>;

      const methods = await getOrSeedTestMethods(mockSupabase);
      expect(methods).toHaveLength(STANDARD_TEST_METHODS.length);
      expect(methods.map((m) => m.code)).toEqual([
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
      ]);
      expect(insertedRows).toHaveLength(10);
    });

    it("returns existing options without re-seeding if already populated", async () => {
      const existingRows = [
        { id: "1", list_key: "test_methods", value: "UT | Ultrasonic Testing", position: 10, active: true },
        { id: "2", list_key: "test_methods", value: "ET | Eddy Current Testing", position: 20, active: false },
      ];

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "settings_options") {
            return {
              select: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: existingRows, error: null }),
            };
          }
          return { select: vi.fn() };
        }),
      } as unknown as SupabaseClient<Database>;

      const methods = await getOrSeedTestMethods(mockSupabase);
      expect(methods).toHaveLength(2);
      expect(methods[0].code).toBe("UT");
      expect(methods[1].code).toBe("ET");

      const active = await getActiveTestMethods(mockSupabase);
      expect(active).toHaveLength(1);
      expect(active[0].code).toBe("UT");
    });
  });

  describe("getOrSeedReportTemplates", () => {
    it("seeds default templates when settings.report_templates is absent", async () => {
      const savedHolder: { setting: { key: string; value: unknown } | null } = { setting: null };

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "settings") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              upsert: vi.fn().mockImplementation((payload: { key: string; value: unknown }) => {
                savedHolder.setting = payload;
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({ data: payload, error: null }),
                };
              }),
            };
          }
          return { select: vi.fn() };
        }),
      } as unknown as SupabaseClient<Database>;

      const templates = await getOrSeedReportTemplates(mockSupabase);
      expect(templates).toHaveProperty("UT");
      expect(templates.UT).toHaveLength(17);
      expect(savedHolder.setting).not.toBeNull();
      expect(savedHolder.setting?.key).toBe("report_templates");
    });
  });

  describe("GET /api/field/report-template/[method]", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("returns 200 with template for standard method UT", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "settings") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { key: "report_templates", value: buildSeedTemplates() },
                error: null,
              }),
            };
          }
          if (table === "settings_options") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }
          return { select: vi.fn() };
        }),
      } as unknown as SupabaseClient<Database>;

      vi.spyOn(fieldService, "getSupabaseAdmin").mockReturnValue(mockSupabase);
      vi.spyOn(fieldAuth, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Pixel 7",
          pushToken: null,
          technician: { id: "tech-1", name: "Test Tech", phone: "123", email: "tech@example.com" },
        },
      });

      const req = new Request("http://localhost/api/field/report-template/UT", {
        headers: { Authorization: "Bearer test-secret" },
      });
      const res = await getReportTemplateRoute(req, { params: Promise.resolve({ method: "UT" }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.method).toBe("UT");
      expect(Array.isArray(json.fields)).toBe(true);
      expect(json.fields.length).toBeGreaterThanOrEqual(17);
      expect(json.repeatingGroups).toHaveLength(2);
    });

    it("accepts custom methods like ET or RT without 400 error", async () => {
      const customTemplates: ReportTemplatesMap = {
        ...buildSeedTemplates(),
        ET: [
          { key: "client", label: "Client", kind: "dropdown", input: "text", required: true },
          { key: "frequency", label: "Test Frequency", kind: "typed", input: "text", required: true },
        ],
      };

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "settings") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { key: "report_templates", value: customTemplates },
                error: null,
              }),
            };
          }
          if (table === "settings_options") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }
          return { select: vi.fn() };
        }),
      } as unknown as SupabaseClient<Database>;

      vi.spyOn(fieldService, "getSupabaseAdmin").mockReturnValue(mockSupabase);
      vi.spyOn(fieldAuth, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Pixel 7",
          pushToken: null,
          technician: { id: "tech-1", name: "Test Tech", phone: "123", email: "tech@example.com" },
        },
      });

      const req = new Request("http://localhost/api/field/report-template/ET", {
        headers: { Authorization: "Bearer test-secret" },
      });
      const res = await getReportTemplateRoute(req, { params: Promise.resolve({ method: "ET" }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.method).toBe("ET");
      expect(json.fields.some((f: { key: string }) => f.key === "frequency")).toBe(true);
    });
  });

  describe("parseJobInput with dynamic / mapped test methods", () => {
    it("accepts standard test methods in form input", () => {
      const fd = new FormData();
      fd.append("customer_id", "cust-1");
      fd.append("test_methods", "UT");
      fd.append("test_methods", "MPT");

      const res = parseJobInput(fd);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.test_methods).toEqual(["UT", "MPT"]);
      }
    });

    it("maps MT alias to MPT", () => {
      const fd = new FormData();
      fd.append("customer_id", "cust-1");
      fd.append("test_methods", "MT");

      const res = parseJobInput(fd);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.test_methods).toEqual(["MPT"]);
      }
    });

    it("maps custom test methods safely to general_inspection for Postgres enum compliance", () => {
      const fd = new FormData();
      fd.append("customer_id", "cust-1");
      fd.append("test_methods", "ET");

      const res = parseJobInput(fd);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.test_methods).toEqual(["general_inspection"]);
      }
    });
  });

  describe("submitInspectionReport with custom test methods", () => {
    it("accepts custom method and maps it to canonical general_inspection in the database", async () => {
      const holder: { inspection: { method?: string; id?: string } | null } = { inspection: null };

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "assignments") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "assign-1",
                  job_id: "job-1",
                  person_id: "tech-1",
                  jobs: { id: "job-1", status: "scheduled", customer_id: "cust-1" },
                },
                error: null,
              }),
            };
          }
          if (table === "inspections") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
                holder.inspection = { id: "insp-1", ...payload };
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({ data: holder.inspection, error: null }),
                };
              }),
            };
          }
          return { select: vi.fn() };
        }),
      } as unknown as SupabaseClient<Database>;

      const res = await submitInspectionReport(mockSupabase, "assign-1", "tech-1", {
        method: "ET" as unknown as "UT",
        readings: { client: "Test Client", inspection_date: "2026-11-12" },
        draft: true,
      });

      expect(res).toHaveProperty("ok", true);
      expect(holder.inspection).not.toBeNull();
      expect(holder.inspection?.method).toBe("general_inspection");
    });
  });
});
