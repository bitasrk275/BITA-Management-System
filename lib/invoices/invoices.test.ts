import { describe, expect, it } from "vitest";
import {
  BITA_STATE_CODE,
  amountInWordsINR,
  buildInvoiceDocumentSpec,
  buildInvoiceLines,
  calculateInvoiceGst,
  computeLineAmount,
  extractReportItems,
  formatPlaceOfSupply,
  generateInvoiceDocxBytes,
  generateInvoicePdfBytes,
  resolvePlaceOfSupplyCode,
  sumTaxableValue,
} from "./index";

describe("lib/invoices GST & paise rounding", () => {
  it("applies CGST 9% + SGST 9% when customer GSTIN state code is 29 (Karnataka)", () => {
    const res = calculateInvoiceGst(40000, { gstin: "29AAAAA0000A1Z5" });
    expect(res).toEqual({
      place_of_supply: "29",
      is_intra_state: true,
      taxable_value: 40000,
      cgst: 3600,
      sgst: 3600,
      igst: 0,
      gross_total: 47200,
      round_off: 0,
      total: 47200,
    });
  });

  it("applies IGST 18% when customer GSTIN is outside Karnataka (e.g. 33 Tamil Nadu)", () => {
    const res = calculateInvoiceGst(40000, { gstin: "33BBBBB1111B1Z2" });
    expect(res).toEqual({
      place_of_supply: "33",
      is_intra_state: false,
      taxable_value: 40000,
      cgst: 0,
      sgst: 0,
      igst: 7200,
      gross_total: 47200,
      round_off: 0,
      total: 47200,
    });
  });

  it("applies IGST 18% when there is no GSTIN and the billing state/address is outside Karnataka", () => {
    const byState = calculateInvoiceGst(10000, {
      gstin: null,
      billingState: "Maharashtra",
    });
    expect(byState.place_of_supply).toBe("27");
    expect(byState.is_intra_state).toBe(false);
    expect(byState.igst).toBe(1800);
    expect(byState.cgst).toBe(0);
    expect(byState.sgst).toBe(0);

    const byAddress = calculateInvoiceGst(10000, {
      gstin: null,
      billingAddress: "Plot 14, SIPCOT Industrial Complex, Hosur - 635126, Tamil Nadu",
    });
    expect(byAddress.place_of_supply).toBe("33");
    expect(byAddress.is_intra_state).toBe(false);
    expect(byAddress.igst).toBe(1800);
  });

  it("applies CGST 9% + SGST 9% when there is no GSTIN and billing address is in Karnataka", () => {
    const res = calculateInvoiceGst(10000, {
      gstin: null,
      billingAddress: "Peenya Industrial Area, Bengaluru - 560058",
    });
    expect(res.place_of_supply).toBe(BITA_STATE_CODE);
    expect(res.is_intra_state).toBe(true);
    expect(res.cgst).toBe(900);
    expect(res.sgst).toBe(900);
    expect(res.igst).toBe(0);
  });

  it("computes exact paise taxes and whole-rupee round-off on fractional totals", () => {
    // 1234.50 * 9% = 111.105 -> 111.11 each for CGST & SGST -> gross = 1234.50 + 222.22 = 1456.72 -> rounds to 1457 (+0.28)
    const up = calculateInvoiceGst(1234.5, { gstin: "29AAAAA0000A1Z5" });
    expect(up.cgst).toBe(111.11);
    expect(up.sgst).toBe(111.11);
    expect(up.gross_total).toBe(1456.72);
    expect(up.round_off).toBe(0.28);
    expect(up.total).toBe(1457);

    // 1001.00 * 18% = 180.18 -> gross = 1181.18 -> rounds down to 1181 (-0.18)
    const down = calculateInvoiceGst(1001, { gstin: "27AAAAA0000A1Z5" });
    expect(down.igst).toBe(180.18);
    expect(down.gross_total).toBe(1181.18);
    expect(down.round_off).toBe(-0.18);
    expect(down.total).toBe(1181);
  });

  it("formats place of supply with state code and name", () => {
    expect(resolvePlaceOfSupplyCode({ placeOfSupply: "29" })).toBe("29");
    expect(formatPlaceOfSupply("29")).toBe("29 - Karnataka");
    expect(formatPlaceOfSupply("33")).toBe("33 - Tamil Nadu");
  });
});

describe("lib/invoices Indian amount in words", () => {
  it("formats Indian amounts in words with hyphenated tens", () => {
    expect(amountInWordsINR(47200)).toBe("Rupees Forty-Seven Thousand Two Hundred only");
    expect(amountInWordsINR(0)).toBe("Rupees Zero only");
    expect(amountInWordsINR(8500)).toBe("Rupees Eight Thousand Five Hundred only");
    expect(amountInWordsINR(125450)).toBe("Rupees One Lakh Twenty-Five Thousand Four Hundred Fifty only");
    expect(amountInWordsINR(10500000)).toBe("Rupees One Crore Five Lakh only");
    expect(amountInWordsINR(1456.75)).toBe("Rupees One Thousand Four Hundred Fifty-Six and Seventy-Five Paise only");
  });
});

