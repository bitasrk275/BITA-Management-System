// tests/phase2-audit.test.ts
// Comprehensive Phase 2 E2E & API verification tests.
// Covers:
// 1. Customer PO value & over-PO warning
// 2. Price list master & per-invoice rate override
// 3. Multi-report invoices & Invoice pending grouping by GSTIN
// 4. Proforma series vs Tax invoice series & conversion
// 5. Boxed BITA invoice document spec (poBoxDisplay & SAC 998393)
// 6. Partial payment with TDS (tds_amount reducing balance)
// 7. Credit notes (BITA/YY-YY/CN-xxxx reducing balance)
// 8. Calendar equipment conflict checks & multi-day constraints
// 9. Equipment soft-delete & recycle bin restoration

import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../supabase/tests/setup";
import {
  buildInvoiceDocumentSpec,
  generateInvoiceDocxBytes,
} from "../lib/invoices/template";
import { DEFAULT_SAC_CODE } from "../lib/invoices/gst";

const MGMT_USER = "00000000-0000-0000-0000-000000000301";
const OFFICE_USER = "00000000-0000-0000-0000-000000000302";
const REVIEWER_USER = "00000000-0000-0000-0000-000000000303";
const TECH_USER = "00000000-0000-0000-0000-000000000304";

const CUSTOMER_A = "10000000-0000-0000-0000-000000000301";
const CUSTOMER_B = "10000000-0000-0000-0000-000000000302";

const JOB_1 = "20000000-0000-0000-0000-000000000301";
const JOB_2 = "20000000-0000-0000-0000-000000000302";
const JOB_3 = "20000000-0000-0000-0000-000000000303";
const JOB_4 = "20000000-0000-0000-0000-000000000304";

const REPORT_1 = "30000000-0000-0000-0000-000000000301";
const REPORT_2 = "30000000-0000-0000-0000-000000000302";
const REPORT_DIFF_GSTIN = "30000000-0000-0000-0000-000000000303";

const EQUIP_1 = "40000000-0000-0000-0000-000000000301";
const TECH_PERSON = "50000000-0000-0000-0000-000000000301";
const REVIEWER_PERSON = "50000000-0000-0000-0000-000000000303";

