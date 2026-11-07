import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./setup";

const MGMT_USER = "00000000-0000-0000-0000-000000000001";
const OFFICE_USER = "00000000-0000-0000-0000-000000000002";
const REVIEWER_USER = "00000000-0000-0000-0000-000000000003";
const TECH_USER_A = "00000000-0000-0000-0000-000000000004";
const TECH_USER_B = "00000000-0000-0000-0000-000000000005";

const TECH_PERSON_A = "00000000-0000-0000-0000-000000000014";
const TECH_PERSON_B = "00000000-0000-0000-0000-000000000015";

describe("Phase 2 Task A3: Calendar, Leave days, and Conflict Detection on PGlite", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.exec(`
      insert into auth.users (id) values
        ('${MGMT_USER}'), ('${OFFICE_USER}'), ('${REVIEWER_USER}'), ('${TECH_USER_A}'), ('${TECH_USER_B}');
      insert into public.people (id, full_name, initials, user_id, roles) values
        ('00000000-0000-0000-0000-000000000011', 'S. Radhakrishnan', 'SRK', '${MGMT_USER}', '{management,reviewer}'),
        ('00000000-0000-0000-0000-000000000012', 'Test Office Coord', 'TOC', '${OFFICE_USER}', '{office}'),
        ('00000000-0000-0000-0000-000000000013', 'Test Reviewer', 'TRV', '${REVIEWER_USER}', '{reviewer}'),
        ('${TECH_PERSON_A}', 'Technician A', 'TNA', '${TECH_USER_A}', '{technician}'),
        ('${TECH_PERSON_B}', 'Technician B', 'TNB', '${TECH_USER_B}', '{technician}');
    `);
  }, 30000);

  it("manages leave days and enforces RLS", async () => {
    // Office can insert a leave day
    const insertRes = await ctx.as<{ id: string; leave_date: string }>(
      OFFICE_USER,
      `insert into public.leave_days (person_id, leave_date, reason)
       values ('${TECH_PERSON_A}', '2026-11-20', 'Personal leave')
       returning id, leave_date`
    );
    expect(insertRes.rows).toHaveLength(1);
    expect(String(insertRes.rows[0]?.leave_date)).toContain("Nov 20 2026");

    // Technician A can view own leave
    const techARes = await ctx.as<{ id: string; reason: string }>(
      TECH_USER_A,
      `select id, reason from public.leave_days where person_id = '${TECH_PERSON_A}'`
    );
    expect(techARes.rows).toHaveLength(1);
    expect(techARes.rows[0]?.reason).toBe("Personal leave");

    // Technician B cannot see Technician A's leave
    const techBRes = await ctx.as<{ id: string }>(
      TECH_USER_B,
      `select id from public.leave_days where person_id = '${TECH_PERSON_A}'`
    );
    expect(techBRes.rows).toHaveLength(0);

    // Technician A cannot insert leave directly (only office/management)
    await expect(
      ctx.as(
        TECH_USER_A,
        `insert into public.leave_days (person_id, leave_date, reason)
         values ('${TECH_PERSON_A}', '2026-11-21', 'Unauthorized')`
      )
    ).rejects.toThrow(/violates row-level security policy/);
  });

  it("supports multi-day assignments with end_date check constraint", async () => {
    // Create customer and job first
    const custRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.customers (name) values ('Calendar Test Customer') returning id`
    );
    const customerId = custRes.rows[0]!.id;

    const jobRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.jobs (job_no, customer_id, test_methods, status)
       values ('BITA/26-27/CAL01', '${customerId}', '{UT}', 'awaiting_approval')
       returning id`
    );
    const jobId = jobRes.rows[0]!.id;

    // Multi-day assignment with end_date >= work_date succeeds
    const assignRes = await ctx.as<{ id: string; work_date: string; end_date: string }>(
      OFFICE_USER,
      `insert into public.assignments (job_id, person_id, work_date, end_date)
       values ('${jobId}', '${TECH_PERSON_A}', '2026-11-15', '2026-11-18')
       returning id, work_date, end_date`
    );
    expect(assignRes.rows).toHaveLength(1);
    expect(String(assignRes.rows[0]?.work_date)).toContain("Nov 15 2026");
    expect(String(assignRes.rows[0]?.end_date)).toContain("Nov 18 2026");

    // Invalid end_date (before work_date) is rejected by constraint
    await expect(
      ctx.as(
        OFFICE_USER,
        `insert into public.assignments (job_id, person_id, work_date, end_date)
         values ('${jobId}', '${TECH_PERSON_A}', '2026-11-18', '2026-11-15')`
      )
    ).rejects.toThrow(/assignments_end_date_check/);
  });

  it("checks equipment conflicts via check_equipment_conflict SQL function", async () => {
    // Create equipment
    const eqRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.equipment (make, model, serial_no, status)
       values ('Olympus', 'OmniScan', 'CAL-EQ-001', 'in_office')
       returning id`
    );
    const eqId = eqRes.rows[0]!.id;

    // Attach to the assignment created in previous test (2026-11-15 to 2026-11-18 on CAL01)
    const assignRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `select id from public.assignments order by created_at desc limit 1`
    );
    const assignId = assignRes.rows[0]!.id;

    await ctx.as(
      OFFICE_USER,
      `insert into public.assignment_equipment (assignment_id, equipment_id)
       values ('${assignId}', '${eqId}')`
    );

    // Conflict check for overlapping dates (2026-11-17 to 2026-11-19) returns conflict
    const conflictRes = await ctx.as<{ conflict_job_no: string }>(
      OFFICE_USER,
      `select * from public.check_equipment_conflict('${eqId}', '2026-11-17', '2026-11-19')`
    );
    expect(conflictRes.rows).toHaveLength(1);
    expect(conflictRes.rows[0]?.conflict_job_no).toBe("BITA/26-27/CAL01");

    // Non-overlapping dates (2026-11-20 to 2026-11-22) returns no conflict
    const noConflictRes = await ctx.as<{ conflict_job_no: string }>(
      OFFICE_USER,
      `select * from public.check_equipment_conflict('${eqId}', '2026-11-20', '2026-11-22')`
    );
    expect(noConflictRes.rows).toHaveLength(0);

    // Overlapping dates but excluding the same assignment returns no conflict (moving case)
    const movingRes = await ctx.as<{ conflict_job_no: string }>(
      OFFICE_USER,
      `select * from public.check_equipment_conflict('${eqId}', '2026-11-16', '2026-11-18', '${assignId}')`
    );
    expect(movingRes.rows).toHaveLength(0);
  });
});
