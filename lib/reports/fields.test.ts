import { describe, expect, it } from "vitest";
import { fieldsForMethod, missingFields, reportMethod, type ReportMethodInput } from "./fields";

function complete(method: ReportMethodInput) {
  return {
    ...Object.fromEntries(fieldsForMethod(method).map((field) => [field.key, "FAKE TEST reading"])),
    technicians: [{ name: "Test Inspector", qualification: "Test Level II", certificate_no: "FAKE-001", issued_on: "2026-01-01", valid_until: "2027-01-01" }],
    items: [{ description: "Test component", quantity: 1, observations: "Fake observations for validation" }],
  };
}

describe("mandatory report readings", () => {
  it.each(["UT", "MT", "MPT", "DPT"] as const)("accepts a complete %s submission", (method) => {
    expect(missingFields(method, complete(method))).toEqual([]);
  });

  it("normalizes MT to the database MPT enum and refuses unsupported methods", () => {
    expect(reportMethod("MT")).toBe("MPT");
    expect(() => reportMethod("VT" as ReportMethodInput)).toThrow("Unsupported");
    // Since the Settings template editor, methods without a code template no longer throw here:
    // they have no scalar fields, but the repeating technician and item rows are still required.
    expect(missingFields("VT" as ReportMethodInput, {}).length).toBeGreaterThan(0);
  });

  it("finds missing or whitespace-only values without treating zero as empty", () => {
    const readings = complete("UT");
    expect(missingFields("UT", { ...readings, sensitivity: "  ", screen_range: null, scanning_level: 0 })).toEqual(["screen_range", "sensitivity"]);
  });

  it("rejects objects, booleans, NaN and infinity as readings", () => {
    for (const value of [{}, [], false, NaN, Infinity]) {
      expect(missingFields("UT", { ...complete("UT"), couplant: value })).toEqual(["couplant"]);
    }
  });

  it("requires at least one technician and item and checks every repeated row", () => {
    expect(missingFields("DPT", { ...complete("DPT"), technicians: [], items: null })).toEqual(["technicians", "items"]);
    expect(missingFields("UT", { ...complete("UT"), items: [{ description: "Test", quantity: 0, observations: " " }] })).toEqual(["items.0.observations"]);
    const readings = complete("UT");
    expect(missingFields("UT", { ...readings, technicians: [...readings.technicians, { name: "Test 2" }] })).toEqual([
      "technicians.1.qualification", "technicians.1.certificate_no", "technicians.1.issued_on", "technicians.1.valid_until",
    ]);
  });

  it("does not accept inherited properties or skip sparse rows", () => {
    expect(missingFields("UT", Object.create(complete("UT")))).toContain("client");
    expect(missingFields("UT", { ...complete("UT"), items: new Array(1) })).toContain("items.0.description");
  });

  it("keeps the extra black-light device optional while requiring the listed MT intensities", () => {
    const readings: Record<string, unknown> = complete("MT");
    delete readings.black_light;
    expect(missingFields("MT", readings)).toEqual([]);
    delete readings.black_light_intensity;
    expect(missingFields("MPT", readings)).toEqual(["black_light_intensity"]);
  });

  it("validates empty or non-object JSON as missing, rather than throwing", () => {
    for (const value of [undefined, null, [], "test"]) expect(missingFields("DPT", value)).toContain("cleaner_batch");
  });
});
