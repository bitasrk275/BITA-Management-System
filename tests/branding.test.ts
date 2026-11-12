import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  downloadBrandingImageDataUrl,
  loadReportApprovalAssets,
  loadReportLetterhead,
} from "@/lib/reports/branding.server";
import {
  generateReportDocxBytes,
} from "@/lib/reports/docx";
import {
  DEFAULT_BITA_INVOICE_PROFILE,
  buildInvoiceDocumentSpec,
  generateInvoiceDocxBytes,
  type InvoiceTemplateInput,
} from "@/lib/invoices";
import {
  removeEmployeeSignature,
  uploadEmployeeSignature,
} from "@/lib/modules/employees/service";

// Valid 1x1 transparent PNG data URL for fake testing
const FAKE_1X1_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const FAKE_PNG_DATA_URL = `data:image/png;base64,${FAKE_1X1_PNG_BASE64}`;

function createFakePngBlob() {
  const buf = Buffer.from(FAKE_1X1_PNG_BASE64, "base64");
  return new Blob([buf], { type: "image/png" });
}

describe("G7: Real branding on reports and invoices", () => {
  describe("downloadBrandingImageDataUrl", () => {
    it("returns undefined for empty or invalid paths", async () => {
      const mockSupabase = {
        storage: {
          from: vi.fn(),
        },
      } as unknown as SupabaseClient<Database>;

      expect(await downloadBrandingImageDataUrl(mockSupabase, null)).toBeUndefined();
      expect(await downloadBrandingImageDataUrl(mockSupabase, "")).toBeUndefined();
      expect(await downloadBrandingImageDataUrl(mockSupabase, "   ")).toBeUndefined();
      expect(await downloadBrandingImageDataUrl(mockSupabase, "/etc/passwd")).toBeUndefined();
      expect(await downloadBrandingImageDataUrl(mockSupabase, "../secret.png")).toBeUndefined();
    });

    it("downloads and encodes image data URL from branding bucket", async () => {
      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({
              data: createFakePngBlob(),
              error: null,
            }),
          }),
        },
      } as unknown as SupabaseClient<Database>;

      const dataUrl = await downloadBrandingImageDataUrl(
        mockSupabase,
        "logos/fake-logo.png"
      );
      expect(dataUrl).toBe(FAKE_PNG_DATA_URL);
    });

    it("falls back to documents bucket if branding bucket fails", async () => {
      const mockSupabase = {
        storage: {
          from: vi.fn((bucket: string) => {
            if (bucket === "branding") {
              return {
                download: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "Not found in branding" },
                }),
              };
            }
            return {
              download: vi.fn().mockResolvedValue({
                data: createFakePngBlob(),
                error: null,
              }),
            };
          }),
        },
      } as unknown as SupabaseClient<Database>;

      const dataUrl = await downloadBrandingImageDataUrl(
        mockSupabase,
        "seal-fallback.png"
      );
      expect(dataUrl).toBe(FAKE_PNG_DATA_URL);
    });
  });

  describe("loadReportLetterhead and loadReportApprovalAssets", () => {
    it("loads letterhead from company_profile setting with real logo path", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  value: {
                    name: "Apex Testing Laboratory",
                    address: "Plot 10, Industrial Estate\nBengaluru 560058",
                    phone: "+91 80 2839 0000",
                    email: "info@apex-lab.fake",
                    logo_path: "branding/logo-apex.png",
                    seal_path: "branding/seal-apex.png",
                    default_signatory_id: "sec-mgr-uuid",
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({
              data: createFakePngBlob(),
              error: null,
            }),
          }),
        },
      } as unknown as SupabaseClient<Database>;

      const { letterhead, sealPath, defaultSignatoryId } =
        await loadReportLetterhead(mockSupabase);

      expect(letterhead.name).toBe("Apex Testing Laboratory");
      expect(letterhead.addressLines).toEqual([
        "Plot 10, Industrial Estate",
        "Bengaluru 560058",
      ]);
      expect(letterhead.logoUrl).toBe(FAKE_PNG_DATA_URL);
      expect(sealPath).toBe("branding/seal-apex.png");
      expect(defaultSignatoryId).toBe("sec-mgr-uuid");
    });

    it("returns approved: false (no signature/seal) when unapproved", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        },
      } as unknown as SupabaseClient<Database>;

      const result = await loadReportApprovalAssets(mockSupabase, {
        approved: false,
        approvedAt: null,
        signatoryId: null,
        approvedBy: null,
      });

      expect(result.approval.approved).toBe(false);
      expect("signatureUrl" in result.approval).toBe(false);
      expect("sealUrl" in result.approval).toBe(false);
    });

    it("uses approver's signature when uploaded", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "settings") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      value: {
                        name: "BITA",
                        seal_path: "seal.png",
                        default_signatory_id: "fallback-mgr-id",
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "people") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "approver-id",
                      full_name: "Ramesh Sharma",
                      position: "Level III Reviewer",
                      signature_path: "signatures/ramesh.png",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({
              data: createFakePngBlob(),
              error: null,
            }),
          }),
        },
      } as unknown as SupabaseClient<Database>;

      const result = await loadReportApprovalAssets(mockSupabase, {
        approved: true,
        approvedAt: "2026-11-12T10:00:00Z",
        signatoryId: "approver-id",
        approvedBy: "approver-id",
      });

      expect(result.approval.approved).toBe(true);
      if (result.approval.approved) {
        expect(result.approval.signatoryName).toBe("Ramesh Sharma");
        expect(result.approval.signatoryQualification).toBe("Level III Reviewer");
        expect(result.approval.signatureUrl).toBe(FAKE_PNG_DATA_URL);
        expect(result.approval.sealUrl).toBe(FAKE_PNG_DATA_URL);
      }
    });

    it("falls back to default signatory when approver has no uploaded signature", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "settings") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      value: {
                        name: "BITA",
                        seal_path: "seal.png",
                        default_signatory_id: "default-second-mgr-id",
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "people") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn((col: string, val: string) => ({
                  maybeSingle: vi.fn().mockImplementation(async () => {
                    if (val === "approver-without-sig") {
                      return {
                        data: {
                          id: "approver-without-sig",
                          full_name: "Pooja Hegde",
                          position: "NDT Level II",
                          signature_path: null, // No signature
                        },
                        error: null,
                      };
                    }
                    if (val === "default-second-mgr-id") {
                      return {
                        data: {
                          id: "default-second-mgr-id",
                          full_name: "Operations Director",
                          position: "Technical Director",
                          signature_path: "signatures/director.png", // Has fallback signature
                        },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  }),
                })),
              }),
            };
          }
          return {};
        }),
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({
              data: createFakePngBlob(),
              error: null,
            }),
          }),
        },
      } as unknown as SupabaseClient<Database>;

      const result = await loadReportApprovalAssets(mockSupabase, {
        approved: true,
        approvedAt: "2026-11-12T10:00:00Z",
        signatoryId: "approver-without-sig",
        approvedBy: "approver-without-sig",
      });

      expect(result.approval.approved).toBe(true);
      if (result.approval.approved) {
        expect(result.approval.signatoryName).toBe("Pooja Hegde");
        // Falls back to director's signature
        expect(result.approval.signatureUrl).toBe(FAKE_PNG_DATA_URL);
      }
    });

    it("falls back to SVG placeholder when neither has a signature", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "settings") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      value: {
                        name: "BITA",
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "people") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "approver-without-sig",
                      full_name: "Technician Lead",
                      position: "Level II",
                      signature_path: null,
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
        storage: {
          from: vi.fn().mockReturnValue({
            download: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
          }),
        },
      } as unknown as SupabaseClient<Database>;

      const result = await loadReportApprovalAssets(mockSupabase, {
        approved: true,
        approvedAt: "2026-11-12T10:00:00Z",
        signatoryId: "approver-without-sig",
        approvedBy: "approver-without-sig",
      });

      expect(result.approval.approved).toBe(true);
      if (result.approval.approved) {
        expect(result.approval.signatureUrl).toMatch(/^data:image\/svg\+xml/);
        expect(result.approval.sealUrl).toMatch(/^data:image\/svg\+xml/);
      }
    });
  });

  describe("Employee signature service", () => {
    it("uploadEmployeeSignature uploads png and updates signature_path", async () => {
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      const uploadFn = vi.fn().mockResolvedValue({ error: null });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({ update: updateFn }),
        storage: {
          from: vi.fn().mockReturnValue({ upload: uploadFn }),
        },
      } as unknown as SupabaseClient<Database>;

      const res = await uploadEmployeeSignature(mockSupabase, "person-123", {
        name: "my_signature.png",
        type: "image/png",
        bytes: Buffer.from("fake-sig-bytes"),
      });

      expect(res.signature_path).toMatch(/^signatures\/person-123-\d+\.png$/);
      expect(uploadFn).toHaveBeenCalledWith(
        res.signature_path,
        expect.any(Buffer),
        expect.objectContaining({ contentType: "image/png" })
      );
      expect(updateFn).toHaveBeenCalledWith({
        signature_path: res.signature_path,
      });
    });

    it("rejects non-image signature files", async () => {
      const mockSupabase = {} as unknown as SupabaseClient<Database>;
      await expect(
        uploadEmployeeSignature(mockSupabase, "person-123", {
          name: "resume.pdf",
          type: "application/pdf",
          bytes: Buffer.from("pdf-bytes"),
        })
      ).rejects.toThrow("Only PNG or JPEG signature images are supported.");
    });

    it("removeEmployeeSignature clears signature_path to null", async () => {
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      const mockSupabase = {
        from: vi.fn().mockReturnValue({ update: updateFn }),
      } as unknown as SupabaseClient<Database>;

      const res = await removeEmployeeSignature(mockSupabase, "person-123");
      expect(res).toEqual({ success: true });
      expect(updateFn).toHaveBeenCalledWith({ signature_path: null });
    });
  });

  describe("Docx generation with branding images", () => {
    it("generateReportDocxBytes embeds PNG logo, signature, and seal without crashing", async () => {
      const doc = {
        reportNumber: "BITA/26-27/0001",
        reportDate: "2026-11-12",
        letterhead: {
          name: "Bangalore Inspection & Testing Agency",
          addressLines: ["Peenya Industrial Area, Bengaluru"],
          contactLines: ["Tel: 080 2839 0000"],
          logoUrl: FAKE_PNG_DATA_URL,
        },
        readings: {
          client: "Sample Engineering Ltd",
          location: "Customer Site",
          technicians: [{ name: "T. Kumar", qualification: "Level II" }],
          items: [
            {
              item_no: 1,
              description: "Turbine Rotor",
              identification_no: "TR-001",
              size: "200mm",
              quantity: 1,
              qty_unit: "No",
              observations: "No recordable indications",
              result: "ACCEPTABLE",
            },
          ],
        },
        approval: {
          approved: true,
          approvedAt: "2026-11-12T10:00:00Z",
          signatoryName: "K. R. Rao",
          signatoryQualification: "Level III",
          signatureUrl: FAKE_PNG_DATA_URL,
          sealUrl: FAKE_PNG_DATA_URL,
        },
      };

      const buffer = await generateReportDocxBytes("UT", doc);
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(1000);
      // Verify docx zip header signature (PK\x03\x04)
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
    });

    it("generateInvoiceDocxBytes embeds PNG logo and seal without crashing", async () => {
      const sampleInput: InvoiceTemplateInput = {
        kind: "tax_invoice",
        status: "issued",
        invoiceNo: "5388",
        invoiceDate: "2026-11-12",
        dueDate: "2026-12-12",
        jobNo: "BITA/26-27/0001",
        poNumber: "PO/2026/01",
        poDate: "2026-11-01",
        customerName: "Acme Industrial Components",
        customerAddress: "Plot 42, Peenya, Bengaluru",
        customerGstin: "29AAACA1234A1Z5",
        placeOfSupply: "29-Karnataka",
        taxableValue: 10000,
        cgst: 900,
        sgst: 900,
        igst: 0,
        roundOff: 0,
        total: 11800,
        notes: "Testing remarks",
        lines: [
          {
            description: "Ultrasonic Testing Services",
            sac: "998393",
            qty: 1,
            unit: "Job",
            rate: 10000,
            amount: 10000,
          },
        ],
        profile: {
          ...DEFAULT_BITA_INVOICE_PROFILE,
          logoUrl: FAKE_PNG_DATA_URL,
          sealUrl: FAKE_PNG_DATA_URL,
        },
      };

      const spec = buildInvoiceDocumentSpec(sampleInput);
      expect(spec.seller.logoUrl).toBe(FAKE_PNG_DATA_URL);
      expect(spec.seller.sealUrl).toBe(FAKE_PNG_DATA_URL);

      const buffer = await generateInvoiceDocxBytes(sampleInput);
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(1000);
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
    });

    it("safely handles SVG placeholders (does not crash with docx ImageRun errors)", async () => {
      const doc = {
        reportNumber: "BITA/26-27/0002",
        reportDate: "2026-11-12",
        letterhead: {
          name: "BITA",
          addressLines: ["Bengaluru"],
          logoUrl: undefined,
        },
        readings: {
          client: "Sample Engineering Ltd",
          location: "Customer Site",
          technicians: [],
          items: [],
        },
        approval: {
          approved: true,
          approvedAt: "2026-11-12T10:00:00Z",
          signatoryName: "Reviewer Name",
          signatureUrl: "data:image/svg+xml;utf8,<svg>placeholder</svg>",
          sealUrl: "data:image/svg+xml;utf8,<svg>placeholder</svg>",
        },
      };

      const buffer = await generateReportDocxBytes("UT", doc);
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(1000);
    });
  });
});
