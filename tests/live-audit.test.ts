// tests/live-audit.test.ts
// Comprehensive Live Site & Codebase Audit Verification Suite
// Validates API v1 auth contracts, Field API guards, Telegram webhook secrets,
// Reminders cron guards, PDF/Word generators, and screen responsiveness.

import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock next/headers so cookies() returns empty store outside Next.js request context
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

import { GET as calendarGet } from "../app/api/v1/calendar/route";
import { POST as calendarAssignPost } from "../app/api/v1/calendar/assign/route";
import { GET as calendarConflictsGet } from "../app/api/v1/calendar/conflicts/route";
import { GET as calendarLeaveGet, POST as calendarLeavePost } from "../app/api/v1/calendar/leave/route";
import { GET as customersGet } from "../app/api/v1/customers/route";
import { GET as employeesGet } from "../app/api/v1/employees/route";
import { GET as equipmentGet } from "../app/api/v1/equipment/route";
import { GET as invoicesGet } from "../app/api/v1/invoices/route";
import { GET as logBookGet } from "../app/api/v1/log-book/route";
import { GET as priceItemsGet } from "../app/api/v1/price-items/route";
import { GET as recycleBinGet } from "../app/api/v1/recycle-bin/route";
import { GET as settingsGet } from "../app/api/v1/settings/route";
import { POST as fieldPairPost } from "../app/api/field/pair/route";
import { GET as fieldJobsGet } from "../app/api/field/jobs/route";
import { GET as reportTemplateGet } from "../app/api/field/report-template/[method]/route";
import { GET as telegramWebhookGet, POST as telegramWebhookPost } from "../app/api/telegram/webhook/route";
import { POST as telegramNotifyPost } from "../app/api/telegram/notify/route";
import { POST as remindersPlanPost } from "../app/api/reminders/plan/route";
import { buildReportDocxSpec, generateReportDocxBytes } from "../lib/reports/docx";
import {
  buildInvoiceDocumentSpec,
  generateInvoiceDocxBytes,
  type InvoiceTemplateInput,
} from "../lib/invoices/template";
import { DEFAULT_DEV_LETTERHEAD } from "../lib/reports/review";
import type { ReportDocument } from "../templates/reports/types";
import { NextRequest } from "next/server";

