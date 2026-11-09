import { describe, expect, it } from "vitest";
import { createTestDb } from "./setup";

const MGMT_USER = "11111111-1111-1111-1111-111111111111";
const OFFICE_USER = "22222222-2222-2222-2222-222222222222";
const REVIEWER_USER = "33333333-3333-3333-3333-333333333333";
const TECH_USER = "44444444-4444-4444-4444-444444444444";

describe("Phase 2 Tasks A4, A5, A6 (Log book, Employee salaries, Calibration report guard)", () => {
  it("syncs log_book_entries on assignment insert/update/delete, enforces job_expenses RLS, and blocks approving reports with expired equipment unless overridden", async () => {
    const { db, as } = await createTestDb();

    await db.exec(`
      insert into auth.users (id) values
        ('${MGMT_USER}'),
        ('${OFFICE_USER}'),
        ('${REVIEWER_USER}'),
        ('${TECH_USER}');
      insert into public.people (id, full_name, initials, user_id, roles, active, monthly_salary, per_job_allowance) values
        ('${MGMT_USER}', 'Fake Manager', 'FM', '${MGMT_USER}', '{management}', true, 90000, 1000),
        ('${OFFICE_USER}', 'Fake Office', 'FO', '${OFFICE_USER}', '{office}', true, 40000, 500),
        ('${REVIEWER_USER}', 'Fake Reviewer', 'FR', '${REVIEWER_USER}', '{reviewer}', true, 65000, 750),
        ('${TECH_USER}', 'Fake Tech', 'FT', '${TECH_USER}', '{technician}', true, 35000, 450);
    `);

    // Create customer & job
    const custRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into public.customers (name, code) values ('Fake Turbines Pvt Ltd', 'FTPL') returning id`
    );
    const customerId = custRes.rows[0]!.id;

    const jobRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into public.jobs (customer_id, site, scope, test_methods, status)
       values ($1, 'Peenya Unit 3', 'UT on shaft', '{UT}', 'scheduled') returning id`,
      [customerId]
    );
    const jobId = jobRes.rows[0]!.id;

    // A4: Inserting an assignment automatically creates a scheduled log_book_entries row
    const assignRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into public.assignments (job_id, person_id, work_date, end_date, notes)
       values ($1, $2, '2026-11-10', '2026-11-12', 'Initial schedule') returning id`,
      [jobId, TECH_USER]
    );
    const assignmentId = assignRes.rows[0]!.id;

    const logRes1 = await as<{ id: string; status: string; work_date: string; end_date: string }>(
      OFFICE_USER,
      `select id, status, work_date::text, end_date::text from public.log_book_entries where assignment_id = $1`,
      [assignmentId]
    );
    expect(logRes1.rows).toHaveLength(1);
    expect(logRes1.rows[0]!.status).toBe("scheduled");
    expect(logRes1.rows[0]!.work_date).toBe("2026-11-10");
    expect(logRes1.rows[0]!.end_date).toBe("2026-11-12");

    const logBookId = logRes1.rows[0]!.id;

    // Moving/completing the assignment updates the log_book_entries row
    await as(
      OFFICE_USER,
      `update public.assignments set work_date = '2026-11-11', end_date = '2026-11-13', completed_at = now() where id = $1`,
      [assignmentId]
    );

    const logRes2 = await as<{ status: string; work_date: string; end_date: string }>(
      OFFICE_USER,
      `select status, work_date::text, end_date::text from public.log_book_entries where id = $1`,
      [logBookId]
    );
    expect(logRes2.rows[0]!.status).toBe("completed");
    expect(logRes2.rows[0]!.work_date).toBe("2026-11-11");
    expect(logRes2.rows[0]!.end_date).toBe("2026-11-13");

    // Adding job_expenses: office can insert/read, technician cannot see office expenses
    await as(
      OFFICE_USER,
      `insert into public.job_expenses (job_id, log_book_id, person_id, expense_date, kind, amount, note)
       values ($1, $2, $3, '2026-11-11', 'travel', 480.00, 'Cab to Peenya')`,
      [jobId, logBookId, TECH_USER]
    );

    const techExpenses = await as(
      TECH_USER,
      `select * from public.job_expenses where job_id = $1`,
      [jobId]
    );
    expect(techExpenses.rows).toHaveLength(0);

    // Deleting an assignment marks the log_book_entries row as cancelled (and keeps the row)
    const tempAssign = await as<{ id: string }>(
      OFFICE_USER,
      `insert into public.assignments (job_id, person_id, work_date)
       values ($1, $2, '2026-11-20') returning id`,
      [jobId, TECH_USER]
    );
    const tempLog = await as<{ id: string }>(
      OFFICE_USER,
      `select id from public.log_book_entries where assignment_id = $1`,
      [tempAssign.rows[0]!.id]
    );
    await as(OFFICE_USER, `delete from public.assignments where id = $1`, [tempAssign.rows[0]!.id]);

    const cancelledLog = await as<{ status: string; assignment_id: string | null }>(
      OFFICE_USER,
      `select status, assignment_id from public.log_book_entries where id = $1`,
      [tempLog.rows[0]!.id]
    );
    expect(cancelledLog.rows[0]!.status).toBe("cancelled");
    expect(cancelledLog.rows[0]!.assignment_id).toBeNull();

    // A6: Book an equipment item whose calibration_due is BEFORE the assignment work_date (2026-11-11)
    const eqRes = await as<{ id: string }>(
      MGMT_USER,
      `insert into public.equipment (kind, make, model, serial_no, calibrated_on, calibration_due, status)
       values ('ut_flaw_detector', 'Olympus', 'EPOCH 650', 'EXP-UT-01', '2025-10-01', '2026-10-01', 'at_site')
       returning id`
    );
    const expiredEqId = eqRes.rows[0]!.id;

    await as(
      OFFICE_USER,
      `insert into public.assignment_equipment (assignment_id, equipment_id) values ($1, $2)`,
      [assignmentId, expiredEqId]
    );

    // Create a complete submitted inspection & draft report
    const inspRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into public.inspections (job_id, assignment_id, method, readings, submitted_by, submitted_at, missing_fields)
       values ($1, $2, 'UT', '{"client":"Fake Turbines Pvt Ltd"}'::jsonb, $3, now(), '{}')
       returning id`,
      [jobId, assignmentId, TECH_USER]
    );
    const reportRes = await as<{ id: string }>(
      OFFICE_USER,
      `insert into public.reports (job_id, inspection_id, method, report_no, status)
       values ($1, $2, 'UT', 'BITA/UT/2026/991', 'in_review')
       returning id`,
      [jobId, inspRes.rows[0]!.id]
    );
    const reportId = reportRes.rows[0]!.id;

    // Approving without calibration_override_note MUST be blocked by check_report()
    await expect(
      as(
        REVIEWER_USER,
        `update public.reports
         set status = 'approved', approved_by = $1, approved_at = now()
         where id = $2`,
        [REVIEWER_USER, reportId]
      )
    ).rejects.toThrow(/expired calibration/i);

    // Approving WITH calibration_override_note succeeds and sets calibration_override_by
    const approvedRes = await as<{
      status: string;
      calibration_override_note: string;
      calibration_override_by: string;
    }>(
      REVIEWER_USER,
      `update public.reports
       set status = 'approved',
           approved_by = $1,
           approved_at = now(),
           calibration_override_note = 'Verified against IIW V1 reference block prior to test'
       where id = $2
       returning status, calibration_override_note, calibration_override_by`,
      [REVIEWER_USER, reportId]
    );
    expect(approvedRes.rows[0]!.status).toBe("approved");
    expect(approvedRes.rows[0]!.calibration_override_by).toBe(REVIEWER_USER);
  });
});
