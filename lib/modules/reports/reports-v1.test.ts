import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/types";
import { parseEnquiryInput } from "../enquiries/schema";
import { parseJobInput } from "../jobs/schema";
import { deleteJobRecord } from "../jobs/service";
import { parseQuotationInput } from "../quotations/schema";
import { deleteQuotationRecord } from "../quotations/service";
import { parseApproveReportInput, parseReturnReportInput } from "./schema";

describe("G2 – API v1 modules (enquiries, quotations, jobs, reports)", () => {
  it("1. Parses enquiry input from FormData and JSON objects", () => {
    const res = parseEnquiryInput({
      source: "email",
      from_name: "Demo Client",
      from_address: "qa@demo.example",
      subject: "UT Inspection for 12 shafts",
      body: "Please send quotation.",
      customer_id: "cust-123",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.source).toBe("email");
      expect(res.value.status).toBe("linked");
      expect(res.value.customer_id).toBe("cust-123");
    }
  });

  it("2. Parses quotation input and inline items", () => {
    const res = parseQuotationInput({
      customer_id: "cust-123",
      subject: "MPI & UT Inspection",
      items: [
        { description: "UT Shaft Inspection", basis: "Per piece", rate: 1500 },
        { description: "   ", rate: 500 },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.customer_id).toBe("cust-123");
      expect(res.value.items).toHaveLength(1);
      expect(res.value.items?.[0]?.description).toBe("UT Shaft Inspection");
      expect(res.value.items?.[0]?.rate).toBe(1500);
    }

    expect(parseQuotationInput({}).ok).toBe(false);
  });

  it("3. Refuses deleting a quotation that has an active linked job", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "settings") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === "jobs") {
          return {
            select: () => ({
              eq: () => ({
                is: async () => ({
                  data: [{ id: "job-1", job_no: "BITA/26-27/0099" }],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await deleteQuotationRecord(mockSupabase, "qt-1", ["management"]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("BITA/26-27/0099");
    }
  });

  it("4. Parses job input and refuses deleting a job with an issued invoice", async () => {
    const parsed = parseJobInput({
      customer_id: "cust-123",
      site: "Peenya Unit 2",
      test_methods: ["UT", "MPT"],
      po_number: "PO-7788",
      po_value: "45000",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.test_methods).toEqual(["UT", "MPT"]);
      expect(parsed.value.po_value).toBe(45000);
    }

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "settings") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === "invoices") {
          return {
            select: () => ({
              eq: () => ({
                neq: async () => ({
                  data: [
                    {
                      id: "inv-1",
                      invoice_no: "BITA/26-27/5390",
                      number: "BITA/26-27/5390",
                      status: "issued",
                      issued_at: "2026-11-10T00:00:00Z",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    const delRes = await deleteJobRecord(mockSupabase, "job-1", ["management"]);
    expect(delRes.ok).toBe(false);
    if (!delRes.ok) {
      expect(delRes.error).toContain("BITA/26-27/5390");
    }
  });

  it("5. Parses report approve and return inputs", () => {
    const approveIn = parseApproveReportInput({
      signatory_id: "sig-1",
      calibration_override_note: "Verified with master block",
    });
    expect(approveIn).toEqual({
      signatory_id: "sig-1",
      calibration_override_note: "Verified with master block",
    });

    expect(parseReturnReportInput({ note: "   " }).ok).toBe(false);
    expect(parseReturnReportInput({ note: "Fix couplant field" })).toEqual({
      ok: true,
      value: { note: "Fix couplant field" },
    });
  });
});