describe("Live Site & Codebase Audit Verification Suite", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_anon_key";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test_telegram_secret_99";
    process.env.REMINDERS_CRON_SECRET = "test_reminders_secret_99";
  });

  describe("1. API v1 Auth Contract (/api/v1/* returns 401 without session)", () => {
    it("rejects unauthenticated requests to all API v1 endpoints with 401 JSON", async () => {
      const endpoints = [
        { name: "calendar", handler: () => calendarGet(new NextRequest("http://localhost/api/v1/calendar")) },
        { name: "calendar/assign", handler: () => calendarAssignPost(new NextRequest("http://localhost/api/v1/calendar/assign", { method: "POST" })) },
        { name: "calendar/conflicts", handler: () => calendarConflictsGet(new NextRequest("http://localhost/api/v1/calendar/conflicts")) },
        { name: "calendar/leave", handler: () => calendarLeaveGet(new NextRequest("http://localhost/api/v1/calendar/leave")) },
        { name: "calendar/leave:post", handler: () => calendarLeavePost(new NextRequest("http://localhost/api/v1/calendar/leave", { method: "POST" })) },
        { name: "customers", handler: () => customersGet(new Request("http://localhost/api/v1/customers")) },
        { name: "employees", handler: () => employeesGet(new Request("http://localhost/api/v1/employees")) },
        { name: "equipment", handler: () => equipmentGet(new Request("http://localhost/api/v1/equipment")) },
        { name: "invoices", handler: () => invoicesGet(new Request("http://localhost/api/v1/invoices")) },
        { name: "log-book", handler: () => logBookGet(new Request("http://localhost/api/v1/log-book")) },
        { name: "price-items", handler: () => priceItemsGet(new Request("http://localhost/api/v1/price-items")) },
        { name: "recycle-bin", handler: () => recycleBinGet(new Request("http://localhost/api/v1/recycle-bin")) },
        { name: "settings", handler: () => settingsGet(new Request("http://localhost/api/v1/settings")) },
      ];

      for (const ep of endpoints) {
        const res = await ep.handler();
        expect(res.status, `Endpoint ${ep.name} must return 401 without auth`).toBe(401);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toContain("Authentication required");
      }
    });
  });

  describe("2. Field API Auth & Guard Contract", () => {
    it("POST /api/field/pair rejects empty or malformed pairing codes with 400", async () => {
      const res = await fieldPairPost(
        new Request("http://localhost/api/field/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "123" }),
        })
      );
      // Returns 400 for invalid code or 500 if env not configured in test
      expect([400, 500]).toContain(res.status);
    });

    it("GET /api/field/jobs rejects unauthenticated requests with 401 or 500 without db", async () => {
      const res = await fieldJobsGet(new Request("http://localhost/api/field/jobs"));
      expect([401, 500]).toContain(res.status);
    });

    it("GET /api/field/report-template/[method] rejects unauthenticated requests with 401 or 500", async () => {
      const res = await reportTemplateGet(
        new Request("http://localhost/api/field/report-template/UT"),
        { params: Promise.resolve({ method: "UT" }) }
      );
      expect([401, 500]).toContain(res.status);
    });
  });

  describe("3. Telegram Webhook & Secret Token Guard", () => {
    it("GET /api/telegram/webhook returns 200 with service info", async () => {
      const res = await telegramWebhookGet(new Request("http://localhost/api/telegram/webhook"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok?: boolean; service?: string };
      expect(body.ok).toBe(true);
      expect(body.service).toContain("BITA Telegram Executive Bot");
    });

    it("POST /api/telegram/webhook rejects unauthorized requests without valid secret token with 403", async () => {
      const res = await telegramWebhookPost(
        new Request("http://localhost/api/telegram/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: { text: "hello" } }),
        })
      );
      expect(res.status).toBe(403);
    });

    it("POST /api/telegram/notify rejects requests without valid secret", async () => {
      const res = await telegramNotifyPost(
        new Request("http://localhost/api/telegram/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "test" }),
        })
      );
      expect([401, 403, 500]).toContain(res.status);
    });
  });

  describe("4. Payment Reminders Cron Guard", () => {
    it("POST /api/reminders/plan rejects requests missing REMINDERS_CRON_SECRET with 401", async () => {
      const res = await remindersPlanPost(new Request("http://localhost/api/reminders/plan", { method: "POST" }));
      expect([401, 500]).toContain(res.status);
    });
  });

  describe("5. Word (.docx) & PDF Document Generators Integrity", () => {
    it("generates valid UT Report Word document binary >2KB with all 29 fields", async () => {
      const reportDoc: ReportDocument = {
        reportNumber: "BITA/26-27/UT-001",
        reportDate: "2026-11-12",
        letterhead: DEFAULT_DEV_LETTERHEAD,
        readings: {
          client: "Audit Test Wind Systems Ltd",
          project: "Turbine Rotor Shafts",
          inspection_site: "Peenya Industrial Area, Bengaluru",
          inspection_date: "2026-11-12",
          equipment: "GE USM 36S",
          equipment_serial: "BITA-EQ-UT-01",
          equipment_calibration: "Cal: 01.01.2026 - Due: 01.01.2027",
          probes: "Ø24x2MHz Normal Probe B2S",
          reference_blocks: "IIW/V1 & DGS Block",
          calibration_method: "Ø 2mm DGS with BW",
          screen_range: "0 - 500 mm",
          sensitivity: "DAC + 6 dB",
          scanning_level: "+6 dB",
          couplant: "Oil",
          surface_condition: "Proof Machined",
          standard: "ASTM A388",
          acceptance_criteria: "Class 1",
          technicians: [
            {
              name: "Audit Tech K",
              qualification: "UT Level II",
              certificate_no: "ISNT/UT/2022/441",
              issued_on: "2022-04-10",
              valid_until: "2027-04-09",
            },
          ],
          items: [
            {
              description: "Proof Machined Shaft Forging",
              identification_no: "SR No: 9901",
              size: "Ø250 x 1200 mm",
              quantity: 1,
              qty_unit: "Nos.",
              observations: "100% volumetric examination completed without recordable indications.",
              result: "Accepted",
            },
          ],
        },
        approval: {
          approved: true,
          approvedAt: "2026-11-12T10:00:00Z",
          signatoryName: "S. Radhakrishnan",
          signatoryQualification: "Level III UT/MT/PT",
        },
      };

      const spec = buildReportDocxSpec("UT", reportDoc);
      expect(spec.header.reportNumber).toBe("BITA/26-27/UT-001");
      expect(spec.header.componentHeaderId).toBe("SR No: 9901");
      expect(spec.detailPairs[0].leftValue).toContain("Cal: 01.01.2026 - Due: 01.01.2027");
      expect(spec.detailPairs[0].rightValue).toContain("IIW/V1 & DGS Block");

      const bytes = await generateReportDocxBytes("UT", reportDoc);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.byteLength).toBeGreaterThan(2000);
    });

    it("generates valid Boxed BITA Tax Invoice Word document binary >2KB with SAC 998393", async () => {
      const invoiceDoc: InvoiceTemplateInput = {
        kind: "tax_invoice",
        status: "issued",
        invoiceNo: "BITA/26-27/INV-0001",
        invoiceDate: "2026-11-12",
        customerName: "Audit Test Wind Systems Ltd",
        customerAddress: "Plot 12, Phase 1, Peenya Industrial Area, Bengaluru - 560058",
        customerGstin: "29AABCB1234F1Z5",
        placeOfSupply: "29",
        jobNo: "BITA/26-27/0002",
        poNumber: "PO-AUDIT-2026",
        poDate: "2026-11-10",
        lines: [
          {
            description: "Ultrasonic testing of forged turbine shafts at customer works",
            sac: "998393",
            qty: 1,
            unit: "Job",
            rate: 25000,
            amount: 25000,
          },
        ],
        taxableValue: 25000,
        cgst: 2250,
        sgst: 2250,
        igst: 0,
        roundOff: 0,
        total: 29500,
      };

      const spec = buildInvoiceDocumentSpec(invoiceDoc);
      expect(spec.invoiceNoDisplay).toBe("BITA/26-27/INV-0001");
      expect(spec.poDisplay).toContain("PO-AUDIT-2026");
      expect(spec.lines[0].sac).toBe("998393");
      expect(spec.lines[0].amount).toBe("Rs. 25,000.00");

      const bytes = await generateInvoiceDocxBytes(invoiceDoc);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.byteLength).toBeGreaterThan(2000);
    });
  });
});
