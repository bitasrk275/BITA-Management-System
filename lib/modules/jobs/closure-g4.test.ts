import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/types";
import { createTestDb } from "../../../supabase/tests/setup";

vi.mock("server-only", () => ({}));

import {
  createCreditNoteForInvoice,
  recordInvoicePayment,
} from "../invoices/service";
import { markReportSentRecord } from "../reports/service";
import { closeJobRecord, reopenJobRecord } from "./service";

const MGMT_USER = "00000000-0000-0000-0000-000000000401";
const OFFICE_USER = "00000000-0000-0000-0000-000000000402";
const REVIEWER_USER = "00000000-0000-0000-0000-000000000403";

const MGMT_PERSON = "00000000-0000-0000-0000-000000001401";
const OFFICE_PERSON = "00000000-0000-0000-0000-000000001402";
const REVIEWER_PERSON = "00000000-0000-0000-0000-000000001403";

type AsFn = Awaited<ReturnType<typeof createTestDb>>["as"];

/**
 * Minimal PGlite-backed SupabaseClient adapter supporting `.from()` queries
 * used by `evaluateAndAutoCloseJob`, `recordInvoicePayment`, `createCreditNoteForInvoice`,
 * `markReportSentRecord`, `closeJobRecord`, and `reopenJobRecord`.
 */