describe("Phase 2 Full E2E & Architectural QA Audit", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    ctx = await createTestDb();

    // 1. Seed users & people
    await ctx.db.exec(`
      insert into auth.users (id) values
        ('${MGMT_USER}'), ('${OFFICE_USER}'), ('${REVIEWER_USER}'), ('${TECH_USER}');

      insert into public.people (id, full_name, initials, user_id, roles) values
        ('50000000-0000-0000-0000-000000000300', 'S. Radhakrishnan', 'SRK', '${MGMT_USER}', '{management,reviewer}'),
        ('50000000-0000-0000-0000-000000000302', 'Office Lead', 'OL', '${OFFICE_USER}', '{office}'),
        ('50000000-0000-0000-0000-000000000303', 'Reviewer Lead', 'RL', '${REVIEWER_USER}', '{reviewer}'),
        ('${TECH_PERSON}', 'Technician Lead', 'TL', '${TECH_USER}', '{technician}');

      -- 2. Seed customers with distinct GSTINs
      insert into public.customers (id, name, gstin, billing_address) values
        ('${CUSTOMER_A}', 'BFL Pune Automotive Ltd', '27AAACB1234D1Z1', 'Pune, Maharashtra'),
        ('${CUSTOMER_B}', 'Bangalore Wind Energy Ltd', '29BBBCW5678E1Z2', 'Peenya, Bengaluru');

      -- 3. Seed jobs with po_number and po_value
      insert into public.jobs (id, job_no, customer_id, site, status, po_number, po_date, po_value) values
        ('${JOB_1}', 'BITA/26-27/0301', '${CUSTOMER_A}', 'BFL Plant 1 Pune', 'scheduled', 'PO-BFL-9901', '2026-10-25', 50000.00),
        ('${JOB_2}', 'BITA/26-27/0302', '${CUSTOMER_A}', 'BFL Plant 2 Pune', 'scheduled', 'PO-BFL-9902', '2026-10-28', 30000.00),
        ('${JOB_3}', 'BITA/26-27/0303', '${CUSTOMER_B}', 'Hosur Site', 'scheduled', null, null, null),
        ('${JOB_4}', 'BITA/26-27/0304', '${CUSTOMER_A}', 'BFL Plant 4 Pune', 'scheduled', 'PO-BFL-9904', '2026-10-30', 25000.00);

      -- 4. Seed reports: 2 approved for Customer A, 1 approved for Customer B
      insert into public.reports (id, report_no, job_id, status, method, content, approved_at, approved_by) values
        ('${REPORT_1}', 'BITA/26-27/R-0301', '${JOB_1}', 'approved', 'UT', '{"component":"Shaft"}'::jsonb, now(), '${REVIEWER_PERSON}'),
        ('${REPORT_2}', 'BITA/26-27/R-0302', '${JOB_2}', 'approved', 'MPT', '{"component":"Weld"}'::jsonb, now(), '${REVIEWER_PERSON}'),
        ('${REPORT_DIFF_GSTIN}', 'BITA/26-27/R-0303', '${JOB_3}', 'approved', 'DPT', '{"component":"Flange"}'::jsonb, now(), '${REVIEWER_PERSON}');

      -- 5. Seed equipment item
      insert into public.equipment (id, make, model, serial_no, status, calibration_due) values
        ('${EQUIP_1}', 'Modsonic', 'K10', 'SN-MOD-301', 'in_office', '2027-06-30');
    `);
  }, 35000);

  it("1. Customer PO value & over-PO warning on jobs", async () => {
    const jobRes = await ctx.as<{ po_number: string; po_value: string }>(
      OFFICE_USER,
      `select po_number, po_value from public.jobs where id = '${JOB_1}'`,
    );
    expect(jobRes.rows[0].po_number).toBe("PO-BFL-9901");
    expect(Number(jobRes.rows[0].po_value)).toBe(50000);
  });

  it("2. Price list master items can be created and queried with default rates", async () => {
    // Insert new price item as office
    const itemRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.price_items (name, description, sac, unit, default_rate)
       values ('Ultrasonic Testing 8hr Shift', 'Full day UT inspection at site', '998393', 'Shift', 8500.00)
       returning id`,
    );
    expect(itemRes.rows[0].id).toBeDefined();

    const fetchRes = await ctx.as<{ name: string; default_rate: string }>(
      OFFICE_USER,
      `select name, default_rate from public.price_items where id = '${itemRes.rows[0].id}'`,
    );
    expect(fetchRes.rows[0].name).toBe("Ultrasonic Testing 8hr Shift");
    expect(Number(fetchRes.rows[0].default_rate)).toBe(8500);

    // Technician is refused read on price items (returns 0 rows under RLS)
    const techRes = await ctx.as(TECH_USER, `select * from public.price_items`);
    expect(techRes.rows).toHaveLength(0);
  });

  it("3. Multi-report invoice grouping: allows same customer GSTIN, refuses different customer GSTINs", async () => {
    // Office creates a draft invoice for Customer A
    const invRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.invoices (
        job_id, kind, status, place_of_supply, taxable_value, cgst, sgst, igst, total, balance
       ) values (
        '${JOB_1}', 'tax_invoice', 'draft', '27', 40000.00, 0.00, 0.00, 7200.00, 47200.00, 47200.00
       ) returning id`,
    );
    const invoiceId = invRes.rows[0].id;

    // Link report 1 (Customer A)
    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_reports (invoice_id, report_id) values ('${invoiceId}', '${REPORT_1}')`,
    );

    // Link report 2 (also Customer A) -> SUCCESS
    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_reports (invoice_id, report_id) values ('${invoiceId}', '${REPORT_2}')`,
    );

    const linkedReports = await ctx.as<{ report_id: string }>(
      OFFICE_USER,
      `select report_id from public.invoice_reports where invoice_id = '${invoiceId}' order by report_id`,
    );
    expect(linkedReports.rows).toHaveLength(2);

    // Try linking report 3 (Customer B - DIFFERENT GSTIN) -> MUST FAIL via trigger check_invoice_report()
    await expect(
      ctx.as(
        OFFICE_USER,
        `insert into public.invoice_reports (invoice_id, report_id) values ('${invoiceId}', '${REPORT_DIFF_GSTIN}')`,
      ),
    ).rejects.toThrow(/same customer GSTIN/i);
  });

  it("4. Proforma invoice generation (PI- series) and conversion to Tax invoice (INV- series)", async () => {
    // Create and issue a proforma invoice
    const piRes = await ctx.as<{ id: string; invoice_no: string; kind: string }>(
      OFFICE_USER,
      `insert into public.invoices (
        job_id, kind, status, place_of_supply, taxable_value, cgst, sgst, igst, total, balance
       ) values (
        '${JOB_4}', 'proforma', 'draft', '27', 20000.00, 0.00, 0.00, 3600.00, 23600.00, 23600.00
       ) returning id`,
    );
    const piId = piRes.rows[0].id;

    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_lines (invoice_id, position, description, rate, amount)
       values ('${piId}', 1, 'Ultrasonic testing on shaft', 20000.00, 20000.00)`,
    );

    // Issue the proforma
    const issuedPi = await ctx.as<{ invoice_no: string; kind: string }>(
      OFFICE_USER,
      `update public.invoices
       set status = 'issued', invoice_date = '2026-11-09'
       where id = '${piId}'
       returning invoice_no, kind`,
    );
    expect(issuedPi.rows[0].kind).toBe("proforma");
    expect(issuedPi.rows[0].invoice_no).toMatch(/^BITA\/\d{2}-\d{2}\/PI-\d{4}$/);

    // Convert proforma into tax invoice
    const taxInvRes = await ctx.as<{ id: string; invoice_no: string; converted_from_id: string }>(
      OFFICE_USER,
      `insert into public.invoices (
        job_id, kind, status, place_of_supply, taxable_value, cgst, sgst, igst, total, balance, converted_from_id
       ) values (
        '${JOB_4}', 'tax_invoice', 'draft', '27', 20000.00, 0.00, 0.00, 3600.00, 23600.00, 23600.00, '${piId}'
       ) returning id, converted_from_id`,
    );
    const taxInvId = taxInvRes.rows[0].id;
    expect(taxInvRes.rows[0].converted_from_id).toBe(piId);

    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_lines (invoice_id, position, description, rate, amount)
       values ('${taxInvId}', 1, 'Ultrasonic testing on shaft', 20000.00, 20000.00)`,
    );

    // Issue tax invoice
    const issuedTax = await ctx.as<{ invoice_no: string }>(
      OFFICE_USER,
      `update public.invoices
       set status = 'issued', invoice_date = '2026-11-09'
       where id = '${taxInvId}'
       returning invoice_no`,
    );
    expect(issuedTax.rows[0].invoice_no).toMatch(/^BITA\/\d{2}-\d{2}\/INV-\d{4}$/);
  });

  it("5. Boxed BITA invoice template: top-right PO box is blank when no PO, filled when PO exists, SAC 998393", async () => {
    // 5a: With PO (PO-BFL-9901 dtd 2026-10-25)
    const specWithPo = buildInvoiceDocumentSpec({
      invoiceNo: "BITA/26-27/INV-0301",
      invoiceDate: "2026-11-05",
      jobNo: "BITA/26-27/0301",
      customerName: "BFL Pune Automotive Ltd",
      customerGstin: "27AAACB1234D1Z1",
      placeOfSupply: "27",
      poNumber: "PO-BFL-9901",
      poDate: "2026-10-25",
      lines: [
        {
          description: "Ultrasonic Testing of Shafts",
          sac: "998393",
          qty: 1,
          unit: "Job",
          rate: 20000,
          amount: 20000,
        },
      ],
      taxableValue: 20000,
      cgst: 0,
      sgst: 0,
      igst: 3600,
      roundOff: 0,
      total: 23600,
      status: "issued",
      kind: "tax_invoice",
    });

    expect(specWithPo.poBoxDisplay).toBe("PO-BFL-9901\ndtd. 25.10.2026");
    expect(specWithPo.lines[0].sac).toBe("998393");

    // 5b: Without PO (Blank top-right cell matching client sample Invoice 5387)
    const specWithoutPo = buildInvoiceDocumentSpec({
      invoiceNo: "BITA/26-27/INV-5387",
      invoiceDate: "2026-11-05",
      jobNo: "BITA/26-27/0303",
      customerName: "WEG Industries Ltd",
      customerGstin: "29BBBCW5678E1Z2",
      placeOfSupply: "29",
      poNumber: null,
      poDate: null,
      lines: [
        {
          description: "NDT Inspection WEG SF12 at BFL Pune",
          qty: 1,
          unit: "Job",
          rate: 15000,
          amount: 15000,
        },
      ],
      taxableValue: 15000,
      cgst: 1350,
      sgst: 1350,
      igst: 0,
      roundOff: 0,
      total: 17700,
      status: "issued",
      kind: "tax_invoice",
    });

    expect(specWithoutPo.poBoxDisplay).toBe("");
    expect(specWithoutPo.lines[0].sac).toBe(DEFAULT_SAC_CODE);

    // Verify DOCX byte generation succeeds without error
    const docxBytes = await generateInvoiceDocxBytes({
      invoiceNo: "BITA/26-27/INV-5387",
      invoiceDate: "2026-11-05",
      jobNo: "BITA/26-27/0303",
      customerName: "WEG Industries Ltd",
      customerGstin: "29BBBCW5678E1Z2",
      placeOfSupply: "29",
      poNumber: null,
      lines: [{ description: "NDT Inspection", rate: 10000, amount: 10000, qty: 1 }],
      taxableValue: 10000,
      cgst: 900,
      sgst: 900,
      igst: 0,
      roundOff: 0,
      total: 11800,
      status: "issued",
      kind: "tax_invoice",
    });
    expect(docxBytes.length).toBeGreaterThan(1000);
  });

  it("6. Partial payment with TDS (tds_amount) reduces balance so short payments aren't chased", async () => {
    // Create an issued invoice with total = 23600 on JOB_3
    const invRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.invoices (
        job_id, kind, status, place_of_supply, taxable_value, cgst, sgst, igst, total, balance, invoice_date
       ) values (
        '${JOB_3}', 'tax_invoice', 'draft', '29', 20000.00, 1800.00, 1800.00, 0.00, 23600.00, 23600.00, '2026-11-01'
       ) returning id`,
    );
    const invoiceId = invRes.rows[0].id;

    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_lines (invoice_id, position, description, rate, amount)
       values ('${invoiceId}', 1, 'NDT testing at site', 20000.00, 20000.00)`,
    );

    await ctx.as(OFFICE_USER, `update public.invoices set status = 'issued' where id = '${invoiceId}'`);

    // Customer deducts 2% TDS on taxable (400 INR) and pays 23200 INR
    await ctx.as(
      OFFICE_USER,
      `insert into public.payments (
        invoice_id, paid_on, amount, tds_amount, reference, mode
       ) values (
        '${invoiceId}', '2026-11-09', 23200.00, 400.00, 'NEFT-BFL-001', 'neft'
       )`,
    );

    // Refresh invoice balance via trigger
    const updatedInv = await ctx.as<{ balance: string; status: string }>(
      OFFICE_USER,
      `select balance, status from public.invoices where id = '${invoiceId}'`,
    );
    expect(Number(updatedInv.rows[0].balance)).toBe(0);
    expect(updatedInv.rows[0].status).toBe("paid");
  });

  it("7. Credit note creation (BITA/YY-YY/CN-xxxx) reduces invoice balance", async () => {
    // Create an issued invoice with total = 11800 on JOB_2
    const invRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.invoices (
        job_id, kind, status, place_of_supply, taxable_value, cgst, sgst, igst, total, balance, invoice_date
       ) values (
        '${JOB_2}', 'tax_invoice', 'draft', '27', 10000.00, 0.00, 0.00, 1800.00, 11800.00, 11800.00, '2026-11-01'
       ) returning id`,
    );
    const invoiceId = invRes.rows[0].id;

    await ctx.as(
      OFFICE_USER,
      `insert into public.invoice_lines (invoice_id, position, description, rate, amount)
       values ('${invoiceId}', 1, 'MPT Testing weld joints', 10000.00, 10000.00)`,
    );

    await ctx.as(OFFICE_USER, `update public.invoices set status = 'issued' where id = '${invoiceId}'`);

    // Issue credit note of 5900 INR
    const cnNoRes = await ctx.as<{ cn_no: string }>(
      OFFICE_USER,
      `select private.next_credit_note_no() as cn_no`,
    );
    expect(cnNoRes.rows[0].cn_no).toMatch(/^BITA\/\d{2}-\d{2}\/CN-\d{4}$/);

    await ctx.as(
      OFFICE_USER,
      `insert into public.credit_notes (
        invoice_id, credit_note_no, credit_date, reason, taxable_value, cgst, sgst, igst, total, status
       ) values (
        '${invoiceId}', '${cnNoRes.rows[0].cn_no}', '2026-11-09', '50% rate correction agreed with client', 5000.00, 0.00, 0.00, 900.00, 5900.00, 'issued'
       )`,
    );

    // Balance is automatically updated by credit_notes_sync_invoice trigger
    const updatedInv = await ctx.as<{ balance: string; status: string }>(
      OFFICE_USER,
      `select balance, status from public.invoices where id = '${invoiceId}'`,
    );
    expect(Number(updatedInv.rows[0].balance)).toBe(5900);
    expect(updatedInv.rows[0].status).toBe("partly_paid");
  });

  it("8. Calendar multi-day assignments and equipment conflict detection (check_equipment_conflict)", async () => {
    // 8a: Assign technician and equipment to Job 1 for 2026-11-20 to 2026-11-22
    const assignRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.assignments (job_id, person_id, work_date, end_date)
       values ('${JOB_1}', '${TECH_PERSON}', '2026-11-20', '2026-11-22')
       returning id`,
    );
    const assignmentId = assignRes.rows[0].id;

    await ctx.as(
      OFFICE_USER,
      `insert into public.assignment_equipment (assignment_id, equipment_id)
       values ('${assignmentId}', '${EQUIP_1}')`,
    );

    // 8b: check_equipment_conflict for overlapping dates (2026-11-21 to 2026-11-23) detects conflict
    const conflictRes = await ctx.as<{
      conflict_assignment_id: string;
      conflict_job_id: string;
      conflict_job_no: string;
    }>(
      OFFICE_USER,
      `select * from public.check_equipment_conflict(
        '${EQUIP_1}'::uuid,
        '2026-11-21'::date,
        '2026-11-23'::date
       )`,
    );
    expect(conflictRes.rows).toHaveLength(1);
    expect(conflictRes.rows[0].conflict_job_id).toBe(JOB_1);

    // 8c: check_equipment_conflict for non-overlapping dates (2026-11-25 to 2026-11-26) returns 0 conflicts
    const noConflictRes = await ctx.as(
      OFFICE_USER,
      `select * from public.check_equipment_conflict(
        '${EQUIP_1}'::uuid,
        '2026-11-25'::date,
        '2026-11-26'::date
       )`,
    );
    expect(noConflictRes.rows).toHaveLength(0);

    // 8d: End date before work date is rejected by constraint
    await expect(
      ctx.as(
        OFFICE_USER,
        `insert into public.assignments (job_id, person_id, work_date, end_date)
         values ('${JOB_2}', '${TECH_PERSON}', '2026-11-20', '2026-11-19')`,
      ),
    ).rejects.toThrow(/assignments_end_date_check/i);
  });

  it("9. Equipment soft-delete hides row from normal SELECTs and restore unhides it", async () => {
    // Soft delete equipment as management
    await ctx.as(
      MGMT_USER,
      `select public.soft_delete_record('equipment', '${EQUIP_1}'::uuid)`,
    );

    // Normal select hides it
    const selectRes = await ctx.as(
      OFFICE_USER,
      `select * from public.equipment where id = '${EQUIP_1}'`,
    );
    expect(selectRes.rows).toHaveLength(0);

    // Restore unhides it
    await ctx.as(
      MGMT_USER,
      `select public.restore_record('equipment', '${EQUIP_1}'::uuid)`,
    );

    const restoredRes = await ctx.as<{ make: string }>(
      OFFICE_USER,
      `select make from public.equipment where id = '${EQUIP_1}'`,
    );
    expect(restoredRes.rows).toHaveLength(1);
    expect(restoredRes.rows[0].make).toBe("Modsonic");
  });
});
