import { describe, expect, it } from "vitest";
import {
  buildJobRegisterRows,
  jobRegisterToCsv,
  jobRegisterToExcelXml,
  type RawJobRegisterSource,
} from "./register-export";

const SAMPLE_SOURCES: RawJobRegisterSource[] = [
  {
    id: "job-1",
    job_no: "BITA/26-27/0010",
    customer_id: "cust-a",
    customer_name: "Test Turbines India Ltd",
    site: "Peenya Unit 1",
    scope: "UT on forged shafts",
    status: "invoiced",
    test_methods: ["UT", "MPT"],
    po_number: "PO-TTIL-88",
    created_at: "2026-11-01T00:00:00Z",
    assignments: [
      { work_date: "2026-11-03", person_name: "Demo Technician A" },
      { work_date: "2026-11-04", person_name: "Demo Technician B" },
    ],
    inspections: [
      {
        readings: {
          readings: {
            component: "Rotor Shaft",
            items: [
              { description: "Main Pinion", identification_no: "MP-101" },
            ],
          },
        },
        submitted_by_name: "Demo Technician A",
        submitted_at: "2026-11-04T10:00:00Z",
      },
    ],
    reports: [
      {
        id: "rep-1",
        report_no: "BITA/26-27/R-0010",
        report_date: "2026-11-05",
        method: "UT",
        content: {
          readings: {
            component_header_id: "SN-9001",
            items: [
              { description: "Main Pinion", identification_no: "MP-101" },
            ],
          },
        },
      },
    ],
    invoices: [
      {
        invoice_no: "BITA/26-27/5388",
        status: "issued",
        kind: "tax_invoice",
      },
    ],
  },
  {
    id: "job-2",
    job_no: "BITA/25-26/0099",
    customer_id: "cust-b",
    customer_name: "Sample Forgings Pvt Ltd",
    site: "Hosur Plant",
    scope: "DPT on weld joints",
    status: "scheduled",
    test_methods: ["DPT"],
    po_number: null,
    created_at: "2026-02-10T00:00:00Z",
    assignments: [{ work_date: "2026-02-12", person_name: "Demo Technician B" }],
    inspections: [],
    reports: [],
    invoices: [],
  },
];

describe("G3 – Jobs register export (R17 notebook format)", () => {
  it("1. Builds BITA notebook columns and applies FY, month, and customer filters", () => {
    const fy2627 = buildJobRegisterRows(SAMPLE_SOURCES, { fy: "2026-27" });
    expect(fy2627).toHaveLength(1);
    const r = fy2627[0]!;
    expect(r.date_of_testing).toBe("2026-11-03");
    expect(r.person_who_tested).toBe("Demo Technician A, Demo Technician B");
    expect(r.customer).toBe("Test Turbines India Ltd");
    expect(r.report_numbers).toBe("BITA/26-27/R-0010");
    expect(r.component_serial_no).toContain("SN-9001");
    expect(r.component_serial_no).toContain("Main Pinion (MP-101)");
    expect(r.details_of_testing).toContain("UT");
    expect(r.details_of_testing).toContain("MPT");
    expect(r.invoice_generated).toBe("Yes");
    expect(r.invoice_numbers).toBe("BITA/26-27/5388");
    expect(r.remarks).toContain("PO: PO-TTIL-88");

    // Month filter
    expect(
      buildJobRegisterRows(SAMPLE_SOURCES, { month: "2026-02" }),
    ).toHaveLength(1);
    expect(
      buildJobRegisterRows(SAMPLE_SOURCES, { month: "2026-02" })[0]?.invoice_generated,
    ).toBe("No");

    // Customer filter
    expect(
      buildJobRegisterRows(SAMPLE_SOURCES, { customerId: "cust-b" }),
    ).toHaveLength(1);
  });

  it("2. Exports CSV and Excel (.xls) with all 9 notebook columns and neutralizes formula injection", () => {
    const rows = buildJobRegisterRows([
      {
        ...SAMPLE_SOURCES[0]!,
        customer_name: '=CMD|" /C calc"!A0',
      },
    ]);

    const csv = jobRegisterToCsv(rows);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      "Date of Testing,Person Who Tested,Customer,Report Number(s),Component / Serial Number,Details of Testing,Invoice Generated (Yes/No),Invoice Number(s),Remarks",
    );
    expect(csv).toContain("'=CMD|");

    const xls = jobRegisterToExcelXml(rows);
    expect(xls).toContain('<Worksheet ss:Name="Jobs Register">');
    expect(xls).toContain("Date of Testing");
    expect(xls).toContain("&apos;=CMD|");
  });
});
