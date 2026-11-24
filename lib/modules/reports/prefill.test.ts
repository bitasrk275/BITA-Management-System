import { describe, expect, it } from "vitest";
import {
  equipmentLookup,
  formatQualification,
  mergePrefill,
  pickQualification,
  technicianLookup,
} from "./prefill";

const quals = [
  { method: "UT", level: "Level II", scheme: "ISNT", certifying_body: "ISNT", certificate_no: "U-1", issued_on: "2023-01-01", valid_until: "2026-12-31" },
  { method: "UT", level: "Level II", scheme: "EN ISO 9712", certifying_body: "ISO 9712", certificate_no: "U-2", issued_on: "2024-05-01", valid_until: "2029-04-30" },
  { method: "MPT", level: "Level II", scheme: "ASNT SNT-TC-1A", certifying_body: "ASNT", certificate_no: "M-1", issued_on: "2022-02-02", valid_until: "2027-02-01" },
];

describe("report autofill (prefill)", () => {
  it("formats a qualification the way the report shows it", () => {
    expect(formatQualification(quals[2]!)).toBe("ASNT Level II (MPT)");
  });

  it("picks the certificate for the method that stays valid longest", () => {
    expect(pickQualification(quals, "UT")?.certificate_no).toBe("U-2");
    expect(pickQualification(quals, "DPT")).toBeNull();
  });

  it("builds technician and equipment lookups", () => {
    expect(technicianLookup("Sample Technician", quals, "UT")).toEqual({
      name: "Sample Technician",
      qualification: "ISO 9712 Level II (UT)",
      certificate_no: "U-2",
      issued_on: "2024-05-01",
      valid_until: "2029-04-30",
    });
    expect(equipmentLookup({ make: "Krautkramer", model: "USM 36", serial_no: "SN-1", calibration_due: "2026-12-23" })).toEqual({
      label: "Krautkramer USM 36",
      serial: "SN-1",
      calibration: "Valid upto 2026-12-23",
    });
  });

  it("fills only blank fields and keeps what was typed", () => {
    const merged = mergePrefill(
      { client: "Typed Client", inspection_site: "", standard: "ASTM A388" },
      {
        client: "Job Client",
        inspection_site: "Works",
        inspection_date: "2026-11-24",
        standard: "EN 10228-3",
        equipment_serial: "SN-1",
        technicians: [{ name: "Sample Technician", qualification: "ISNT Level II (UT)" }],
      },
    );
    expect(merged.client).toBe("Typed Client");
    expect(merged.inspection_site).toBe("Works");
    expect(merged.inspection_date).toBe("2026-11-24");
    expect(merged.standard).toBe("ASTM A388");
    expect(merged.equipment_serial).toBe("SN-1");
    expect(merged.technicians).toEqual([{ name: "Sample Technician", qualification: "ISNT Level II (UT)" }]);
  });

  it("completes certificate details for a technician whose name was typed", () => {
    const lookup = [technicianLookup("Sample Technician", quals, "UT")];
    const merged = mergePrefill({ technicians: [{ name: "sample technician", qualification: "" }] }, {}, lookup);
    expect(merged.technicians?.[0]).toMatchObject({
      name: "sample technician",
      qualification: "ISO 9712 Level II (UT)",
      certificate_no: "U-2",
      valid_until: "2029-04-30",
    });
  });
});
