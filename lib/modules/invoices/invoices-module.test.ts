import { describe, expect, it } from "vitest";
import {
  collectDistinctPoNumbers,
  isReportInvoicePending,
  validateReportsShareCustomerGstin,
  type ReportInvoiceCandidate,
} from "./service";

function makeReport(overrides: Partial<ReportInvoiceCandidate> = {}): ReportInvoiceCandidate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    report_no: "BITA/UT/26-27/0101",
    report_date: "2026-11-07",
    method: "UT",
    status: "approved",
    approved_at: "2026-11-07T10:00:00Z",
    job_id: "22222222-2222-4222-8222-222222222222",
    job_no: "BITA/26-27/0010",
    customer_id: "33333333-3333-4333-8333-333333333333",
    customer_name: "Peenya Precision Forgings Pvt Ltd",
    customer_gstin: "29AABCP1234F1Z5",
    customer_po_number: "PPF/PO/2026/101",
    po_value: 50000,
    ...overrides,
  };
}

describe("P4a: Invoice pending status & multi-report invoice validation", () => {
  it("marks an approved report as Invoice pending until linked to a non-cancelled invoice", () => {
    const activeSet = new Set<string>();
    const r = makeReport();
    expect(isReportInvoicePending(r, activeSet)).toBe(true);

    // Draft or in_review report is not Invoice pending
    expect(
      isReportInvoicePending(
        { id: r.id, status: "in_review", approved_at: null },
        activeSet,
      ),
    ).toBe(false);

    // Once added to an active invoice, it is no longer Invoice pending
    activeSet.add(r.id);
    expect(isReportInvoicePending(r, activeSet)).toBe(false);
  });

  it("collects distinct non-empty PO numbers in order across reports", () => {
    expect(
      collectDistinctPoNumbers([
        "PPF/PO/2026/101",
        " ppf/po/2026/101 ",
        "PPF/PO/2026/102",
        null,
        "",
      ]),
    ).toBe("PPF/PO/2026/101, PPF/PO/2026/102");
  });

  it("allows combining several approved reports with the same customer GSTIN and merges their PO numbers", () => {
    const r1 = makeReport({
      id: "11111111-1111-4111-8111-111111111101",
      report_no: "BITA/UT/26-27/0101",
      customer_po_number: "PPF/PO/2026/101",
    });
    const r2 = makeReport({
      id: "11111111-1111-4111-8111-111111111102",
      report_no: "BITA/MPT/26-27/0102",
      method: "MPT",
      job_id: "22222222-2222-4222-8222-222222222223",
      job_no: "BITA/26-27/0011",
      customer_po_number: "PPF/PO/2026/102",
    });

    const group = validateReportsShareCustomerGstin([r1, r2]);
    expect(group.customer_gstin).toBe("29AABCP1234F1Z5");
    expect(group.combined_po_number).toBe("PPF/PO/2026/101, PPF/PO/2026/102");
    expect(group.distinct_po_numbers).toEqual(["PPF/PO/2026/101", "PPF/PO/2026/102"]);
  });

  it("refuses combining reports with different customer GSTINs", () => {
    const r1 = makeReport({ customer_gstin: "29AABCP1234F1Z5" });
    const r2 = makeReport({
      id: "11111111-1111-4111-8111-111111111109",
      report_no: "BITA/UT/26-27/0109",
      customer_name: "Other Forgings Ltd",
      customer_gstin: "33AABCO9999K1Z1",
    });

    expect(() => validateReportsShareCustomerGstin([r1, r2])).toThrow(
      /same customer GSTIN/,
    );
  });

  it("refuses combining an unapproved report", () => {
    const r1 = makeReport();
    const r2 = makeReport({
      id: "11111111-1111-4111-8111-111111111108",
      report_no: "BITA/UT/26-27/0108",
      status: "in_review",
      approved_at: null,
    });

    expect(() => validateReportsShareCustomerGstin([r1, r2])).toThrow(
      /not approved yet/,
    );
  });
});
