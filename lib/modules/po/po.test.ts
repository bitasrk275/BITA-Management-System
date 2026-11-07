import { describe, expect, it } from "vitest";
import {
  evaluatePoValueWarning,
  parseAcceptQuotationInput,
  parsePoFieldsInput,
} from "./schema";

describe("PO module schema and warning calculation (P2)", () => {
  it("parses PO number, date, value, and job creation fields from objects and FormData", () => {
    const parsed = parseAcceptQuotationInput({
      po_number: " PO/2026/778 ",
      po_date: "2026-11-07",
      po_value: "50000",
      create_job: true,
      site: "Peenya Works",
      scope: "UT of 4 turbine shafts",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        po_number: "PO/2026/778",
        po_date: "2026-11-07",
        po_value: 50000,
        create_job: true,
        site: "Peenya Works",
        scope: "UT of 4 turbine shafts",
      },
    });

    const fd = new FormData();
    fd.set("po_number", "PO-99");
    fd.set("po_value", "12500.50");
    fd.set("create_job", "on");
    const fdRes = parseAcceptQuotationInput(fd);
    expect(fdRes.ok).toBe(true);
    if (fdRes.ok) {
      expect(fdRes.value.po_number).toBe("PO-99");
      expect(fdRes.value.po_value).toBe(12500.5);
      expect(fdRes.value.create_job).toBe(true);
    }
  });

  it("rejects negative PO values and malformed PO dates", () => {
    expect(parsePoFieldsInput({ po_value: -100 })).toEqual({
      ok: false,
      error: "PO value must be a non-negative amount.",
    });

    expect(parsePoFieldsInput({ po_date: "07-11-2026" })).toEqual({
      ok: false,
      error: "PO date must be in YYYY-MM-DD format.",
    });
  });

  it("warns when invoices against a PO total more than its value and stays silent when within PO value", () => {
    const within = evaluatePoValueWarning({
      poNumber: "PO/2026/100",
      poValue: 50000,
      otherInvoicesTotal: 20000,
      currentInvoiceTotal: 27200,
    });
    expect(within.exceedsPoValue).toBe(false);
    expect(within.totalInvoicedAgainstPo).toBe(47200);
    expect(within.exceededBy).toBe(0);
    expect(within.warningMessage).toBeNull();

    const exceeded = evaluatePoValueWarning({
      poNumber: "PO/2026/100",
      poValue: 50000,
      otherInvoicesTotal: 20000,
      currentInvoiceTotal: 35400,
    });
    expect(exceeded.exceedsPoValue).toBe(true);
    expect(exceeded.totalInvoicedAgainstPo).toBe(55400);
    expect(exceeded.exceededBy).toBe(5400);
    expect(exceeded.warningMessage).toContain("PO/2026/100");
    expect(exceeded.warningMessage).toContain("55,400");
    expect(exceeded.warningMessage).toContain("50,000");
    expect(exceeded.warningMessage).toContain("5,400");
  });

  it("does not warn when poValue is null or zero", () => {
    const noPoVal = evaluatePoValueWarning({
      poNumber: "PO/2026/101",
      poValue: null,
      otherInvoicesTotal: 0,
      currentInvoiceTotal: 88500,
    });
    expect(noPoVal.exceedsPoValue).toBe(false);
    expect(noPoVal.warningMessage).toBeNull();
  });
});
