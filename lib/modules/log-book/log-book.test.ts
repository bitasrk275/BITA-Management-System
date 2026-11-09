import { describe, expect, it } from "vitest";
import {
  computeExpenseTotals,
  parseJobExpenseInput,
  parseMonthRange,
  parseUpdateLogBookEntryInput,
} from "./schema";

describe("Log book schema & expense calculations (Task A4)", () => {
  const sampleJobId = "11111111-1111-1111-1111-111111111111";
  const sampleEntryId = "22222222-2222-2222-2222-222222222222";
  const samplePersonId = "33333333-3333-3333-3333-333333333333";

  it("parses month range into start and end dates", () => {
    const febLeap = parseMonthRange("2024-02");
    expect(febLeap).toEqual({
      month: "2024-02",
      startDate: "2024-02-01",
      endDate: "2024-02-29",
    });

    const nov = parseMonthRange("2026-11");
    expect(nov).toEqual({
      month: "2026-11",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
  });

  it("validates and normalizes job expense input", () => {
    const parsed = parseJobExpenseInput({
      job_id: sampleJobId,
      log_book_id: sampleEntryId,
      person_id: samplePersonId,
      expense_date: "2026-11-08",
      kind: "travel",
      amount: "425.5",
      note: "  Cab to Peenya Stage II  ",
    });

    expect(parsed).toEqual({
      job_id: sampleJobId,
      log_book_id: sampleEntryId,
      person_id: samplePersonId,
      expense_date: "2026-11-08",
      kind: "travel",
      amount: 425.5,
      note: "Cab to Peenya Stage II",
    });
  });

  it("rejects invalid job_id, negative amount, or unsupported kind", () => {
    expect(() =>
      parseJobExpenseInput({
        job_id: "not-a-uuid",
        kind: "travel",
        amount: 100,
      })
    ).toThrow(/valid job/i);

    expect(() =>
      parseJobExpenseInput({
        job_id: sampleJobId,
        kind: "travel",
        amount: -10,
      })
    ).toThrow(/non-negative/i);

    expect(() =>
      parseJobExpenseInput({
        job_id: sampleJobId,
        kind: "flights",
        amount: 100,
      })
    ).toThrow(/valid expense kind/i);
  });

  it("computes per-job, per-kind, and monthly expense totals accurately", () => {
    const job2 = "44444444-4444-4444-4444-444444444444";
    const totals = computeExpenseTotals(
      [
        {
          job_id: sampleJobId,
          expense_date: "2026-11-05",
          kind: "travel",
          amount: 350,
        },
        {
          job_id: sampleJobId,
          expense_date: "2026-11-06",
          kind: "food",
          amount: 180.5,
        },
        {
          job_id: job2,
          expense_date: "2026-10-28",
          kind: "consumables",
          amount: 1200,
        },
      ],
      "2026-11"
    );

    expect(totals.monthlyTotal).toBe(530.5);
    expect(totals.totalAll).toBe(1730.5);
    expect(totals.byJob[sampleJobId]).toBe(530.5);
    expect(totals.byJob[job2]).toBe(1200);
    expect(totals.byKind.travel).toBe(350);
    expect(totals.byKind.food).toBe(180.5);
    expect(totals.byKind.consumables).toBe(1200);
  });

  it("validates log book entry updates and enforces end_date >= work_date", () => {
    const ok = parseUpdateLogBookEntryInput({
      status: "completed",
      notes: "Completed UT on 4 shafts",
      work_date: "2026-11-07",
      end_date: "2026-11-09",
    });
    expect(ok.status).toBe("completed");
    expect(ok.end_date).toBe("2026-11-09");

    expect(() =>
      parseUpdateLogBookEntryInput({
        work_date: "2026-11-10",
        end_date: "2026-11-08",
      })
    ).toThrow(/End date cannot be earlier/i);
  });
});
