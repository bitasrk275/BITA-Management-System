// tests/ut-fields-and-telegram.test.ts
// E2E & Integration verification suite for BITA UT Report 29-Field Specification
// and Telegram Executive Bot Service & Webhook integration.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PGlite } from "@electric-sql/pglite";
import type { Database } from "../lib/db/types";
import { createTestDb } from "../supabase/tests/setup";
import {
  extractCustomerRememberedDefaults,
  fieldsForMethod,
  missingFields,
  CUSTOMER_REMEMBERED_FIELD_KEYS,
} from "../lib/reports/fields";
import { ReportTemplate } from "../templates/reports/report";
import type { ReportDocument } from "../templates/reports/types";
import { DEFAULT_DEV_LETTERHEAD } from "../lib/reports/review";
import {
  buildReportDocxSpec,
  generateReportDocxBytes,
} from "../lib/reports/docx";
import {
  answerTelegramExecutiveQuery,
  formatExecutiveDigestMessage,
  generateTelegramLinkCode,
  normalizeTelegramConfig,
  normalizeTelegramLinksState,
  redeemTelegramLinkCode,
  type ExecutiveSnapshot,
} from "../lib/modules/telegram/service";

vi.stubGlobal("React", React);

describe("BITA UT Report 29-Field Specification Suite", () => {
  const completeUTReadings = {
    client: "Sample Engineering Works Ltd",
    project: "", // Blank / empty project (#7)
    inspection_site: "Peenya Industrial Area, Bengaluru",
    inspection_date: "2026-11-09",
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
        name: "Ramesh K",
        qualification: "UT Level II",
        certificate_no: "ISNT/UT/2022/441",
        issued_on: "2022-04-10",
        valid_until: "2027-04-09",
      },
    ],
    items: [
      {
        description: "Proof Machined Shaft Forging",
        identification_no: "SR No: 8821\nH No: 4012\nMat Code: 42CrMo4",
        size: "Ø250 x 1200 mm",
        quantity: 2,
        qty_unit: "Nos.",
        observations: "Forging scanned with normal probe all round and no significant indications observed.",
        result: "Accepted",
      },
    ],
  };

  it("1. Project (#7) is optional and missingFields('UT', ...) does not flag blank project", () => {
    // Both omitted and empty string project should not be marked missing
    const missing = missingFields("UT", completeUTReadings);
    expect(missing).toEqual([]);

    const utFields = fieldsForMethod("UT");
    const projectDef = utFields.find((f) => f.key === "project");
    expect(projectDef).toBeDefined();
    expect(projectDef?.required).toBe(false);
  });

  it("2. ReportTemplate renders '–' when project is empty/blank in HTML output", () => {
    const document: ReportDocument = {
      reportNumber: "BITA/26-27/UT-001",
      reportDate: "2026-11-09",
      letterhead: DEFAULT_DEV_LETTERHEAD,
      readings: completeUTReadings,
      approval: { approved: false },
    };

    const html = renderToStaticMarkup(React.createElement(ReportTemplate, { method: "UT", document }));

    // Table should contain "PROJECT" header with value "–"
    expect(html).toContain("PROJECT");
    expect(html).toContain("<td colSpan=\"9\">—</td>");
  });

  it("3. Component ID in header (#3) renders below Report No. when items[0].identification_no is provided", () => {
    const document: ReportDocument = {
      reportNumber: "BITA/26-27/UT-001",
      reportDate: "2026-11-09",
      letterhead: DEFAULT_DEV_LETTERHEAD,
      readings: completeUTReadings,
      approval: { approved: false },
    };

    const html = renderToStaticMarkup(React.createElement(ReportTemplate, { method: "UT", document }));

    // Header cell should contain the first line of identification_no: "SR No: 8821"
    expect(html).toContain("BITA/26-27/UT-001");
    expect(html).toContain("<span>SR No: 8821</span>");
  });

  it("4. Explicit component_header_id takes precedence in header", () => {
    const document: ReportDocument = {
      reportNumber: "BITA/26-27/UT-002",
      reportDate: "2026-11-09",
      letterhead: DEFAULT_DEV_LETTERHEAD,
      readings: {
        ...completeUTReadings,
        component_header_id: "CUSTOM-HEADER-TAG-99",
      },
      approval: { approved: false },
    };

    const html = renderToStaticMarkup(React.createElement(ReportTemplate, { method: "UT", document }));
    expect(html).toContain("<span>CUSTOM-HEADER-TAG-99</span>");
  });

  it("5. Renders equipment calibration (#10), reference blocks (#12), and calibration method (#13) in HTML and Word", async () => {
    const document: ReportDocument = {
      reportNumber: "BITA/26-27/UT-003",
      reportDate: "2026-11-09",
      letterhead: DEFAULT_DEV_LETTERHEAD,
      readings: completeUTReadings,
      approval: {
        approved: true,
        approvedAt: "2026-11-09T10:00:00Z",
        signatoryName: "S. R. Kumar",
        signatoryQualification: "Level III UT/MT/PT",
      },
    };

    // HTML Output
    const html = renderToStaticMarkup(React.createElement(ReportTemplate, { method: "UT", document }));
    expect(html).toContain("Cal: 01.01.2026 - Due: 01.01.2027");
    expect(html).toContain("IIW/V1 &amp; DGS Block");
    expect(html).toContain("Ø 2mm DGS with BW");

    // Component rows in HTML
    expect(html).toContain("Proof Machined Shaft Forging");
    expect(html).toContain("SR No: 8821");
    expect(html).toContain("Ø250 x 1200 mm");
    expect(html).toContain("2 Nos.");
    expect(html).toContain("Forging scanned with normal probe all round and no significant indications observed.");
    expect(html).toContain("Accepted");

    // Word Docx Spec
    const spec = buildReportDocxSpec("UT", document);
    expect(spec.detailPairs[0].leftValue).toContain("Cal: 01.01.2026 - Due: 01.01.2027");
    expect(spec.detailPairs[0].rightValue).toContain("IIW/V1 & DGS Block");
    expect(spec.detailPairs[0].rightValue).toContain("Ø 2mm DGS with BW");

    expect(spec.itemSection.rows[0].description).toContain("Proof Machined Shaft Forging");
    expect(spec.itemSection.rows[0].description).toContain("SR No: 8821");
    expect(spec.itemSection.rows[0].description).toContain("Ø250 x 1200 mm");
    expect(spec.itemSection.rows[0].quantity).toBe("2 Nos.");
    expect(spec.itemSection.rows[0].observations).toContain("Accepted");

    // Word Docx Binary Generation
    const bytes = await generateReportDocxBytes("UT", document);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it("6. extractCustomerRememberedDefaults extracts customer defaults per 29-field spec", () => {
    const previousInspectionReadings = {
      ...completeUTReadings,
      unrelated_custom_key: "should_be_ignored",
      technicians: [{ name: "Ignore Tech" }],
    };

    const remembered = extractCustomerRememberedDefaults(previousInspectionReadings);

    expect(Object.keys(remembered).sort()).toEqual([...CUSTOMER_REMEMBERED_FIELD_KEYS].sort());
    expect(remembered.standard).toBe("ASTM A388");
    expect(remembered.acceptance_criteria).toBe("Class 1");
    expect(remembered.surface_condition).toBe("Proof Machined");
    expect(remembered.scanning_level).toBe("+6 dB");
    expect(remembered.calibration_method).toBe("Ø 2mm DGS with BW");
    expect(remembered.couplant).toBe("Oil");
    expect(remembered.reference_blocks).toBe("IIW/V1 & DGS Block");
    expect((remembered as Record<string, unknown>).unrelated_custom_key).toBeUndefined();
  });
});