function createPgliteSupabaseAdapter(
  as: AsFn,
  userId: string | "service" = OFFICE_USER,
): SupabaseClient<Database> {
  function buildBuilder(table: string) {
    let op: "select" | "insert" | "update" = "select";
    let selectCols = "*";
    let insertPayload: Record<string, unknown> | null = null;
    let updatePayload: Record<string, unknown> | null = null;
    const eqFilters: Array<[string, unknown]> = [];
    const neqFilters: Array<[string, unknown]> = [];
    const inFilters: Array<[string, unknown[]]> = [];
    let singleMode: "single" | "maybeSingle" | null = null;

    function buildWhereClause(startIndex: number) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      let idx = startIndex;

      for (const [col, val] of eqFilters) {
        clauses.push(`${col} = $${idx++}`);
        params.push(val);
      }
      for (const [col, val] of neqFilters) {
        clauses.push(`${col} <> $${idx++}`);
        params.push(val);
      }
      for (const [col, vals] of inFilters) {
        if (vals.length === 0) {
          clauses.push("false");
        } else {
          const placeholders = vals.map(() => `$${idx++}`).join(", ");
          clauses.push(`${col} in (${placeholders})`);
          params.push(...vals);
        }
      }
      return {
        whereSql: clauses.length > 0 ? `where ${clauses.join(" and ")}` : "",
        params,
      };
    }

    async function execute() {
      try {
        if (op === "insert" && insertPayload) {
          const cols = Object.keys(insertPayload);
          const vals = cols.map((c) => insertPayload![c]);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          const sql = `insert into ${table} (${cols.join(", ")}) values (${placeholders}) returning *`;
          const res = await as<Record<string, unknown>>(userId, sql, vals);
          const rows = res.rows;
          return {
            data: singleMode ? (rows[0] ?? null) : rows,
            error: null,
          };
        }

        if (op === "update" && updatePayload) {
          const cols = Object.keys(updatePayload);
          const vals = cols.map((c) => updatePayload![c]);
          const setSql = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
          const { whereSql, params } = buildWhereClause(cols.length + 1);
          const sql = `update ${table} set ${setSql} ${whereSql} returning *`;
          const res = await as<Record<string, unknown>>(userId, sql, [
            ...vals,
            ...params,
          ]);
          const rows = res.rows;
          return {
            data: singleMode ? (rows[0] ?? null) : rows,
            error: null,
          };
        }

        const { whereSql, params } = buildWhereClause(1);
        const res = await as<Record<string, unknown>>(
          userId,
          `select * from ${table} ${whereSql}`,
          params,
        );
        let rows = res.rows;

        if (table === "invoices" && selectCols.includes("payments(")) {
          const enriched: Record<string, unknown>[] = [];
          for (const inv of rows) {
            const payRes = await as<Record<string, unknown>>(
              userId,
              `select amount, tds_amount from payments where invoice_id = $1`,
              [inv.id],
            );
            const cnRes = await as<Record<string, unknown>>(
              userId,
              `select total, status from credit_notes where invoice_id = $1`,
              [inv.id],
            );
            const jobRes = await as<Record<string, unknown>>(
              userId,
              `select customer_id from jobs where id = $1`,
              [inv.job_id],
            );
            let custRow: Record<string, unknown> | null = null;
            if (jobRes.rows[0]?.customer_id) {
              const cRes = await as<Record<string, unknown>>(
                userId,
                `select gstin, billing_address from customers where id = $1`,
                [jobRes.rows[0].customer_id],
              );
              custRow = cRes.rows[0] ?? null;
            }
            enriched.push({
              ...inv,
              payments: payRes.rows,
              credit_notes: cnRes.rows,
              jobs: { customers: custRow },
            });
          }
          rows = enriched;
        } else if (table === "invoices" && selectCols.includes("jobs(")) {
          const enriched: Record<string, unknown>[] = [];
          for (const inv of rows) {
            const jobRes = await as<Record<string, unknown>>(
              userId,
              `select customer_id from jobs where id = $1`,
              [inv.job_id],
            );
            let custRow: Record<string, unknown> | null = null;
            if (jobRes.rows[0]?.customer_id) {
              const cRes = await as<Record<string, unknown>>(
                userId,
                `select gstin, billing_address from customers where id = $1`,
                [jobRes.rows[0].customer_id],
              );
              custRow = cRes.rows[0] ?? null;
            }
            enriched.push({
              ...inv,
              jobs: { customers: custRow },
            });
          }
          rows = enriched;
        } else if (
          table === "invoice_reports" &&
          selectCols.includes("invoice:invoices(")
        ) {
          const enriched: Record<string, unknown>[] = [];
          for (const ir of rows) {
            const invRes = await as<Record<string, unknown>>(
              userId,
              `select id, kind, status, total, balance from invoices where id = $1`,
              [ir.invoice_id],
            );
            const inv = invRes.rows[0] ?? null;
            if (inv) {
              const payRes = await as<Record<string, unknown>>(
                userId,
                `select amount, tds_amount from payments where invoice_id = $1`,
                [inv.id],
              );
              const cnRes = await as<Record<string, unknown>>(
                userId,
                `select total, status from credit_notes where invoice_id = $1`,
                [inv.id],
              );
              enriched.push({
                ...ir,
                invoice: {
                  ...inv,
                  payments: payRes.rows,
                  credit_notes: cnRes.rows,
                },
              });
            }
          }
          rows = enriched;
        } else if (
          table === "invoice_reports" &&
          selectCols.includes("reports(job_id)")
        ) {
          const enriched: Record<string, unknown>[] = [];
          for (const ir of rows) {
            const repRes = await as<Record<string, unknown>>(
              userId,
              `select job_id from reports where id = $1`,
              [ir.report_id],
            );
            enriched.push({
              ...ir,
              reports: repRes.rows[0] ?? null,
            });
          }
          rows = enriched;
        }

        return {
          data: singleMode ? (rows[0] ?? null) : rows,
          error: null,
        };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    const builder = {
      select(cols = "*") {
        selectCols = cols;
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        op = "insert";
        insertPayload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        op = "update";
        updatePayload = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        eqFilters.push([col, val]);
        return builder;
      },
      neq(col: string, val: unknown) {
        neqFilters.push([col, val]);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        inFilters.push([col, vals]);
        return builder;
      },
      single() {
        singleMode = "single";
        return execute();
      },
      maybeSingle() {
        singleMode = "maybeSingle";
        return execute();
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return execute().then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  return {
    from(table: string) {
      return buildBuilder(table);
    },
  } as unknown as SupabaseClient<Database>;
}

describe("G4 – Automatic and manual job closure with audit_log", () => {
  let as: AsFn;
  let customerId: string;

  beforeAll(async () => {
    const tdb = await createTestDb();
    as = tdb.as;

    await tdb.db.exec(`
      insert into auth.users (id) values
        ('${MGMT_USER}'),
        ('${OFFICE_USER}'),
        ('${REVIEWER_USER}');
      insert into people (id, user_id, full_name, roles, active) values
        ('${MGMT_PERSON}', '${MGMT_USER}', 'Fake Manager', '{management}', true),
        ('${OFFICE_PERSON}', '${OFFICE_USER}', 'Fake Office', '{office}', true),
        ('${REVIEWER_PERSON}', '${REVIEWER_USER}', 'Fake Reviewer', '{reviewer}', true);
    `);

    const custRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into customers (name, code, gstin, billing_address, payment_terms_days)
       values ('Fake Closure Customer Pvt Ltd', 'FCC', '29AAACC1206D1ZM', 'Peenya, Bengaluru, Karnataka - 560058', 30)
       returning id`,
    );
    customerId = custRes.rows[0]!.id;
  }, 60000);

  it("auto-closes a job in the payment + credit note path once report is sent and tax invoice is settled", async () => {
    const supabase = createPgliteSupabaseAdapter(as, OFFICE_USER);

    const jobRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into jobs (customer_id, site, scope, test_methods, status)
       values ($1, 'Peenya Unit 1', 'UT of forged shafts', '{UT}', 'invoiced')
       returning id`,
      [customerId],
    );
    const jobId = jobRes.rows[0]!.id;

    const repRes = await as<{ id: string }>(
      REVIEWER_USER,
      `insert into reports (job_id, method, report_no, report_date, content, status, approved_by, approved_at, sent_at, sent_to)
       values ($1, 'UT', 'BITA/UT/26-27/9401', '2026-11-10', '{"items":[]}'::jsonb, 'sent', $2, now(), now(), '{qa@fake-closure.example.test}')
       returning id`,
      [jobId, REVIEWER_PERSON],
    );
    const reportId = repRes.rows[0]!.id;

    // Issue a tax invoice for Rs 11,800 (10,000 + 900 CGST + 900 SGST)
    const invDraft = await as<{ id: string }>(
      OFFICE_USER,
      `insert into invoices (job_id, kind, report_id, place_of_supply, invoice_date, taxable_value, cgst, sgst, igst, round_off, total, status)
       values ($1, 'tax_invoice', $2, '29', '2026-11-10', 10000, 900, 900, 0, 0, 11800, 'draft')
       returning id`,
      [jobId, reportId],
    );
    const invoiceId = invDraft.rows[0]!.id;

    await as(
      OFFICE_USER,
      `insert into invoice_lines (invoice_id, position, description, sac, qty, unit, rate, amount)
       values ($1, 1, 'UT Testing', '998393', 1, 'job', 10000, 10000)`,
      [invoiceId],
    );
    await as(
      OFFICE_USER,
      `update invoices set status = 'issued' where id = $1`,
      [invoiceId],
    );

    // 1. Record partial payment (Rs 8,000 + Rs 840 TDS = Rs 8,840 settled; Rs 2,960 remaining)
    await recordInvoicePayment(supabase, invoiceId, {
      amount: 8000,
      tds_amount: 840,
      total_settled: 8840,
      paid_on: "2026-11-11",
      mode: "NEFT",
      reference: "UTR-G4-PART",
    });

    const jobAfterPartial = await as<{ status: string; closed_at: string | null }>(
      OFFICE_USER,
      `select status, closed_at from jobs where id = $1`,
      [jobId],
    );
    expect(jobAfterPartial.rows[0]?.status).toBe("invoiced");
    expect(jobAfterPartial.rows[0]?.closed_at).toBeNull();

    // 2. Issue credit note for Rs 1,000 taxable (Rs 1,180 total) -> Rs 1,780 remaining
    await createCreditNoteForInvoice(supabase, {
      invoice_id: invoiceId,
      reason: "Rate adjustment",
      taxable_value: 1000,
      credit_date: "2026-11-11",
      notes: "Fake test credit note",
      issue_immediately: true,
    });

    const jobAfterCn = await as<{ status: string }>(
      OFFICE_USER,
      `select status from jobs where id = $1`,
      [jobId],
    );
    expect(jobAfterCn.rows[0]?.status).toBe("invoiced");

    // 3. Record final payment of Rs 1,780 -> balance becomes 0 -> job auto-closes!
    await recordInvoicePayment(supabase, invoiceId, {
      amount: 1780,
      tds_amount: 0,
      total_settled: 1780,
      paid_on: "2026-11-12",
      mode: "NEFT",
      reference: "UTR-G4-FINAL",
    });

    const jobAfterFinal = await as<{ status: string; closed_at: string | null }>(
      OFFICE_USER,
      `select status, closed_at from jobs where id = $1`,
      [jobId],
    );
    expect(jobAfterFinal.rows[0]?.status).toBe("closed");
    expect(jobAfterFinal.rows[0]?.closed_at).toBeTruthy();

    // Verify audit_log captured the job closure
    const auditRes = await as<{ changed_fields: string[]; new_row: { status: string } }>(
      MGMT_USER,
      `select changed_fields, new_row from audit_log
       where table_name = 'jobs' and record_id = $1 and action = 'update'
       order by id desc limit 1`,
      [jobId],
    );
    expect(auditRes.rows[0]?.new_row.status).toBe("closed");
    expect(auditRes.rows[0]?.changed_fields).toContain("status");
  });

  it("auto-closes a job in the mark-sent path when its tax invoice is already paid, and supports manual Reopen / Close by management", async () => {
    const officeSupabase = createPgliteSupabaseAdapter(as, OFFICE_USER);
    const mgmtSupabase = createPgliteSupabaseAdapter(as, MGMT_USER);

    const jobRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into jobs (customer_id, site, scope, test_methods, status)
       values ($1, 'Peenya Unit 2', 'MPT of gears', '{MPT}', 'invoiced')
       returning id`,
      [customerId],
    );
    const jobId = jobRes.rows[0]!.id;

    // Report is approved, not yet sent
    const repRes = await as<{ id: string }>(
      REVIEWER_USER,
      `insert into reports (job_id, method, report_no, report_date, content, status, approved_by, approved_at)
       values ($1, 'MPT', 'BITA/MPT/26-27/9402', '2026-11-10', '{"items":[]}'::jsonb, 'approved', $2, now())
       returning id`,
      [jobId, REVIEWER_PERSON],
    );
    const reportId = repRes.rows[0]!.id;

    const invDraft = await as<{ id: string }>(
      OFFICE_USER,
      `insert into invoices (job_id, kind, report_id, place_of_supply, invoice_date, taxable_value, cgst, sgst, igst, round_off, total, status)
       values ($1, 'tax_invoice', $2, '29', '2026-11-10', 5000, 450, 450, 0, 0, 5900, 'draft')
       returning id`,
      [jobId, reportId],
    );
    const invoiceId = invDraft.rows[0]!.id;

    await as(
      OFFICE_USER,
      `insert into invoice_lines (invoice_id, position, description, sac, qty, unit, rate, amount)
       values ($1, 1, 'MPT Testing', '998393', 1, 'job', 5000, 5000)`,
      [invoiceId],
    );
    await as(
      OFFICE_USER,
      `update invoices set status = 'issued' where id = $1`,
      [invoiceId],
    );

    // Pay the invoice in full while report is still only 'approved' (not 'sent')
    await recordInvoicePayment(officeSupabase, invoiceId, {
      amount: 5400,
      tds_amount: 500,
      total_settled: 5900,
      paid_on: "2026-11-11",
      mode: "RTGS",
      reference: "UTR-G4-PREPAID",
    });

    const jobBeforeSend = await as<{ status: string }>(
      OFFICE_USER,
      `select status from jobs where id = $1`,
      [jobId],
    );
    expect(jobBeforeSend.rows[0]?.status).toBe("invoiced");

    // Now mark the report sent via the service -> job auto-closes!
    const sendRes = await markReportSentRecord(
      officeSupabase,
      reportId,
      "qa@fake-closure.example.test",
    );
    expect(sendRes.error).toBeNull();
    expect(sendRes.jobClosed).toBe(true);

    const jobAfterSend = await as<{ status: string; closed_at: string | null }>(
      OFFICE_USER,
      `select status, closed_at from jobs where id = $1`,
      [jobId],
    );
    expect(jobAfterSend.rows[0]?.status).toBe("closed");
    expect(jobAfterSend.rows[0]?.closed_at).toBeTruthy();

    // Office cannot reopen a closed job
    const officeReopen = await reopenJobRecord(officeSupabase, jobId, ["office"]);
    expect(officeReopen.error).toMatch(/Only management can reopen/);

    // Management reopens the closed job -> status restored to 'invoiced', closed_at cleared, logged in audit_log
    const mgmtReopen = await reopenJobRecord(mgmtSupabase, jobId, ["management"]);
    expect(mgmtReopen.error).toBeNull();
    expect(mgmtReopen.data?.status).toBe("invoiced");
    expect(mgmtReopen.data?.closed_at).toBeNull();

    // Management manually closes the job again
    const mgmtClose = await closeJobRecord(mgmtSupabase, jobId, ["management"]);
    expect(mgmtClose.error).toBeNull();
    expect(mgmtClose.data?.status).toBe("closed");
    expect(mgmtClose.data?.closed_at).toBeTruthy();

    // Check audit_log has both the reopen and manual close updates
    const auditLogs = await as<{ new_row: { status: string; closed_at: string | null } }>(
      MGMT_USER,
      `select new_row from audit_log
       where table_name = 'jobs' and record_id = $1 and action = 'update'
       order by id desc limit 2`,
      [jobId],
    );
    expect(auditLogs.rows).toHaveLength(2);
    expect(auditLogs.rows[0]?.new_row.status).toBe("closed");
    expect(auditLogs.rows[1]?.new_row.status).toBe("invoiced");
    expect(auditLogs.rows[1]?.new_row.closed_at).toBeNull();
  });
});
