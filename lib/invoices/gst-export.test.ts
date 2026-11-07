import { describe, expect, it } from "vitest";
import {
  B2B_GST_COLUMNS,
  B2C_GST_COLUMNS,
  buildGstExportReport,
  resolveGstExportPeriod,
  toB2bCsv,
  toB2cCsv,
  toCombinedGstCsv,
  toGstExcelXml,
  type GstExportInvoiceInput,
} from "./gst-export";

describe("lib/invoices/gst-export", () => {
  const sampleInvoices: GstExportInvoiceInput[] = [
    // 1. Draft invoice (must be excluded)
    {
      status: "draft",
      invoice_no: null,
      invoice_date: "2026-11-05",
      customer_name: "Draft Co",
      customer_gstin: "29AAAAA0000A1Z5",
      place_of_supply: "29",
      taxable_value: 50000,
      cgst: 4500,
      sgst: 4500,
      igst: 0,
      total: 59000,
    },
    // 2. Proforma invoice (must be excluded)
    {
      kind: "proforma",
      status: "issued",
      invoice_no: "PI-26-27/041",
      invoice_date: "2026-11-05",
      customer_name: "Test Turbines India Ltd",
      customer_gstin: "29AAACT0000A1Z5",
      taxable_value: 10000,
      cgst: 900,
      sgst: 900,
      igst: 0,
      total: 11800,
    },
    // 3. B2B intra-state issued invoice
    {
      kind: "tax_invoice",
      status: "issued",
      invoice_no: "BITA/26-27/INV-0001",
      invoice_date: "2026-11-06",
      customer_name: "Test Turbines India Ltd",
      customer_gstin: "29AAACT0000A1Z5",
      place_of_supply: "29",
      lines: [{ sac: "998346" }],
      taxable_value: 40000,
      cgst: 3600,
      sgst: 3600,
      igst: 0,
      total: 47200,
    },
    // 4. B2B inter-state paid invoice
    {
      kind: "tax_invoice",
      status: "paid",
      invoice_no: "BITA/26-27/INV-0002",
      invoice_date: "2026-11-10",
      customer_name: "Chennai Heavy Forgings Pvt Ltd",
      customer_gstin: "33BBBCF1111B1Z2",
      place_of_supply: "33",
      lines: [{ sac: "998346" }],
      taxable_value: 20000,
      cgst: 0,
      sgst: 0,
      igst: 3600,
      total: 23600,
    },
    // 5. B2B cancelled invoice (must be included as "cancelled" with 0.00 amounts)
    {
      kind: "tax_invoice",
      status: "cancelled",
      invoice_no: "BITA/26-27/INV-0003",
      invoice_date: "2026-11-12",
      customer_name: "Cancelled Gears Pvt Ltd",
      customer_gstin: "29CCCCG2222C1Z9",
      place_of_supply: "29",
      taxable_value: 15000,
      cgst: 1350,
      sgst: 1350,
      igst: 0,
      total: 17700,
    },
    // 6. B2C partly_paid invoice (no GSTIN)
    {
      kind: "tax_invoice",
      status: "partly_paid",
      invoice_no: "BITA/26-27/INV-0004",
      invoice_date: "2026-11-15",
      customer_name: "Unregistered Workshop Bengaluru",
      customer_gstin: null,
      place_of_supply: "29",
      taxable_value: 10000,
      cgst: 900,
      sgst: 900,
      igst: 0,
      total: 11800,
    },
    // 7. Invoice from a different month (2026-10)
    {
      kind: "tax_invoice",
      status: "paid",
      invoice_no: "BITA/26-27/INV-0000",
      invoice_date: "2026-10-20",
      customer_name: "October Customer Ltd",
      customer_gstin: "29OCTOO0000A1Z5",
      place_of_supply: "29",
      taxable_value: 5000,
      cgst: 450,
      sgst: 450,
      igst: 0,
      total: 5900,
    },
  ];

  it("resolves month or custom date range into exact YYYY-MM-DD bounds", () => {
    expect(resolveGstExportPeriod({ month: "2026-11" })).toEqual({
      fromDate: "2026-11-01",
      toDate: "2026-11-30",
      month: "2026-11",
    });
    expect(resolveGstExportPeriod({ from: "2026-11-05", to: "2026-11-20" })).toEqual({
      fromDate: "2026-11-05",
      toDate: "2026-11-20",
      month: "2026-11",
    });
  });

  it("splits B2B and B2C, excludes drafts/proformas/out-of-range, and zeroes cancelled invoice amounts", () => {
    const report = buildGstExportReport(sampleInvoices, {
      fromDate: "2026-11-01",
      toDate: "2026-11-30",
    });

    // B2B has INV-0001 (issued), INV-0002 (paid), INV-0003 (cancelled)
    expect(report.b2b).toHaveLength(3);
    expect(report.b2b.map((r) => r.invoice_no)).toEqual([
      "BITA/26-27/INV-0001",
      "BITA/26-27/INV-0002",
      "BITA/26-27/INV-0003",
    ]);

    const cancelledRow = report.b2b[2];
    expect(cancelledRow.status).toBe("cancelled");
    expect(cancelledRow.taxable_value).toBe(0);
    expect(cancelledRow.cgst).toBe(0);
    expect(cancelledRow.sgst).toBe(0);
    expect(cancelledRow.igst).toBe(0);
    expect(cancelledRow.total).toBe(0);

    // B2B totals sum only active rows (40000 + 20000 = 60000 taxable; 3600 CGST; 3600 SGST; 3600 IGST; 70800 total)
    expect(report.b2b_totals).toEqual({
      count: 3,
      cancelled_count: 1,
      taxable_value: 60000,
      cgst: 3600,
      sgst: 3600,
      igst: 3600,
      total: 70800,
    });

    // B2C has INV-0004
    expect(report.b2c).toHaveLength(1);
    expect(report.b2c[0].invoice_no).toBe("BITA/26-27/INV-0004");
    expect(report.b2c_totals).toEqual({
      count: 1,
      cancelled_count: 0,
      taxable_value: 10000,
      cgst: 900,
      sgst: 900,
      igst: 0,
      total: 11800,
    });

    // Grand totals
    expect(report.grand_totals).toEqual({
      count: 4,
      cancelled_count: 1,
      taxable_value: 70000,
      cgst: 4500,
      sgst: 4500,
      igst: 3600,
      total: 82600,
    });
  });

  it("keeps B2B and B2C column definitions in one place with B2C omitting Customer GSTIN", () => {
    expect(B2B_GST_COLUMNS.map((c) => c.key)).toEqual([
      "customer_gstin",
      "customer_name",
      "invoice_no",
      "invoice_date",
      "place_of_supply",
      "sac",
      "status",
      "taxable_value",
      "cgst",
      "sgst",
      "igst",
      "total",
    ]);
    expect(B2C_GST_COLUMNS.map((c) => c.key)).toEqual(
      B2B_GST_COLUMNS.filter((c) => c.key !== "customer_gstin").map((c) => c.key),
    );
  });

  it("serializes B2B CSV, B2C CSV, combined CSV, and Excel XML workbook", () => {
    const report = buildGstExportReport(sampleInvoices, {
      fromDate: "2026-11-01",
      toDate: "2026-11-30",
    });

    const b2bCsv = toB2bCsv(report);
    expect(b2bCsv).toContain("Customer GSTIN,Customer Name,Invoice No,Invoice Date,Place of Supply,SAC,Status,Taxable Value,CGST,SGST,IGST,Total");
    expect(b2bCsv).toContain("29AAACT0000A1Z5,Test Turbines India Ltd,BITA/26-27/INV-0001,2026-11-06,29 - Karnataka,998346,issued,40000.00,3600.00,3600.00,0.00,47200.00");
    expect(b2bCsv).toContain("29CCCCG2222C1Z9,Cancelled Gears Pvt Ltd,BITA/26-27/INV-0003,2026-11-12,29 - Karnataka,,cancelled,0.00,0.00,0.00,0.00,0.00");

    const b2cCsv = toB2cCsv(report);
    expect(b2cCsv).toContain("Customer Name,Invoice No,Invoice Date,Place of Supply,SAC,Status,Taxable Value,CGST,SGST,IGST,Total");
    expect(b2cCsv).not.toContain("Customer GSTIN");
    expect(b2cCsv).toContain("Unregistered Workshop Bengaluru,BITA/26-27/INV-0004");

    const combinedCsv = toCombinedGstCsv(report);
    expect(combinedCsv).toContain("SECTION 1: B2B INVOICES");
    expect(combinedCsv).toContain("SECTION 2: B2C INVOICES");
    expect(combinedCsv).toContain("GRAND TOTAL,4,1,70000.00,4500.00,4500.00,3600.00,82600.00");

    const excelXml = toGstExcelXml(report);
    expect(excelXml).toContain('<Worksheet ss:Name="B2B Invoices">');
    expect(excelXml).toContain('<Worksheet ss:Name="B2C Invoices">');
    expect(excelXml).toContain("BITA/26-27/INV-0001");
  });
});

describe("csvEscapeCell formula guard", () => {
  it("neutralises text that a spreadsheet would run as a formula, but keeps numbers", async () => {
    const { csvEscapeCell } = await import("./gst-export");
    expect(csvEscapeCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvEscapeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscapeCell("-12.50")).toBe("-12.50");
    expect(csvEscapeCell("Test Customer Pvt Ltd")).toBe("Test Customer Pvt Ltd");
  });
});
