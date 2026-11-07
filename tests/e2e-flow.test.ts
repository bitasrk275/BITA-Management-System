// End-to-end PGlite flow test (T40):
// Exercises one complete fake job from customer enquiry -> uploaded quotation -> management approval ->
// job -> technician assignment -> device pairing -> field inspection -> report preparation ->
// technical reviewer approval -> in-app GST invoice -> partial & full payments -> job closure,
// asserting status transitions and role-based access/trigger refusals at each step.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite, Results } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { isJobReadyToClose } from "../app/(office)/jobs/closure";
import {
  buildInvoiceLines,
  calculateInvoiceGst,
  sumTaxableValue,
} from "../lib/invoices";
import type { Enums } from "../lib/db/types";
import { createTestDb } from "../supabase/tests/setup";

const OFFICE_USER = "00000000-0000-0000-0000-00000000010a";
const REVIEWER_USER = "00000000-0000-0000-0000-00000000010b";
const TECH_USER = "00000000-0000-0000-0000-00000000010c";
const OUTSIDER_USER = "00000000-0000-0000-0000-00000000010d";

const OFFICE_PERSON = "10000000-0000-0000-0000-00000000010a";
const REVIEWER_PERSON = "10000000-0000-0000-0000-00000000010b";
const TECH_PERSON = "10000000-0000-0000-0000-00000000010c";

let db: PGlite;
let as: <T>(
  userId: string | "service",
  sql: string,
  params?: unknown[],
) => Promise<Results<T>>;

beforeAll(async () => {
  ({ db, as } = await createTestDb());
  await db.exec(`
    insert into auth.users (id) values
      ('${OFFICE_USER}'),
      ('${REVIEWER_USER}'),
      ('${TECH_USER}'),
      ('${OUTSIDER_USER}');
    insert into people (id, full_name, initials, user_id, roles) values
      ('${OFFICE_PERSON}', 'Anitha Coordinator', 'ACO', '${OFFICE_USER}', '{office}'),
      ('${REVIEWER_PERSON}', 'Dr. Prakash Reviewer', 'DPR', '${REVIEWER_USER}', '{management,reviewer}'),
      ('${TECH_PERSON}', 'Suresh Field Tech', 'SFT', '${TECH_USER}', '{technician}');
  `);
}, 60_000);

