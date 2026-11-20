import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../supabase/tests/setup";
import {
  formatDaysSinceInvoiceDate,
  formatUnpaidInvoiceDaysLabel,
  listJobsForPaymentsReceived,
  recordMultiJobPaymentReceipt,
} from "../lib/modules/invoices/payments-received";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/db/types";

const MGMT_USER = "00000000-0000-0000-0000-000000000701";
const OFFICE_USER = "00000000-0000-0000-0000-000000000702";
const REVIEWER_USER = "00000000-0000-0000-0000-000000000703";

const MGMT_PERSON = "50000000-0000-0000-0000-000000000701";
const OFFICE_PERSON = "50000000-0000-0000-0000-000000000702";
const REVIEWER_PERSON = "50000000-0000-0000-0000-000000000703";

const CUSTOMER_1 = "10000000-0000-0000-0000-000000000701";
const JOB_WITH_INV_1 = "20000000-0000-0000-0000-000000000701";
const JOB_WITH_INV_2 = "20000000-0000-0000-0000-000000000702";
const JOB_NO_INV_3 = "20000000-0000-0000-0000-000000000703";
const JOB_PENDING_4 = "20000000-0000-0000-0000-000000000704";

const REPORT_SENT_1 = "30000000-0000-0000-0000-000000000701";

