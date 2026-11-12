import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestDb } from "../../../supabase/tests/setup";
import type { Database } from "../../db/types";
import { DEFAULT_PERMISSIONS_MATRIX } from "../settings/schema";
import { hasPermissionForRoles } from "../settings/service";
import {
  classifyAgeingBucket,
  currentFinancialYear,
  customerRevenueToCsv,
  monthlyIncomeVsExpensesToCsv,
  monthlyPaymentsToCsv,
  parseFinanceMonth,
  parseFinancialYearRange,
  receivablesAgeingToCsv,
  unconvertedProformasToCsv,
} from "./schema";
import {
  computeFinanceOverview,
  type RawFinanceCreditNoteRow,
  type RawFinanceDataset,
  type RawFinanceExpenseRow,
  type RawFinanceInvoiceRow,
  type RawFinancePaymentRow,
} from "./service";

const MGMT_USER = "00000000-0000-0000-0000-000000000601";
const OFFICE_USER = "00000000-0000-0000-0000-000000000602";

const CUST_TURBINES = "10000000-0000-0000-0000-000000000601";
const CUST_FORGINGS = "10000000-0000-0000-0000-000000000602";

const JOB_A1 = "20000000-0000-0000-0000-000000000601";
const JOB_A2 = "20000000-0000-0000-0000-000000000602";
const JOB_B1 = "20000000-0000-0000-0000-000000000603";
const JOB_PF_OPEN = "20000000-0000-0000-0000-000000000604";
const JOB_PF_CONVERTED = "20000000-0000-0000-0000-000000000605";

const INV_A1 = "30000000-0000-0000-0000-000000000601";
const INV_A2 = "30000000-0000-0000-0000-000000000602";
const INV_B1 = "30000000-0000-0000-0000-000000000603";
const PF_OPEN = "30000000-0000-0000-0000-000000000604";
const PF_CONVERTED = "30000000-0000-0000-0000-000000000605";
const INV_FROM_PF = "30000000-0000-0000-0000-000000000606";