describe("lib/invoices quotation + report line builder and minimum charge", () => {
  it("applies minimum_charge when qty * rate is lower than minimum_charge", () => {
    // 1 shaft * Rs 5,500 = Rs 5,500 < minimum Rs 8,500 -> Rs 8,500
    const underMin = computeLineAmount(1, 5500, 8500);
    expect(underMin.raw_amount).toBe(5500);
    expect(underMin.minimum_charge_applied).toBe(true);
    expect(underMin.amount).toBe(8500);

    // 2 shafts * Rs 5,500 = Rs 11,000 >= minimum Rs 8,500 -> Rs 11,000
    const overMin = computeLineAmount(2, 5500, 8500);
    expect(overMin.raw_amount).toBe(11000);
    expect(overMin.minimum_charge_applied).toBe(false);
    expect(overMin.amount).toBe(11000);
  });

  it("builds lines from accepted quotation items and approved report items, applying minimum charge when needed", () => {
    const quotationItems = [
      {
        position: 1,
        description: "Ultrasonic Testing of Forged Exciter Shafts",
        basis: "per shaft",
        rate: 5500,
        minimum_charge: 8500,
      },
      {
        position: 2,
        description: "Magnetic Particle Inspection of Bearing Rings",
        basis: "per ring",
        rate: 1200,
        minimum_charge: 4000,
      },
    ];

    // Report has 1 exciter shaft (under minimum 8500) and 5 bearing rings (5 * 1200 = 6000 > minimum 4000)
    const reportContent = {
      items: [
        { description: "Forged Exciter Shaft Heat #H-8812", quantity: 1, observations: "Acceptable" },
        { description: "Bearing Rings Lot #BR-09", quantity: 5, observations: "No linear indications" },
      ],
    };

    const reportItems = extractReportItems(reportContent);
    const lines = buildInvoiceLines({
      quotationItems,
      reportItems,
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      position: 1,
      qty: 1,
      unit: "per shaft",
      rate: 5500,
      amount: 8500,
      minimum_charge: 8500,
      minimum_charge_applied: true,
    });
    expect(lines[0].description).toContain("Minimum charge applied");

    expect(lines[1]).toMatchObject({
      position: 2,
      qty: 5,
      unit: "per ring",
      rate: 1200,
      amount: 6000,
      minimum_charge: 4000,
      minimum_charge_applied: false,
    });

    expect(sumTaxableValue(lines)).toBe(14500);
  });

  it("combines multiple report rows under a single quotation item when total falls below minimum_charge", () => {
    const lines = buildInvoiceLines({
      quotationItems: [
        {
          position: 1,
          description: "UT Inspection of Shafts",
          basis: "per shaft",
          rate: 3000,
          minimum_charge: 8500,
        },
      ],
      reportItems: [
        { description: "Shaft #1", quantity: 1 },
        { description: "Shaft #2", quantity: 1 },
      ],
    });

    // 2 shafts * 3000 = 6000 < 8500 minimum charge -> single combined line at 8500
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
    expect(lines[0].amount).toBe(8500);
    expect(lines[0].minimum_charge_applied).toBe(true);
  });
});

describe("lib/invoices PDF and Word (.docx) template builder", () => {
  const sampleInput = {
    status: "issued",
    invoiceNo: "BITA/26-27/INV-0001",
    invoiceDate: "2026-11-06",
    dueDate: "2026-12-06",
    jobNo: "BITA/26-27/0007",
    reportNo: "DEMO-BITA/UT/26-27/0895",
    quotationRef: "DEMO-QT-2026-003",
    poNumber: "TTIL/PO/2026/104",
    poDate: "2026-10-29",
    customerName: "Test Turbines India Ltd",
    customerAddress: "Plot 42, Peenya Industrial Area, Bengaluru - 560058",
    customerGstin: "29AAACT0000A1Z5",
    placeOfSupply: "29",
    lines: [
      {
        position: 1,
        description: "Ultrasonic Testing of Forged Alloy Steel Exciter Shafts",
        sac: "",
        qty: 2,
        unit: "per shaft",
        rate: 20000,
        amount: 40000,
      },
    ],
    taxableValue: 40000,
    cgst: 3600,
    sgst: 3600,
    igst: 0,
    roundOff: 0,
    total: 47200,
    notes: "Test certificate enclosed.",
  };

  it("builds a complete InvoiceDocumentSpec with amount in words and placeholders", () => {
    const spec = buildInvoiceDocumentSpec(sampleInput);
    expect(spec.title).toBe("TAX INVOICE");
    expect(spec.isDraft).toBe(false);
    expect(spec.placeOfSupplyDisplay).toBe("29 - Karnataka");
    expect(spec.amountInWords).toBe("Rupees Forty-Seven Thousand Two Hundred only");
    expect(spec.seller.bankDetailsPlaceholder).toContain("BANK DETAILS PLACEHOLDER");
    expect(spec.seller.termsPlaceholder).toContain("TERMS & CONDITIONS PLACEHOLDER");
  });

  it("generates valid PDF 1.4 bytes containing BITA tax invoice details", () => {
    const pdfBytes = generateInvoicePdfBytes(sampleInput);
    const text = Buffer.from(pdfBytes).toString("utf8");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("BITA/26-27/INV-0001");
    expect(text).toContain("Test Turbines India Ltd");
    expect(text).toContain("Rupees Forty-Seven Thousand Two Hundred only");
  });

  it("generates a valid .docx ZIP archive using docx@9.13.0", async () => {
    const docxBytes = await generateInvoiceDocxBytes(sampleInput);
    expect(docxBytes.byteLength).toBeGreaterThan(2000);
    // PK\x03\x04 ZIP header
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  });
});