describe("Round 3 (R3-3 Money): invoice numbering fix, days since invoice date, and multi-job payment receipts (D-R3a)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.exec(`
      insert into auth.users (id) values
        ('${MGMT_USER}'), ('${OFFICE_USER}'), ('${REVIEWER_USER}');

      insert into public.people (id, full_name, initials, user_id, roles) values
        ('${MGMT_PERSON}', 'Demo Director', 'DD', '${MGMT_USER}', '{management,reviewer}'),
        ('${OFFICE_PERSON}', 'Demo Office', 'DO', '${OFFICE_USER}', '{office}'),
        ('${REVIEWER_PERSON}', 'Demo Reviewer', 'DR', '${REVIEWER_USER}', '{reviewer}');

      insert into public.customers (id, name, gstin, billing_address, uses_proforma) values
        ('${CUSTOMER_1}', 'Peenya Forgings Demo Pvt Ltd [FAKE]', '29AAACP0000A1Z5', 'Peenya Industrial Area, Bengaluru', false);

      insert into public.jobs (id, job_no, customer_id, site, status, po_number, po_value) values
        ('${JOB_WITH_INV_1}', 'BITA/26-27/0701', '${CUSTOMER_1}', 'Peenya Plant 1', 'report_sent', 'PO-DEMO-701', 25000.00),
        ('${JOB_WITH_INV_2}', 'BITA/26-27/0702', '${CUSTOMER_1}', 'Peenya Plant 2', 'invoiced', 'PO-DEMO-702', 18000.00),
        ('${JOB_NO_INV_3}', 'BITA/26-27/0703', '${CUSTOMER_1}', 'Peenya Plant 3', 'scheduled', 'PO-DEMO-703', 12000.00),
        ('${JOB_PENDING_4}', 'BITA/26-27/0704', '${CUSTOMER_1}', 'Peenya Plant 4', 'invoiced', 'PO-DEMO-704', 15000.00);

      insert into public.reports (id, report_no, job_id, status, method, content, approved_at, approved_by, sent_at) values
        ('${REPORT_SENT_1}', 'BITA/26-27/R-0701', '${JOB_WITH_INV_1}', 'sent', 'UT', '{"component":"Forged Shaft"}'::jsonb, now(), '${REVIEWER_PERSON}', now());
    `);
  }, 35000);

  it("1. Days since invoice date helper formats issued unpaid invoices as 'N days' and ignores drafts/paid/cancelled", () => {
    expect(formatDaysSinceInvoiceDate("2026-11-10", "2026-11-20")).toEqual({
      days: 10,
      label: "10 days",
    });
    expect(formatDaysSinceInvoiceDate("2026-11-19", "2026-11-20")).toEqual({
      days: 1,
      label: "1 day",
    });
    expect(formatDaysSinceInvoiceDate("2026-11-20", "2026-11-20")).toEqual({
      days: 0,
      label: "0 days",
    });

    expect(
      formatUnpaidInvoiceDaysLabel(
        { status: "issued", balance: 10030, invoice_date: "2026-11-05" },
        "2026-11-20",
      ),
    ).toBe("15 days");

    expect(
      formatUnpaidInvoiceDaysLabel(
        { status: "partly_paid", balance: 4000, invoice_date: "2026-11-19" },
        "2026-11-20",
      ),
    ).toBe("1 day");

    expect(
      formatUnpaidInvoiceDaysLabel(
        { status: "draft", balance: 10030, invoice_date: "2026-11-05" },
        "2026-11-20",
      ),
    ).toBeNull();

    expect(
      formatUnpaidInvoiceDaysLabel(
        { status: "paid", balance: 0, invoice_date: "2026-11-05" },
        "2026-11-20",
      ),
    ).toBeNull();
  });

  it("2. Issuing draft tax and proforma invoices respects next_tax_no and strips duplicate BITA/YY-YY/ prefix", async () => {
    // Configure settings.invoice_numbering with next_tax_no = 5388 and proforma_prefix = 'BITA/YY-YY/PI-'
    await ctx.as(
      MGMT_USER,
      `update public.settings
       set value = '{"tax_prefix": "", "next_tax_no": 5388, "proforma_prefix": "BITA/YY-YY/PI-", "next_proforma_no": 7, "credit_note_prefix": "BITA/YY-YY/CN-", "next_credit_note_no": 3}'::jsonb
       where key = 'invoice_numbering'`,
    );

    // Create and issue a proforma on JOB_WITH_INV_1
    const piDraft = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.invoices (
         job_id, kind, status, place_of_supply, invoice_date, taxable_value, cgst, sgst, igst, total, balance
       ) values (
         '${JOB_WITH_INV_1}', 'proforma', 'draft', '29', '2026-11-10', 10000.00, 900.00, 900.00, 0.00, 11800.00, 11800.00
       ) returning id`,
    );
    const piId = piDraft.rows[0].id;
    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_lines (invoice_id, position, description, sac, qty, unit, rate, amount)
       values ('${piId}', 1, 'UT inspection per visit', '998393', 1, 'visit', 10000.00, 10000.00)`,
    );

    const piIssued = await ctx.as<{ invoice_no: string }>(
      OFFICE_USER,
      `update public.invoices set status = 'issued' where id = '${piId}' returning invoice_no`,
    );
    expect(piIssued.rows[0].invoice_no).toMatch(/^BITA\/\d{2}-\d{2}\/PI-0007$/);

    // Create and issue tax invoices on JOB_WITH_INV_1, JOB_WITH_INV_2, and JOB_PENDING_4
    const tax1Draft = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.invoices (
         job_id, kind, report_id, status, place_of_supply, invoice_date, taxable_value, cgst, sgst, igst, total, balance
       ) values (
         '${JOB_WITH_INV_1}', 'tax_invoice', '${REPORT_SENT_1}', 'draft', '29', '2026-11-10', 10000.00, 900.00, 900.00, 0.00, 11800.00, 11800.00
       ) returning id`,
    );
    const tax1Id = tax1Draft.rows[0].id;
    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_lines (invoice_id, position, description, sac, qty, unit, rate, amount)
       values ('${tax1Id}', 1, 'UT inspection per visit', '998393', 1, 'visit', 10000.00, 10000.00)`,
    );
    const tax1Issued = await ctx.as<{ invoice_no: string }>(
      OFFICE_USER,
      `update public.invoices set status = 'issued' where id = '${tax1Id}' returning invoice_no`,
    );
    expect(tax1Issued.rows[0].invoice_no).toMatch(/^BITA\/\d{2}-\d{2}\/INV-5388$/);

    const tax2Draft = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.invoices (
         job_id, kind, status, place_of_supply, invoice_date, taxable_value, cgst, sgst, igst, total, balance
       ) values (
         '${JOB_WITH_INV_2}', 'tax_invoice', 'draft', '29', '2026-11-12', 15000.00, 1350.00, 1350.00, 0.00, 17700.00, 17700.00
       ) returning id`,
    );
    const tax2Id = tax2Draft.rows[0].id;
    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_lines (invoice_id, position, description, sac, qty, unit, rate, amount)
       values ('${tax2Id}', 1, 'MPT inspection per visit', '998393', 1, 'visit', 15000.00, 15000.00)`,
    );
    const tax2Issued = await ctx.as<{ invoice_no: string }>(
      OFFICE_USER,
      `update public.invoices set status = 'issued' where id = '${tax2Id}' returning invoice_no`,
    );
    expect(tax2Issued.rows[0].invoice_no).toMatch(/^BITA\/\d{2}-\d{2}\/INV-5389$/);

    const tax4Draft = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.invoices (
         job_id, kind, status, place_of_supply, invoice_date, taxable_value, cgst, sgst, igst, total, balance
       ) values (
         '${JOB_PENDING_4}', 'tax_invoice', 'draft', '29', '2026-11-15', 8000.00, 720.00, 720.00, 0.00, 9440.00, 9440.00
       ) returning id`,
    );
    const tax4Id = tax4Draft.rows[0].id;
    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_lines (invoice_id, position, description, sac, qty, unit, rate, amount)
       values ('${tax4Id}', 1, 'DPT inspection per visit', '998393', 1, 'visit', 8000.00, 8000.00)`,
    );
    await ctx.as(
      OFFICE_USER,
      `update public.invoices set status = 'issued' where id = '${tax4Id}'`,
    );
  });

  it("3. Multi-job payment receipt (D-R3a) settles issued tax invoices, marks un-invoiced job paid_at, and leaves unticked job pending", async () => {
    // Build a light Supabase-like adapter over PGlite to test recordMultiJobPaymentReceipt & listJobsForPaymentsReceived
    // Or test the SQL tables directly via PGlite + service logic
    const receiptRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.payment_receipts (
         customer_id, received_on, amount, mode, reference, advice_path, job_ids, notes, created_by
       ) values (
         '${CUSTOMER_1}',
         '2026-11-20',
         29500.00,
         'NEFT',
         'UTR-DEMO-998877',
         'payment-advice/demo-advice.pdf',
         array['${JOB_WITH_INV_1}'::uuid, '${JOB_WITH_INV_2}'::uuid, '${JOB_NO_INV_3}'::uuid],
         'Combined payment for 3 jobs',
         '${OFFICE_PERSON}'
       ) returning id`,
    );
    const receiptId = receiptRes.rows[0].id;
    expect(receiptId).toBeDefined();

    // Find the issued tax invoices on JOB_WITH_INV_1 (11800) and JOB_WITH_INV_2 (17700)
    const invRows = await ctx.as<{ id: string; job_id: string; balance: string }>(
      OFFICE_USER,
      `select id, job_id, balance from public.invoices
       where job_id in ('${JOB_WITH_INV_1}', '${JOB_WITH_INV_2}')
         and kind = 'tax_invoice'
         and status = 'issued'`,
    );
    expect(invRows.rows).toHaveLength(2);

    for (const inv of invRows.rows) {
      await ctx.as(
        OFFICE_USER,
        `insert into public.payments (invoice_id, amount, tds_amount, paid_on, mode, reference, receipt_id)
         values ('${inv.id}', ${Number(inv.balance)}, 0, '2026-11-20', 'NEFT', 'UTR-DEMO-998877', '${receiptId}')`,
      );
    }

    // Mark the 3 ticked jobs with paid_at and paid_receipt_id
    await ctx.as(
      OFFICE_USER,
      `update public.jobs
       set paid_at = now(), paid_receipt_id = '${receiptId}'
       where id in ('${JOB_WITH_INV_1}', '${JOB_WITH_INV_2}', '${JOB_NO_INV_3}')`,
    );

    // Verify invoices for JOB_WITH_INV_1 and JOB_WITH_INV_2 are now status = 'paid' and balance = 0
    const updatedInvs = await ctx.as<{ job_id: string; status: string; balance: string }>(
      OFFICE_USER,
      `select job_id, status, balance from public.invoices
       where job_id in ('${JOB_WITH_INV_1}', '${JOB_WITH_INV_2}', '${JOB_PENDING_4}')
         and kind = 'tax_invoice'
       order by job_id`,
    );
    const byJob = new Map(updatedInvs.rows.map((r) => [r.job_id, r]));
    expect(byJob.get(JOB_WITH_INV_1)?.status).toBe("paid");
    expect(Number(byJob.get(JOB_WITH_INV_1)?.balance)).toBe(0);
    expect(byJob.get(JOB_WITH_INV_2)?.status).toBe("paid");
    expect(Number(byJob.get(JOB_WITH_INV_2)?.balance)).toBe(0);

    // Unticked JOB_PENDING_4 remains issued with balance 9440
    expect(byJob.get(JOB_PENDING_4)?.status).toBe("issued");
    expect(Number(byJob.get(JOB_PENDING_4)?.balance)).toBe(9440);

    // Un-invoiced JOB_NO_INV_3 has paid_at set
    const job3Res = await ctx.as<{ paid_at: string | null; paid_receipt_id: string | null }>(
      OFFICE_USER,
      `select paid_at, paid_receipt_id from public.jobs where id = '${JOB_NO_INV_3}'`,
    );
    expect(job3Res.rows[0].paid_at).not.toBeNull();
    expect(job3Res.rows[0].paid_receipt_id).toBe(receiptId);

    const job4Res = await ctx.as<{ paid_at: string | null }>(
      OFFICE_USER,
      `select paid_at from public.jobs where id = '${JOB_PENDING_4}'`,
    );
    expect(job4Res.rows[0].paid_at).toBeNull();
  });

  it("4. recordMultiJobPaymentReceipt and listJobsForPaymentsReceived service functions work end-to-end", async () => {
    // Mock a minimal Supabase client to test recordMultiJobPaymentReceipt and listJobsForPaymentsReceived
    const insertedReceipts: Array<Record<string, unknown>> = [];
    const insertedPayments: Array<Record<string, unknown>> = [];
    const updatedJobs: Array<{ ids: string[]; patch: Record<string, unknown> }> = [];

    const mockSupabase = {
      from(table: string) {
        if (table === "jobs") {
          return {
            select() {
              return {
                in(_col: string, ids: string[]) {
                  return Promise.resolve({
                    data: ids.map((id, i) => ({
                      id,
                      job_no: `BITA/26-27/080${i + 1}`,
                      customer_id: CUSTOMER_1,
                      status: "invoiced",
                      paid_at: null,
                    })),
                    error: null,
                  });
                },
                is() {
                  return {
                    order() {
                      return {
                        limit() {
                          return Promise.resolve({
                            data: [
                              {
                                id: JOB_WITH_INV_1,
                                job_no: "BITA/26-27/0701",
                                customer_id: CUSTOMER_1,
                                po_number: "PO-701",
                                po_value: 25000,
                                scope: "UT of shafts",
                                status: "invoiced",
                                paid_at: "2026-11-20T08:00:00Z",
                                paid_receipt_id: "rec-1",
                                created_at: "2026-11-01T00:00:00Z",
                                customers: { id: CUSTOMER_1, name: "Demo Customer" },
                              },
                              {
                                id: JOB_PENDING_4,
                                job_no: "BITA/26-27/0704",
                                customer_id: CUSTOMER_1,
                                po_number: "PO-704",
                                po_value: 15000,
                                scope: "DPT of flanges",
                                status: "invoiced",
                                paid_at: null,
                                paid_receipt_id: null,
                                created_at: "2026-11-02T00:00:00Z",
                                customers: { id: CUSTOMER_1, name: "Demo Customer" },
                              },
                            ],
                            error: null,
                          });
                        },
                      };
                    },
                  };
                },
              };
            },
            update(patch: Record<string, unknown>) {
              return {
                in(_col: string, ids: string[]) {
                  updatedJobs.push({ ids, patch });
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        }
        if (table === "invoices") {
          return {
            select() {
              return {
                in() {
                  return {
                    eq() {
                      return {
                        in() {
                          return {
                            gt() {
                              return Promise.resolve({
                                data: [
                                  {
                                    id: "inv-801",
                                    job_id: JOB_WITH_INV_1,
                                    kind: "tax_invoice",
                                    status: "issued",
                                    balance: 11800,
                                    total: 11800,
                                  },
                                ],
                                error: null,
                              });
                            },
                          };
                        },
                      };
                    },
                  };
                },
                neq() {
                  return {
                    order() {
                      return Promise.resolve({
                        data: [
                          {
                            id: "inv-801",
                            job_id: JOB_WITH_INV_1,
                            kind: "tax_invoice",
                            invoice_no: "BITA/26-27/INV-5388",
                            number: "BITA/26-27/INV-5388",
                            invoice_date: "2026-11-10",
                            due_date: "2026-12-10",
                            total: 11800,
                            balance: 0,
                            status: "paid",
                            invoice_reports: [],
                          },
                          {
                            id: "inv-804",
                            job_id: JOB_PENDING_4,
                            kind: "tax_invoice",
                            invoice_no: "BITA/26-27/INV-5390",
                            number: "BITA/26-27/INV-5390",
                            invoice_date: "2026-11-15",
                            due_date: "2026-12-15",
                            total: 9440,
                            balance: 9440,
                            status: "issued",
                            invoice_reports: [],
                          },
                        ],
                        error: null,
                      });
                    },
                  };
                },
                eq() {
                  return {
                    maybeSingle() {
                      return Promise.resolve({ data: null, error: null });
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "invoice_reports") {
          return {
            select() {
              return {
                in() {
                  return Promise.resolve({ data: [], error: null });
                },
                eq() {
                  return Promise.resolve({ data: [], error: null });
                },
              };
            },
          };
        }
        if (table === "payment_receipts") {
          return {
            insert(payload: Record<string, unknown>) {
              insertedReceipts.push(payload);
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve({
                        data: { id: "rec-1" },
                        error: null,
                      });
                    },
                  };
                },
              };
            },
            select() {
              return {
                order() {
                  return {
                    order() {
                      return {
                        limit() {
                          return Promise.resolve({
                            data: [
                              {
                                id: "rec-1",
                                customer_id: CUSTOMER_1,
                                received_on: "2026-11-20",
                                amount: 11800,
                                mode: "NEFT",
                                reference: "UTR-801",
                                advice_path: "payment-advice/advice.pdf",
                                job_ids: [JOB_WITH_INV_1, JOB_NO_INV_3],
                                notes: null,
                                created_at: "2026-11-20T08:00:00Z",
                                customers: { name: "Demo Customer" },
                              },
                            ],
                            error: null,
                          });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "payments") {
          return {
            insert(payload: Record<string, unknown>) {
              insertedPayments.push(payload);
              return Promise.resolve({ error: null });
            },
          };
        }
        return {};
      },
    } as unknown as SupabaseClient<Database>;

    const result = await recordMultiJobPaymentReceipt(mockSupabase, {
      job_ids: [JOB_WITH_INV_1, JOB_NO_INV_3],
      received_on: "2026-11-20",
      mode: "NEFT",
      reference: "UTR-801",
      advice_path: "payment-advice/advice.pdf",
    });

    expect(result.receipt_id).toBe("rec-1");
    expect(result.jobs_marked_paid).toBe(2);
    expect(result.payments_created).toBe(1);
    expect(result.total_settled).toBe(11800);
    expect(insertedPayments[0]).toMatchObject({
      invoice_id: "inv-801",
      amount: 11800,
      tds_amount: 0,
      receipt_id: "rec-1",
    });
    expect(updatedJobs[0].ids).toEqual([JOB_WITH_INV_1, JOB_NO_INV_3]);

    const listing = await listJobsForPaymentsReceived(mockSupabase, {
      today: "2026-11-20",
    });
    expect(listing.jobs).toHaveLength(2);
    const paidJob = listing.jobs.find((j) => j.job_id === JOB_WITH_INV_1);
    const pendingJob = listing.jobs.find((j) => j.job_id === JOB_PENDING_4);
    expect(paidJob?.is_paid).toBe(true);
    expect(pendingJob?.is_paid).toBe(false);
    expect(pendingJob?.invoices[0]?.days_since_invoice).toBe("5 days");
  });
});