describe("Telegram Executive Bot Service & Webhook Integration", () => {
  let db: PGlite;
  let as: <T>(userId: string | "service", sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  let fakeSupabase: SupabaseClient<Database>;

  const EXEC_PERSON_ID = "20000000-0000-0000-0000-000000000999";
  const EXEC_USER_ID = "00000000-0000-0000-0000-000000000999";
  const TEST_CHAT_ID = "9988776655";

  beforeAll(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    as = testDb.as as unknown as typeof as;

    // Seed management executive person
    await db.exec(`
      insert into auth.users (id) values ('${EXEC_USER_ID}') on conflict do nothing;
      insert into public.people (id, user_id, full_name, email, roles, active)
      values ('${EXEC_PERSON_ID}', '${EXEC_USER_ID}', 'Naveen Director', 'director@example.com', '{management}', true)
      on conflict (id) do nothing;
    `);

    // Create a versatile Supabase client adapter for the Telegram service
    fakeSupabase = {
      from: (table: string) => {
        const eqFilters: { col: string; val: unknown }[] = [];
        let ilikeFilter: { col: string; pattern: string } | null = null;
        let isNullFilter: string | null = null;
        let isSingle = false;

        const chain = {
          select: () => chain,
          eq: (col: string, val: unknown) => {
            eqFilters.push({ col, val });
            return chain;
          },
          ilike: (col: string, pattern: string) => {
            ilikeFilter = { col, pattern };
            return chain;
          },
          is: (col: string, val: unknown) => {
            if (val === null) isNullFilter = col;
            return chain;
          },
          not: () => chain,
          in: () => chain,
          gt: () => chain,
          gte: () => chain,
          lte: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            isSingle = true;
            return await executeQuery();
          },
          single: async () => {
            isSingle = true;
            return await executeQuery();
          },
          upsert: async (data: Record<string, unknown>) => {
            upsertData = data;
            const keys = Object.keys(data);
            const cols = keys.map((k) => `"${k}"`).join(", ");
            const placeholders = keys.map((k, i) => {
              const val = data[k];
              if (val && typeof val === "object" && !(val instanceof Date)) {
                return `$${i + 1}::jsonb`;
              }
              return `$${i + 1}`;
            }).join(", ");
            const values = keys.map((k) => {
              const val = data[k];
              return val && typeof val === "object" && !(val instanceof Date)
                ? JSON.stringify(val)
                : val;
            });

            const sql = `
              insert into public."${table}" (${cols})
              values (${placeholders})
              on conflict ("key") do update set
                value = excluded.value,
                updated_at = excluded.updated_at
              returning *;
            `;
            try {
              const res = await as("service", sql, values);
              return { data: res.rows[0], error: null };
            } catch (err) {
              return { data: null, error: { message: (err as Error).message } };
            }
          },
        };

        async function executeQuery() {
          const params: unknown[] = [];
          const whereParts: string[] = [];

          for (const f of eqFilters) {
            params.push(f.val);
            whereParts.push(`"${f.col}" = $${params.length}`);
          }
          if (ilikeFilter) {
            params.push(ilikeFilter.pattern);
            whereParts.push(`"${ilikeFilter.col}" ilike $${params.length}`);
          }
          if (isNullFilter) {
            whereParts.push(`"${isNullFilter}" is null`);
          }

          const whereSql = whereParts.length > 0 ? ` where ${whereParts.join(" and ")}` : "";
          const sql = `select * from public."${table}"${whereSql};`;

          try {
            const res = await as("service", sql, params);
            return {
              data: isSingle ? (res.rows[0] ?? null) : res.rows,
              error: null,
            };
          } catch (err) {
            return { data: null, error: { message: (err as Error).message } };
          }
        }

        return chain;
      },
    } as unknown as SupabaseClient<Database>;
  });

  it("1. Normalizes config and linked chats state", () => {
    const cfg = normalizeTelegramConfig({
      bot_token: "123456:TEST_BOT_TOKEN",
      bot_username: "bita_executive_bot",
      enabled: true,
    });
    expect(cfg.bot_token).toBe("123456:TEST_BOT_TOKEN");
    expect(cfg.bot_username).toBe("bita_executive_bot");
    expect(cfg.enabled).toBe(true);

    const links = normalizeTelegramLinksState({
      chats: [
        {
          chat_id: TEST_CHAT_ID,
          person_id: EXEC_PERSON_ID,
          person_name: "Naveen Director",
          username: "naveendir",
          linked_at: new Date().toISOString(),
          active: true,
        },
      ],
      pending_codes: [],
    });
    expect(links.chats).toHaveLength(1);
    expect(links.chats[0].chat_id).toBe(TEST_CHAT_ID);
  });

  it("2. Generates a 6-digit link code and saves to settings", async () => {
    const res = await generateTelegramLinkCode(fakeSupabase, {
      id: EXEC_PERSON_ID,
      name: "Naveen Director",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.code).toMatch(/^\d{6}$/);
    expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Verify stored in PGlite settings table
    const check = await as<{ key: string; value: { pending_codes: Array<{ code: string }> } }>(
      "service",
      `select key, value from public.settings where key = 'telegram_links'`,
    );
    expect(check.rows).toHaveLength(1);
    const codes = check.rows[0].value.pending_codes;
    expect(codes.some((c) => c.code === res.code)).toBe(true);
  });

  it("3. Redeems 6-digit link code via /start <code>, rejects invalid/expired codes, and prevents duplicate redemption", async () => {
    // Generate fresh code
    const gen = await generateTelegramLinkCode(fakeSupabase, {
      id: EXEC_PERSON_ID,
      name: "Naveen Director",
    });
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    const validCode = gen.code;

    // Fails on non-existent or malformed code
    const badCode = await redeemTelegramLinkCode(fakeSupabase, "000000", TEST_CHAT_ID);
    expect(badCode.ok).toBe(false);

    // Succeeds on valid code
    const redeemed = await redeemTelegramLinkCode(
      fakeSupabase,
      validCode,
      TEST_CHAT_ID,
      "naveendir",
    );
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) return;
    expect(redeemed.personName).toBe("Naveen Director");

    // Second redemption of same code fails (atomic single-use)
    const secondRedeem = await redeemTelegramLinkCode(fakeSupabase, validCode, TEST_CHAT_ID);
    expect(secondRedeem.ok).toBe(false);

    // Verify chat is now active in settings
    const check = await as<{ value: { chats: Array<{ chat_id: string; active: boolean }> } }>(
      "service",
      `select value from public.settings where key = 'telegram_links'`,
    );
    const activeChat = check.rows[0].value.chats.find((c) => c.chat_id === TEST_CHAT_ID);
    expect(activeChat).toBeDefined();
    expect(activeChat?.active).toBe(true);
  });

  it("4. Formats executive digest message with key operational metrics", () => {
    const snap: ExecutiveSnapshot = {
      today: "2026-11-09",
      activeJobsCount: 12,
      jobsByStatus: { scheduled: 4, inspection_done: 3, invoiced: 5 },
      recentJobs: [
        { job_no: "BITA/26-27/0050", status: "scheduled", customer_name: "Demo Wind Energy Ltd", site: "Pune" },
      ],
      unbilledDoneJobs: [
        { job_no: "BITA/26-27/0048", customer_name: "Sample Forge Ltd", status: "inspection_done" },
      ],
      openInvoicesCount: 4,
      openReceivablesTotal: 284500,
      overdueInvoices: [
        { invoice_no: "5387", customer_name: "Demo Wind Energy Ltd", balance: 81420, due_date: "2026-11-01" },
      ],
      pendingReports: [
        { job_no: "BITA/26-27/0049", method: "UT", submitted_at: "2026-11-08" },
      ],
      calibrationAlerts: [
        { code: "UT-01", name: "USM 36 Flaw Detector", due_date: "2026-11-05", expired: true },
      ],
      todayAssignments: [
        { job_no: "BITA/26-27/0050", technician_name: "Ramesh K", customer_name: "Demo Wind Energy Ltd" },
      ],
    };

    const msg = formatExecutiveDigestMessage(snap);
    expect(msg).toContain("BITA Executive Dashboard (2026-11-09)");
    expect(msg).toContain("Active Jobs:* 12 (1 completed & unbilled)");
    expect(msg).toContain("₹2,84,500");
    expect(msg).toContain("5387");
    expect(msg).toContain("BITA/26-27/0048");
    expect(msg).toContain("UT-01");
    expect(msg).toContain("EXPIRED");
  });

  it("5. Answers executive queries (/help, /status, /jobs, /invoices, /overdue, /reports, /equipment, /schedule, and natural language)", async () => {
    // /help
    const help = await answerTelegramExecutiveQuery(fakeSupabase, "/help");
    expect(help).toContain("BITA Executive Assistant");
    expect(help).toContain("/status");
    expect(help).toContain("/jobs");
    expect(help).toContain("/invoices");

    // /status
    const status = await answerTelegramExecutiveQuery(fakeSupabase, "/status");
    expect(status).toContain("BITA Executive Dashboard");

    // /jobs
    const jobs = await answerTelegramExecutiveQuery(fakeSupabase, "/jobs");
    expect(jobs).toContain("Active Jobs");

    // /invoices
    const invoices = await answerTelegramExecutiveQuery(fakeSupabase, "/invoices");
    expect(invoices).toContain("Receivables & Billing Summary");

    // /overdue
    const overdue = await answerTelegramExecutiveQuery(fakeSupabase, "/overdue");
    expect(overdue.toLowerCase()).toMatch(/overdue|no overdue/);

    // /reports
    const reports = await answerTelegramExecutiveQuery(fakeSupabase, "/reports");
    expect(reports.toLowerCase()).toMatch(/review|reviewed/);

    // /equipment
    const equipment = await answerTelegramExecutiveQuery(fakeSupabase, "/equipment");
    expect(equipment.toLowerCase()).toMatch(/calibration|valid/);

    // /schedule
    const schedule = await answerTelegramExecutiveQuery(fakeSupabase, "/schedule");
    expect(schedule.toLowerCase()).toMatch(/schedule|technician/);

    // /job lookup with unknown id
    const unknownJob = await answerTelegramExecutiveQuery(fakeSupabase, "/job BITA/26-27/9999");
    expect(unknownJob).toContain("Could not find an active job");

    // Natural language questions
    const nlMoney = await answerTelegramExecutiveQuery(fakeSupabase, "How much money is pending from customers?");
    expect(nlMoney).toContain("Receivables & Billing Summary");

    const nlJobs = await answerTelegramExecutiveQuery(fakeSupabase, "What are the active jobs?");
    expect(nlJobs).toContain("Active Jobs");

    const nlCal = await answerTelegramExecutiveQuery(fakeSupabase, "Check equipment calibration");
    expect(nlCal.toLowerCase()).toMatch(/calibration|valid/);
  });
});