describe("G1 – Financial reports module (X4) with PGlite fixtures", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.exec(`
      insert into auth.users (id) values
        ('${MGMT_USER}'), ('${OFFICE_USER}');

      insert into public.people (id, full_name, initials, user_id, roles) values
        ('50000000-0000-0000-0000-000000000601', 'Demo Director', 'DD', '${MGMT_USER}', '{management}'),
        ('50000000-0000-0000-0000-000000000602', 'Demo Office', 'DO', '${OFFICE_USER}', '{office}');

      insert into public.customers (id, name, gstin, billing_address, payment_terms_days) values
        ('${CUST_TURBINES}', 'Test Turbines India Ltd', '29AAACT1234F1Z5', 'Peenya, Bengaluru', 30),
        ('${CUST_FORGINGS}', 'Sample Forgings Pvt Ltd', '27BBBCF5678G1Z2', 'Chakan, Pune', 30);

      insert into public.jobs (id, job_no, customer_id, site, status) values
        ('${JOB_A1}', 'BITA/26-27/0601', '${CUST_TURBINES}', 'Peenya Unit 1', 'invoiced'),
        ('${JOB_A2}', 'BITA/26-27/0602', '${CUST_TURBINES}', 'Peenya Unit 2', 'invoiced'),
        ('${JOB_B1}', 'BITA/26-27/0603', '${CUST_FORGINGS}', 'Pune Plant', 'invoiced'),
        ('${JOB_PF_OPEN}', 'BITA/26-27/0604', '${CUST_TURBINES}', 'Peenya Unit 3', 'report_sent'),
        ('${JOB_PF_CONVERTED}', 'BITA/26-27/0605', '${CUST_FORGINGS}', 'Pune Unit 2', 'invoiced');

      -- Insert draft invoices and lines, then issue them so DB triggers compute numbers and balances
      insert into public.invoices (
        id, job_id, kind, status, invoice_date, due_date, place_of_supply,
        taxable_value, cgst, sgst, igst, round_off, total, balance
      ) values
        -- INV_A1: Oct 2026, due 2026-10-25 (18 days overdue as of 2026-11-12 -> 0-30 bucket)
        ('${INV_A1}', '${JOB_A1}', 'tax_invoice', 'draft', '2026-10-01', '2026-10-25', '29-Karnataka',
         100000.00, 9000.00, 9000.00, 0.00, 0.00, 118000.00, 118000.00),
        -- INV_A2: Nov 2026, due 2026-11-25 (not due as of 2026-11-12 -> not_due bucket)
        ('${INV_A2}', '${JOB_A2}', 'tax_invoice', 'draft', '2026-11-05', '2026-11-25', '29-Karnataka',
         50000.00, 4500.00, 4500.00, 0.00, 0.00, 59000.00, 59000.00),
        -- INV_B1: Jul 2026, due 2026-07-31 (104 days overdue as of 2026-11-12 -> 90+ bucket)
        ('${INV_B1}', '${JOB_B1}', 'tax_invoice', 'draft', '2026-07-01', '2026-07-31', '27-Maharashtra',
         80000.00, 0.00, 0.00, 14400.00, 0.00, 94400.00, 94400.00),
        -- PF_OPEN: Unconverted proforma
        ('${PF_OPEN}', '${JOB_PF_OPEN}', 'proforma', 'draft', '2026-10-20', '2026-11-19', '29-Karnataka',
         40000.00, 3600.00, 3600.00, 0.00, 0.00, 47200.00, 47200.00),
        -- PF_CONVERTED: Converted proforma
        ('${PF_CONVERTED}', '${JOB_PF_CONVERTED}', 'proforma', 'draft', '2026-10-10', '2026-11-09', '27-Maharashtra',
         30000.00, 0.00, 0.00, 5400.00, 0.00, 35400.00, 35400.00);

      insert into public.invoice_lines (invoice_id, position, description, sac, qty, unit, rate, amount) values
        ('${INV_A1}', 1, 'UT Inspection Batch A1', '998393', 1, 'LS', 100000.00, 100000.00),
        ('${INV_A2}', 1, 'UT Inspection Batch A2', '998393', 1, 'LS', 50000.00, 50000.00),
        ('${INV_B1}', 1, 'MPI Forging Inspection', '998393', 1, 'LS', 80000.00, 80000.00),
        ('${PF_OPEN}', 1, 'Proforma UT Inspection', '998393', 1, 'LS', 40000.00, 40000.00),
        ('${PF_CONVERTED}', 1, 'Proforma Converted Inspection', '998393', 1, 'LS', 30000.00, 30000.00);

      update public.invoices set status = 'issued' where id in (
        '${INV_A1}', '${INV_A2}', '${INV_B1}', '${PF_OPEN}', '${PF_CONVERTED}'
      );

      -- Convert PF_CONVERTED to tax invoice INV_FROM_PF
      insert into public.invoices (
        id, job_id, kind, status, converted_from_id, invoice_date, due_date, place_of_supply,
        taxable_value, cgst, sgst, igst, round_off, total, balance
      ) values (
        '${INV_FROM_PF}', '${JOB_PF_CONVERTED}', 'tax_invoice', 'draft', '${PF_CONVERTED}',
        '2026-11-02', '2026-12-02', '27-Maharashtra',
        30000.00, 0.00, 0.00, 5400.00, 0.00, 35400.00, 35400.00
      );
      insert into public.invoice_lines (invoice_id, position, description, sac, qty, unit, rate, amount) values
        ('${INV_FROM_PF}', 1, 'Converted Tax Invoice', '998393', 1, 'LS', 30000.00, 30000.00);
      update public.invoices set status = 'issued' where id = '${INV_FROM_PF}';

      -- Record partial payment with TDS on INV_A1 in Nov 2026:
      -- Bank received 45,000 + TDS 5,000 = 50,000 settled
      insert into public.payments (invoice_id, amount, tds_amount, paid_on, mode, reference)
      values ('${INV_A1}', 45000.00, 5000.00, '2026-11-08', 'NEFT', 'UTR-601');

      -- Record full payment with TDS on INV_FROM_PF in Nov 2026:
      -- Bank received 32,400 + TDS 3,000 = 35,400 settled -> balance 0
      insert into public.payments (invoice_id, amount, tds_amount, paid_on, mode, reference)
      values ('${INV_FROM_PF}', 32400.00, 3000.00, '2026-11-10', 'RTGS', 'UTR-606');

      -- Issue a credit note on INV_A1 in Oct 2026:
      -- Taxable 10,000 + CGST 900 + SGST 900 = 11,800
      -- So INV_A1 remaining net balance = 118,000 - 50,000 - 11,800 = 56,200
      insert into public.credit_notes (
        invoice_id, credit_date, reason, taxable_value, cgst, sgst, igst, round_off, total, status
      ) values (
        '${INV_A1}', '2026-10-15', 'Rate revision', 10000.00, 900.00, 900.00, 0.00, 0.00, 11800.00, 'issued'
      );

      -- Insert job expenses in Oct and Nov 2026
      insert into public.job_expenses (job_id, expense_date, kind, amount, note) values
        ('${JOB_A1}', '2026-10-05', 'travel', 3500.00, 'Cab to Peenya'),
        ('${JOB_A2}', '2026-11-06', 'food', 1200.00, 'Site lunch'),
        ('${JOB_B1}', '2026-11-07', 'consumables', 2800.00, 'Couplant & cleaner');
    `);
  }, 35000);

  async function fetchDatasetFromPGlite(): Promise<RawFinanceDataset> {
    const invRows = await ctx.as<RawFinanceInvoiceRow>(
      MGMT_USER,
      `select
         i.id,
         i.job_id,
         j.job_no,
         c.id as customer_id,
         c.name as customer_name,
         c.gstin as customer_gstin,
         i.kind,
         i.status,
         coalesce(i.invoice_no, i.number) as invoice_no,
         i.invoice_date::text as invoice_date,
         i.due_date::text as due_date,
         i.customer_po_number,
         i.converted_from_id,
         i.taxable_value::float8 as taxable_value,
         i.cgst::float8 as cgst,
         i.sgst::float8 as sgst,
         i.igst::float8 as igst,
         i.total::float8 as total,
         i.balance::float8 as balance
       from public.invoices i
       join public.jobs j on j.id = i.job_id
       join public.customers c on c.id = j.customer_id
       order by i.invoice_date desc`,
    );

    const pmtRows = await ctx.as<RawFinancePaymentRow>(
      MGMT_USER,
      `select
         id,
         invoice_id,
         amount::float8 as amount,
         tds_amount::float8 as tds_amount,
         paid_on::text as paid_on,
         mode,
         reference
       from public.payments
       order by paid_on desc`,
    );

    const cnRows = await ctx.as<RawFinanceCreditNoteRow>(
      MGMT_USER,
      `select
         id,
         invoice_id,
         credit_note_no,
         credit_date::text as credit_date,
         taxable_value::float8 as taxable_value,
         cgst::float8 as cgst,
         sgst::float8 as sgst,
         igst::float8 as igst,
         total::float8 as total,
         status
       from public.credit_notes
       order by credit_date desc`,
    );

    const expRows = await ctx.as<RawFinanceExpenseRow>(
      MGMT_USER,
      `select
         id,
         job_id,
         expense_date::text as expense_date,
         kind,
         amount::float8 as amount
       from public.job_expenses
       where deleted_at is null
       order by expense_date desc`,
    );

    return {
      invoices: invRows.rows,
      payments: pmtRows.rows,
      creditNotes: cnRows.rows,
      expenses: expRows.rows,
    };
  }

  it("1. Enforces view_finance permission default to management only", async () => {
    expect(DEFAULT_PERMISSIONS_MATRIX.view_finance).toEqual(["management"]);

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    expect(
      await hasPermissionForRoles(mockSupabase, ["management"], "view_finance"),
    ).toBe(true);
    expect(
      await hasPermissionForRoles(mockSupabase, ["office"], "view_finance"),
    ).toBe(false);
    expect(
      await hasPermissionForRoles(mockSupabase, ["reviewer"], "view_finance"),
    ).toBe(false);
    expect(
      await hasPermissionForRoles(mockSupabase, ["technician"], "view_finance"),
    ).toBe(false);
  });

  it("2. Computes (a) receivables ageing net of payments, TDS, and credit notes across buckets", async () => {
    const dataset = await fetchDatasetFromPGlite();
    const overview = computeFinanceOverview(dataset, {
      fy: "2026-27",
      month: "2026-11",
      asOfDate: "2026-11-12",
    });

    const ageing = overview.ageing;
    expect(ageing.totals.customer_count).toBe(2);
    // INV_FROM_PF is fully paid (balance 0), so 3 open tax invoices remain: INV_A1, INV_A2, INV_B1
    expect(ageing.totals.invoice_count).toBe(3);

    // INV_A2: 59,000 not due
    expect(ageing.totals.not_due).toBe(59000);
    // INV_A1: 118,000 - (45,000 + 5,000 TDS) - 11,800 CN = 56,200 in 0-30 days
    expect(ageing.totals.days_0_30).toBe(56200);
    expect(ageing.totals.days_31_60).toBe(0);
    expect(ageing.totals.days_61_90).toBe(0);
    // INV_B1: 94,400 in 90+ days
    expect(ageing.totals.days_90_plus).toBe(94400);
    expect(ageing.totals.total_outstanding).toBe(209600);

    const turbines = ageing.customers.find((c) => c.customer_id === CUST_TURBINES)!;
    expect(turbines.not_due).toBe(59000);
    expect(turbines.days_0_30).toBe(56200);
    expect(turbines.total_outstanding).toBe(115200);
  });

  it("3. Computes (b) customer-wise revenue and outstanding for FY 2026-27", async () => {
    const dataset = await fetchDatasetFromPGlite();
    const overview = computeFinanceOverview(dataset, {
      fy: "2026-27",
      month: "2026-11",
      asOfDate: "2026-11-12",
    });

    const rev = overview.customer_revenue;
    expect(rev.fy).toBe("2026-27");
    expect(rev.totals.customer_count).toBe(2);
    // 4 issued tax invoices in FY 2026-27: INV_A1, INV_A2, INV_B1, INV_FROM_PF (proformas excluded)
    expect(rev.totals.invoice_count).toBe(4);
    // Taxable: 100k + 50k + 80k + 30k = 260,000
    expect(rev.totals.taxable_value).toBe(260000);
    // Gross invoiced: 118k + 59k + 94.4k + 35.4k = 306,800
    expect(rev.totals.gross_invoiced).toBe(306800);
    // Credit notes: 11,800
    expect(rev.totals.credit_notes_total).toBe(11800);
    // Net invoiced: 295,000
    expect(rev.totals.net_invoiced).toBe(295000);
    // Outstanding: 209,600
    expect(rev.totals.outstanding_balance).toBe(209600);
  });

  it("4. Computes (c) monthly income vs job expenses and (d) monthly payments with TDS", async () => {
    const dataset = await fetchDatasetFromPGlite();
    const overview = computeFinanceOverview(dataset, {
      fy: "2026-27",
      month: "2026-11",
      asOfDate: "2026-11-12",
    });

    const monthly = overview.monthly_income_vs_expenses;
    expect(monthly.months).toHaveLength(12);

    const oct = monthly.months.find((m) => m.month === "2026-10")!;
    expect(oct.invoice_count).toBe(1);
    expect(oct.taxable_value).toBe(100000);
    expect(oct.gst_total).toBe(18000);
    expect(oct.credit_notes_total).toBe(11800);
    expect(oct.expenses_total).toBe(3500);
    expect(oct.net_operating_surplus).toBe(96500);

    const nov = monthly.months.find((m) => m.month === "2026-11")!;
    expect(nov.invoice_count).toBe(2); // INV_A2 (50k) + INV_FROM_PF (30k)
    expect(nov.taxable_value).toBe(80000);
    expect(nov.expenses_total).toBe(4000); // 1200 + 2800
    expect(nov.net_operating_surplus).toBe(76000);

    const pmts = overview.monthly_payments;
    expect(pmts.month).toBe("2026-11");
    expect(pmts.totals.payment_count).toBe(2);
    expect(pmts.totals.amount_received).toBe(77400); // 45,000 + 32,400
    expect(pmts.totals.tds_total).toBe(8000); // 5,000 + 3,000
    expect(pmts.totals.total_settled).toBe(85400);
  });

  it("5. Computes (e) unconverted proformas and generates valid CSV files for all 5 tables", async () => {
    const dataset = await fetchDatasetFromPGlite();
    const overview = computeFinanceOverview(dataset, {
      fy: "2026-27",
      month: "2026-11",
      asOfDate: "2026-11-12",
    });

    // PF_CONVERTED was converted to INV_FROM_PF; only PF_OPEN remains unconverted
    const pf = overview.unconverted_proformas;
    expect(pf.totals.proforma_count).toBe(1);
    expect(pf.proformas[0]?.invoice_id).toBe(PF_OPEN);
    expect(pf.totals.total_value).toBe(47200);

    // Verify CSV exports contain headers and totals
    const ageingCsv = receivablesAgeingToCsv(overview.ageing);
    expect(ageingCsv).toContain("Customer,GSTIN,Invoices,Not Due (INR)");
    expect(ageingCsv).toContain("Test Turbines India Ltd");
    expect(ageingCsv).toContain("209600.00");

    const revCsv = customerRevenueToCsv(overview.customer_revenue);
    expect(revCsv).toContain("Financial Year,Customer,GSTIN,Invoices");
    expect(revCsv).toContain("295000.00");

    const monthlyCsv = monthlyIncomeVsExpensesToCsv(overview.monthly_income_vs_expenses);
    expect(monthlyCsv).toContain("Month,Tax Invoices Issued,Taxable Value (INR)");
    expect(monthlyCsv).toContain("Oct 2026");

    const pmtsCsv = monthlyPaymentsToCsv(overview.monthly_payments);
    expect(pmtsCsv).toContain("Paid On,Invoice No.,Job No.,Customer");
    expect(pmtsCsv).toContain("8000.00");

    const pfCsv = unconvertedProformasToCsv(overview.unconverted_proformas);
    expect(pfCsv).toContain("Proforma No.,Date,Status,Job No.");
    expect(pfCsv).toContain("47200.00");

    // Helper coverage
    expect(currentFinancialYear("2027-02-15")).toBe("2026-27");
    expect(parseFinancialYearRange("26-27").fy).toBe("2026-27");
    expect(parseFinanceMonth("2026-02").endDate).toBe("2026-02-28");
    expect(classifyAgeingBucket(0)).toBe("not_due");
    expect(classifyAgeingBucket(15)).toBe("days_0_30");
    expect(classifyAgeingBucket(45)).toBe("days_31_60");
    expect(classifyAgeingBucket(75)).toBe("days_61_90");
    expect(classifyAgeingBucket(120)).toBe("days_90_plus");
  });
});
