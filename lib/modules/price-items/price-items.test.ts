import { describe, expect, it } from "vitest";
import { parsePriceItemInput } from "./schema";
import { buildDraftInvoiceLinesFromPriceList } from "./service";

describe("lib/modules/price-items (P3)", () => {
  it("validates price item inputs and defaults unit to 'nos'", () => {
    const valid = parsePriceItemInput({
      name: "UT service",
      description: "Ultrasonic Testing (UT) inspection charges",
      sac: "998346",
      default_rate: "7500",
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value).toEqual({
        name: "UT service",
        description: "Ultrasonic Testing (UT) inspection charges",
        sac: "998346",
        unit: "nos",
        default_rate: 7500,
        active: true,
      });
    }

    const missingName = parsePriceItemInput({ name: "  ", default_rate: 1000 });
    expect(missingName.ok).toBe(false);

    const negativeRate = parsePriceItemInput({ name: "Conveyance", default_rate: -500 });
    expect(negativeRate.ok).toBe(false);
  });

  it("builds initial draft invoice lines from the price list by method instead of quotation rates", () => {
    const priceItems = [
      {
        id: "p1",
        name: "UT service",
        description: "Ultrasonic Testing (UT) inspection charges",
        sac: "998346",
        unit: "nos",
        default_rate: 7500,
      },
      {
        id: "p2",
        name: "Conveyance",
        description: "Site visit and conveyance charges",
        sac: "998346",
        unit: "visit",
        default_rate: 4000,
      },
    ];

    const lines = buildDraftInvoiceLinesFromPriceList({
      priceItems,
      method: "UT",
      reportNo: "BITA/R/26-27/0012",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      position: 1,
      description: "Ultrasonic Testing (UT) inspection charges (Report BITA/R/26-27/0012)",
      sac: "998346",
      qty: 1,
      unit: "nos",
      rate: 7500,
      amount: 7500,
    });
  });
});