describe("End-to-end BITA job lifecycle on PGlite (T40)", () => {
  it("runs a fake job from enquiry through quotation, field pairing, inspection, report approval, in-app invoice, payments, and job closure while enforcing role guards", async () => {
    // -------------------------------------------------------------------------
    // 1. Customer & Enquiry (Office role)
    // -------------------------------------------------------------------------
    await expect(
      as(OUTSIDER_USER, `insert into customers (name) values ('Unauthorized Co')`),
    ).rejects.toThrow();

    const custRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into customers (name, code, gstin, billing_address, payment_terms_days, mailbox)
       values ('Peenya Precision Forgings Pvt Ltd', 'PPF', '29AABCP1234F1Z5', 'Plot 18, Peenya 2nd Stage, Bangalore 560058', 30, 'primary')
       returning id`,
    );
    const customerId = custRes.rows[0].id;

    await as(
      OFFICE_USER,
      `insert into customer_contacts (customer_id, name, email, receives_reports, receives_invoices)
       values ($1, 'Accounts Payable', 'accounts@peenya-forgings.example.test', true, true)`,
      [customerId],
    );

    const enqNew = await as<{ id: string; status: string }>(
      OFFICE_USER,
      `insert into enquiries (source, mailbox, from_name, from_address, subject, body, status)
       values ('email', 'primary', 'Accounts Payable', 'accounts@peenya-forgings.example.test',
               'UT of 2 forged exciter rotor shafts', 'Please send quote and depute UT team.', 'new')
       returning id, status`,
    );
    const enquiryId = enqNew.rows[0].id;
    expect(enqNew.rows[0].status).toBe("new");

    const enqLinked = await as<{ status: string }>(
      OFFICE_USER,
      `update enquiries set customer_id = $1, status = 'linked' where id = $2 returning status`,
      [customerId, enquiryId],
    );
    expect(enqLinked.rows[0].status).toBe("linked");

    // -------------------------------------------------------------------------
    // 2. Uploaded Quotation + Items -> Approved (Management) -> Accepted
    // -------------------------------------------------------------------------
    const quoteDraft = await as<{ id: string; status: string }>(
      OFFICE_USER,
      `insert into quotations (ref_no, customer_id, enquiry_id, subject, pdf_path, status)
       values ('BITA/QTN/26-27/0101', $1, $2, 'Ultrasonic Testing of Forged Exciter Rotor Shafts',
               'quotations/q-101/quote.pdf', 'draft')
       returning id, status`,
      [customerId, enquiryId],
    );
    const quotationId = quoteDraft.rows[0].id;
    expect(quoteDraft.rows[0].status).toBe("draft");

    // Upload the quotation file into private documents bucket
    await as(
      OFFICE_USER,
      `insert into storage.objects (bucket_id, name) values ('documents', 'quotations/q-101/quote.pdf')`,
    );

    await as(
      OFFICE_USER,
      `insert into quotation_items (quotation_id, position, description, basis, rate, minimum_charge)
       values ($1, 1, 'Ultrasonic testing of forged exciter rotor shafts', 'per shaft', 3200.00, 6500.00)`,
      [quotationId],
    );

    // Wrong role refused: Office cannot approve a quotation or spoof management's person_id
    await expect(
      as(
        OFFICE_USER,
        `update quotations set status = 'approved', approved_at = now(), approved_by = $1 where id = $2`,
        [OFFICE_PERSON, quotationId],
      ),
    ).rejects.toThrow(/Only management can approve a quotation/);

    await expect(
      as(
        OFFICE_USER,
        `update quotations set status = 'approved', approved_at = now(), approved_by = $1 where id = $2`,
        [REVIEWER_PERSON, quotationId],
      ),
    ).rejects.toThrow(/You can approve a quotation only as yourself/);

    // Management approves the quotation as themselves, then marks it sent & accepted
    const quoteApproved = await as<{ status: string }>(
      REVIEWER_USER,
      `update quotations set status = 'approved', approved_at = now(), approved_by = $1 where id = $2 returning status`,
      [REVIEWER_PERSON, quotationId],
    );
    expect(quoteApproved.rows[0].status).toBe("approved");

    await as(OFFICE_USER, `update enquiries set status = 'quoted' where id = $1`, [enquiryId]);
    const quoteAccepted = await as<{ status: string }>(
      OFFICE_USER,
      `update quotations set status = 'accepted' where id = $1 returning status`,
      [quotationId],
    );
    expect(quoteAccepted.rows[0].status).toBe("accepted");

    // -------------------------------------------------------------------------
    // 3. Job Creation (Office role)
    // -------------------------------------------------------------------------
    const jobRes = await as<{ id: string; job_no: string; status: Enums<"job_status"> }>(
      OFFICE_USER,
      `insert into jobs (customer_id, enquiry_id, quotation_id, po_number, po_date, site, scope, test_methods)
       values ($1, $2, $3, 'PPF/PO/26-27/044', '2026-11-01', 'Peenya Shop 2',
               'UT of 2 forged exciter rotor shafts', '{UT}')
       returning id, job_no, status`,
      [customerId, enquiryId, quotationId],
    );
    const jobId = jobRes.rows[0].id;
    expect(jobRes.rows[0].job_no).toMatch(/^BITA\/\d{2}-\d{2}\/\d{4}$/);
    expect(jobRes.rows[0].status).toBe("enquiry_received");

    const enqConverted = await as<{ status: string }>(
      OFFICE_USER,
      `update enquiries set status = 'converted' where id = $1 returning status`,
      [enquiryId],
    );
    expect(enqConverted.rows[0].status).toBe("converted");

    // -------------------------------------------------------------------------
    // 4. Registers (Management) & Technician Assignment (Office role)
    // -------------------------------------------------------------------------
    // Wrong role refused: only management can modify qualification/equipment registers
    await expect(
      as(
        OFFICE_USER,
        `insert into qualifications (person_id, method, level, scheme, certificate_no, valid_until)
         values ($1, 'UT', 'Level II', 'ISNT', 'ISNT-UT-9001', current_date + 365)`,
        [TECH_PERSON],
      ),
    ).rejects.toThrow();

    await as(
      REVIEWER_USER,
      `insert into qualifications (person_id, method, level, scheme, certificate_no, valid_until)
       values ($1, 'UT', 'Level II', 'ISNT', 'ISNT-UT-9001', current_date + 365)`,
      [TECH_PERSON],
    );
    const eqRes = await as<{ id: string }>(
      REVIEWER_USER,
      `insert into equipment (kind, make, model, serial_no, calibrated_on, calibration_due)
       values ('ut_flaw_detector', 'Olympus', 'EPOCH 650', 'UT-650-E2E', current_date - 30, current_date + 335)
       returning id`,
    );

    const assignRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into assignments (job_id, person_id, work_date, notes, notified_at)
       values ($1, $2, current_date, 'Carry IIW V1/V2 blocks', now())
       returning id`,
      [jobId, TECH_PERSON],
    );
    const assignmentId = assignRes.rows[0].id;

    await as(
      OFFICE_USER,
      `insert into assignment_equipment (assignment_id, equipment_id) values ($1, $2)`,
      [assignmentId, eqRes.rows[0].id],
    );

    const jobScheduled = await as<{ status: Enums<"job_status"> }>(
      OFFICE_USER,
      `update jobs set status = 'scheduled' where id = $1 returning status`,
      [jobId],
    );
    expect(jobScheduled.rows[0].status).toBe("scheduled");

    // -------------------------------------------------------------------------
    // 5. Technician Device Pairing (Service role, as /api/field/pair does)
    // -------------------------------------------------------------------------
    // Office cannot directly insert pairing codes or device secrets
    await expect(
      as(
        OFFICE_USER,
        `insert into pairing_codes (person_id, code_hash, expires_at) values ($1, 'office-hash', now() + interval '15 minutes')`,
        [TECH_PERSON],
      ),
    ).rejects.toThrow();

    const codeRes = await as<{ id: string }>(
      "service",
      `insert into pairing_codes (person_id, code_hash, expires_at, created_by)
       values ($1, 'sha256-code-654321', now() + interval '15 minutes', $2)
       returning id`,
      [TECH_PERSON, OFFICE_PERSON],
    );
    await as("service", `update pairing_codes set used_at = now() where id = $1`, [codeRes.rows[0].id]);

    const devRes = await as<{ id: string }>(
      "service",
      `insert into technician_devices (person_id, device_name, secret_hash)
       values ($1, 'Redmi Note 13 Pro', 'sha256-device-secret-e2e')
       returning id`,
      [TECH_PERSON],
    );
    expect(devRes.rows[0].id).toBeTruthy();

    // Technician acknowledges and starts work (via service role / field API or technician session)
    await as(
      TECH_USER,
      `update assignments set acknowledged_at = now() where id = $1`,
      [assignmentId],
    );
    await as(
      "service",
      `update assignments set started_at = now() where id = $1`,
      [assignmentId],
    );

    // -------------------------------------------------------------------------
    // 6. Field Inspection Submitted
    // -------------------------------------------------------------------------
    const inspRes = await as<{ id: string }>(
      "service",
      `insert into inspections (job_id, assignment_id, method, readings, observations, submitted_by, submitted_at, missing_fields)
       values (
         $1, $2, 'UT',
         '{"equipment":"Olympus EPOCH 650","couplant":"Oil","items":[{"description":"Forged Exciter Rotor Shafts","quantity":2,"observations":"Acceptable per ASTM A388."}]}'::jsonb,
         'No recordable defects observed.',
         $3, now(), '{sensitivity}'
       )
       returning id`,
      [jobId, assignmentId, TECH_PERSON],
    );
    const inspectionId = inspRes.rows[0].id;

    // Cannot draft a report while mandatory readings are missing
    await expect(
      as(
        OFFICE_USER,
        `insert into reports (job_id, inspection_id, method, report_no, status)
         values ($1, $2, 'UT', 'BITA/UT/26-27/0501', 'draft')`,
        [jobId, inspectionId],
      ),
    ).rejects.toThrow(/Mandatory readings missing: sensitivity/);

    // Complete the missing reading and mark inspection_done
    await as(
      "service",
      `update inspections set missing_fields = '{}' where id = $1`,
      [inspectionId],
    );
    await as(
      "service",
      `update assignments set completed_at = now() where id = $1`,
      [assignmentId],
    );
    const jobInspDone = await as<{ status: Enums<"job_status"> }>(
      "service",
      `update jobs set status = 'inspection_done' where id = $1 returning status`,
      [jobId],
    );
    expect(jobInspDone.rows[0].status).toBe("inspection_done");

    // -------------------------------------------------------------------------
    // 7. Report Drafted (Office) -> Approved by Technical Reviewer -> Sent
    // -------------------------------------------------------------------------
    const repDraft = await as<{ id: string; status: Enums<"report_status"> }>(
      OFFICE_USER,
      `insert into reports (job_id, inspection_id, method, report_no, content, status, prepared_by, signatory_id)
       values ($1, $2, 'UT', 'BITA/UT/26-27/0501',
               '{"items":[{"description":"Forged Exciter Rotor Shafts","quantity":2,"observations":"No recordable indications."}]}'::jsonb,
               'in_review', $3, $4)
       returning id, status`,
      [jobId, inspectionId, OFFICE_PERSON, REVIEWER_PERSON],
    );
    const reportId = repDraft.rows[0].id;
    expect(repDraft.rows[0].status).toBe("in_review");

    const jobInReview = await as<{ status: Enums<"job_status"> }>(
      OFFICE_USER,
      `update jobs set status = 'report_in_review' where id = $1 returning status`,
      [jobId],
    );
    expect(jobInReview.rows[0].status).toBe("report_in_review");

    // Wrong role refused: Office cannot approve a report (either as themselves or spoofing reviewer)
    await expect(
      as(
        OFFICE_USER,
        `update reports set status = 'approved', approved_at = now(), approved_by = $1 where id = $2`,
        [OFFICE_PERSON, reportId],
      ),
    ).rejects.toThrow(/Only a technical reviewer can approve a report/);

    await expect(
      as(
        OFFICE_USER,
        `update reports set status = 'approved', approved_at = now(), approved_by = $1 where id = $2`,
        [REVIEWER_PERSON, reportId],
      ),
    ).rejects.toThrow(/You can approve a report only as yourself/);

    // Reviewer approves the report as themselves and attaches signed PDF
    const repApproved = await as<{ status: Enums<"report_status">; approved_at: string }>(
      REVIEWER_USER,
      `update reports
       set status = 'approved',
           reviewed_by = $1,
           approved_by = $1,
           approved_at = now(),
           pdf_path = 'reports/r-501/signed.pdf'
       where id = $2
       returning status, approved_at`,
      [REVIEWER_PERSON, reportId],
    );
    expect(repApproved.rows[0].status).toBe("approved");
    expect(repApproved.rows[0].approved_at).toBeTruthy();

    // Approved report is frozen against edits
    await expect(
      as(
        OFFICE_USER,
        `update reports set content = '{"tampered":true}'::jsonb where id = $1`,
        [reportId],
      ),
    ).rejects.toThrow(/cannot be edited/);

    // Office marks approved report as sent to customer
    const repSent = await as<{ status: Enums<"report_status">; sent_at: string }>(
      OFFICE_USER,
      `update reports
       set status = 'sent',
           sent_at = now(),
           sent_to = '{accounts@peenya-forgings.example.test}'
       where id = $1
       returning status, sent_at`,
      [reportId],
    );
    expect(repSent.rows[0].status).toBe("sent");

    const jobReportSent = await as<{ status: Enums<"job_status"> }>(
      OFFICE_USER,
      `update jobs set status = 'report_sent' where id = $1 returning status`,
      [jobId],
    );
    expect(jobReportSent.rows[0].status).toBe("report_sent");

    // -------------------------------------------------------------------------
    // 8. Draft In-App Invoice + Lines -> Issued (BITA/YY-YY/INV-xxxx)
    // -------------------------------------------------------------------------
    // Build lines from the accepted quotation + approved report (2 shafts @ 3200 = 6400 -> min charge 6500)
    const builtLines = buildInvoiceLines({
      quotationItems: [
        {
          position: 1,
          description: "Ultrasonic testing of forged exciter rotor shafts",
          basis: "per shaft",
          rate: 3200,
          minimum_charge: 6500,
        },
      ],
      reportItems: [
        { description: "Forged Exciter Rotor Shafts", quantity: 2 },
      ],
      defaultSac: "998346",
      fallbackDescription: "UT of 2 forged exciter rotor shafts",
    });
    expect(builtLines).toHaveLength(1);
    expect(builtLines[0].amount).toBe(6500);

    const gst = calculateInvoiceGst(sumTaxableValue(builtLines), {
      placeOfSupply: "29",
    });
    expect(gst.taxable_value).toBe(6500);
    expect(gst.cgst).toBe(585);
    expect(gst.sgst).toBe(585);
    expect(gst.igst).toBe(0);
    expect(gst.total).toBe(7670);

    const invDraft = await as<{ id: string; status: string; balance: string }>(
      OFFICE_USER,
      `insert into invoices (
         job_id, kind, report_id, quotation_id, place_of_supply, invoice_date,
         taxable_value, cgst, sgst, igst, round_off, total, customer_po_number
       )
       values ($1, 'tax_invoice', $2, $3, '29', '2026-11-07', $4, $5, $6, $7, $8, $9, 'PPF/PO/26-27/044')
       returning id, status, balance`,
      [
        jobId,
        reportId,
        quotationId,
        gst.taxable_value,
        gst.cgst,
        gst.sgst,
        gst.igst,
        gst.round_off,
        gst.total,
      ],
    );
    const invoiceId = invDraft.rows[0].id;
    expect(invDraft.rows[0].status).toBe("draft");
    expect(Number(invDraft.rows[0].balance)).toBe(7670);

    await as(
      OFFICE_USER,
      `insert into invoice_lines (invoice_id, position, description, sac, qty, unit, rate, amount)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        invoiceId,
        builtLines[0].position,
        builtLines[0].description,
        builtLines[0].sac,
        builtLines[0].qty,
        builtLines[0].unit,
        builtLines[0].rate,
        builtLines[0].amount,
      ],
    );

    // Wrong role refused: Technician cannot see invoices, lines, payments, quotations, or enquiries
    for (const table of ["invoices", "invoice_lines", "payments", "quotations", "enquiries"]) {
      const techRead = await as(TECH_USER, `select * from ${table}`);
      expect(techRead.rows, `technician must not see ${table}`).toHaveLength(0);
    }
    const techUpdate = await as(
      TECH_USER,
      `update invoices set status = 'issued' where id = $1 returning id`,
      [invoiceId],
    );
    expect(techUpdate.rows).toHaveLength(0);
    await expect(
      as(TECH_USER, `insert into invoices (job_id, kind) values ($1, 'tax_invoice')`, [jobId]),
    ).rejects.toThrow();

    // Cannot record a payment while invoice is still a draft
    await expect(
      as(
        OFFICE_USER,
        `insert into payments (invoice_id, amount, mode) values ($1, 3000, 'NEFT')`,
        [invoiceId],
      ),
    ).rejects.toThrow(/Payments can only be recorded against an issued invoice/);

    // Issue the invoice -> assigns BITA/YY-YY/INV-xxxx and fills due_date = 2026-11-07 + 30 days = 2026-12-07
    const invIssued = await as<{
      invoice_no: string;
      number: string;
      status: string;
      due_date: string;
      balance: string;
    }>(
      OFFICE_USER,
      `update invoices set status = 'issued' where id = $1
       returning invoice_no, number, status, due_date::text as due_date, balance`,
      [invoiceId],
    );
    expect(invIssued.rows[0].status).toBe("issued");
    expect(invIssued.rows[0].invoice_no).toMatch(/^BITA\/\d{2}-\d{2}\/INV-\d{4}$/);
    expect(invIssued.rows[0].number).toBe(invIssued.rows[0].invoice_no);
    expect(invIssued.rows[0].due_date).toBe("2026-12-07");
    expect(Number(invIssued.rows[0].balance)).toBe(7670);

    const jobInvoiced = await as<{ status: Enums<"job_status"> }>(
      OFFICE_USER,
      `update jobs set status = 'invoiced' where id = $1 returning status`,
      [jobId],
    );
    expect(jobInvoiced.rows[0].status).toBe("invoiced");

    // Job is NOT ready to close while invoice balance > 0
    expect(
      isJobReadyToClose({
        status: jobInvoiced.rows[0].status,
        reports: [{ status: "sent", sent_at: repSent.rows[0].sent_at }],
        invoices: [{ kind: "tax_invoice", balance: Number(invIssued.rows[0].balance) }],
      }),
    ).toBe(false);

    // -------------------------------------------------------------------------
    // 9. Partial Payment -> Full Payment -> Job Closable & Closed
    // -------------------------------------------------------------------------
    await as(
      OFFICE_USER,
      `insert into payments (invoice_id, amount, paid_on, mode, reference)
       values ($1, 3000.00, '2026-11-15', 'NEFT', 'UTR-E2E-PART-1')`,
      [invoiceId],
    );

    const afterPartial = await as<{ status: string; balance: string }>(
      OFFICE_USER,
      `select status, balance from invoices where id = $1`,
      [invoiceId],
    );
    expect(afterPartial.rows[0].status).toBe("partly_paid");
    expect(Number(afterPartial.rows[0].balance)).toBe(4670);

    expect(
      isJobReadyToClose({
        status: jobInvoiced.rows[0].status,
        reports: [{ status: "sent", sent_at: repSent.rows[0].sent_at }],
        invoices: [{ kind: "tax_invoice", balance: Number(afterPartial.rows[0].balance) }],
      }),
    ).toBe(false);

    // Overpayment (> 4670 remaining balance) is refused
    await expect(
      as(
        OFFICE_USER,
        `insert into payments (invoice_id, amount, mode) values ($1, 5000.00, 'NEFT')`,
        [invoiceId],
      ),
    ).rejects.toThrow(/exceeds the invoice balance/);

    // Record remaining payment (4670.00) -> invoice becomes paid with 0 balance
    await as(
      OFFICE_USER,
      `insert into payments (invoice_id, amount, paid_on, mode, reference)
       values ($1, 4670.00, '2026-11-20', 'RTGS', 'UTR-E2E-FULL-2')`,
      [invoiceId],
    );

    const afterFull = await as<{ status: string; balance: string }>(
      OFFICE_USER,
      `select status, balance from invoices where id = $1`,
      [invoiceId],
    );
    expect(afterFull.rows[0].status).toBe("paid");
    expect(Number(afterFull.rows[0].balance)).toBe(0);

    // Job is now ready to close!
    expect(
      isJobReadyToClose({
        status: jobInvoiced.rows[0].status,
        reports: [{ status: "sent", sent_at: repSent.rows[0].sent_at }],
        invoices: [{ kind: "tax_invoice", balance: Number(afterFull.rows[0].balance) }],
      }),
    ).toBe(true);

    const jobClosed = await as<{ status: Enums<"job_status">; closed_at: string }>(
      OFFICE_USER,
      `update jobs set status = 'closed', closed_at = now() where id = $1 returning status, closed_at`,
      [jobId],
    );
    expect(jobClosed.rows[0].status).toBe("closed");
    expect(jobClosed.rows[0].closed_at).toBeTruthy();
  });

  it("loads supabase/seed/demo.sql idempotently with draft, issued, partly_paid, and paid in-app invoices", async () => {
    const demoSql = readFileSync(
      join(__dirname, "..", "supabase", "seed", "demo.sql"),
      "utf8",
    );

    // Run twice to verify full idempotency despite triggers on invoices, lines, and payments
    await db.exec(demoSql);
    await db.exec(demoSql);

    const demoInvoices = await as<{
      id: string;
      status: string;
      invoice_no: string | null;
      taxable_value: string;
      total: string;
      balance: string;
      zoho_id: string | null;
    }>(
      OFFICE_USER,
      `select id, status, invoice_no, taxable_value, total, balance, zoho_id
       from invoices
       where id in (
         '7a000000-0000-0000-0000-000000000001',
         '7a000000-0000-0000-0000-000000000002',
         '7a000000-0000-0000-0000-000000000003',
         '7a000000-0000-0000-0000-000000000004',
         '7a000000-0000-0000-0000-000000000005'
       )
       order by id`,
    );

    expect(demoInvoices.rows).toHaveLength(5);
    expect(demoInvoices.rows.every((r) => r.zoho_id === null)).toBe(true);

    const byId = new Map(demoInvoices.rows.map((r) => [r.id, r]));

    // 1. Draft
    expect(byId.get("7a000000-0000-0000-0000-000000000001")?.status).toBe("draft");
    expect(Number(byId.get("7a000000-0000-0000-0000-000000000001")?.balance)).toBe(7670);

    // 2. Issued (not yet due)
    expect(byId.get("7a000000-0000-0000-0000-000000000002")?.status).toBe("issued");
    expect(Number(byId.get("7a000000-0000-0000-0000-000000000002")?.balance)).toBe(18880);

    // 3. Partly paid (14160 total - 8000 payment = 6160 balance)
    expect(byId.get("7a000000-0000-0000-0000-000000000003")?.status).toBe("partly_paid");
    expect(Number(byId.get("7a000000-0000-0000-0000-000000000003")?.balance)).toBe(6160);

    // 4. Issued (overdue)
    expect(byId.get("7a000000-0000-0000-0000-000000000004")?.status).toBe("issued");
    expect(Number(byId.get("7a000000-0000-0000-0000-000000000004")?.balance)).toBe(42480);

    // 5. Paid (23600 total - 23600 payments = 0 balance)
    expect(byId.get("7a000000-0000-0000-0000-000000000005")?.status).toBe("paid");
    expect(Number(byId.get("7a000000-0000-0000-0000-000000000005")?.balance)).toBe(0);
  });
});
