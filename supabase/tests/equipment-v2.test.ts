import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./setup";

const MGMT_USER = "00000000-0000-0000-0000-000000000001";
const OFFICE_USER = "00000000-0000-0000-0000-000000000002";
const REVIEWER_USER = "00000000-0000-0000-0000-000000000003";
const TECH_USER_A = "00000000-0000-0000-0000-000000000004";
const TECH_USER_B = "00000000-0000-0000-0000-000000000005";

const TECH_PERSON_A = "00000000-0000-0000-0000-000000000014";
const TECH_PERSON_B = "00000000-0000-0000-0000-000000000015";

describe("Phase 2 Task A2: Equipment register v2, types, movements, and calibration on PGlite", () => {
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

  it("seeds default equipment types and enforces RLS", async () => {
    const typesRes = await ctx.as<{ name: string }>(
      OFFICE_USER,
      `select name from public.equipment_types where deleted_at is null order by name`
    );
    const names = typesRes.rows.map((r) => r.name);
    expect(names).toContain("UT flaw detector");
    expect(names).toContain("UT probe");
    expect(names).toContain("Calibration block");
    expect(names).toContain("MT yoke");
    expect(names).toContain("Thickness gauge");
    expect(names).toContain("Hardness tester");

    // Office can insert a new equipment type
    const newTypeRes = await ctx.as<{ id: string; name: string }>(
      OFFICE_USER,
      `insert into public.equipment_types (name, description)
       values ('Eddy current instrument', 'High-frequency surface flaw detector')
       returning id, name`
    );
    expect(newTypeRes.rows[0]!.name).toBe("Eddy current instrument");
    const newTypeId = newTypeRes.rows[0]!.id;

    // Technician cannot insert equipment types
    await expect(
      ctx.as(
        TECH_USER_A,
        `insert into public.equipment_types (name) values ('Prohibited Type')`
      )
    ).rejects.toThrow(/row-level security/i);

    // Office cannot hard-delete; management soft-deletes
    await ctx.as(
      MGMT_USER,
      `select public.soft_delete_record('equipment_types', $1::uuid)`,
      [newTypeId]
    );

    // Deleted type is hidden from normal select
    const checkDeleted = await ctx.as(
      OFFICE_USER,
      `select id from public.equipment_types where id = $1`,
      [newTypeId]
    );
    expect(checkDeleted.rows).toHaveLength(0);

    // Appears in recycle bin
    const binRes = await ctx.as<{ record_id: string; table_name: string }>(
      MGMT_USER,
      `select record_id, table_name from public.list_recycle_bin() where record_id = $1`,
      [newTypeId]
    );
    expect(binRes.rows).toHaveLength(1);
    expect(binRes.rows[0]!.table_name).toBe("equipment_types");

    // Restore
    await ctx.as(
      MGMT_USER,
      `select public.restore_record('equipment_types', $1::uuid)`,
      [newTypeId]
    );
    const checkRestored = await ctx.as(
      OFFICE_USER,
      `select id from public.equipment_types where id = $1`,
      [newTypeId]
    );
    expect(checkRestored.rows).toHaveLength(1);
  });

  it("creates equipment items with equipment_type_id, tracking status, location, and calibration", async () => {
    const typeRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `select id from public.equipment_types where name = 'UT flaw detector' limit 1`
    );
    const typeId = typeRes.rows[0]!.id;

    const equipRes = await ctx.as<{
      id: string;
      serial_no: string;
      status: string;
      current_location: string;
    }>(
      OFFICE_USER,
      `insert into public.equipment (
        equipment_type_id,
        make,
        model,
        serial_no,
        calibrated_on,
        calibration_due,
        status,
        current_location
      ) values (
        $1,
        'Olympus',
        'EPOCH 650',
        'SN-TEST-UT-001',
        '2026-05-01',
        '2027-04-30',
        'in_office',
        'In office'
      ) returning id, serial_no, status, current_location`,
      [typeId]
    );

    expect(equipRes.rows[0]!.serial_no).toBe("SN-TEST-UT-001");
    expect(equipRes.rows[0]!.status).toBe("in_office");
    expect(equipRes.rows[0]!.current_location).toBe("In office");
  });

  it("records movement with delivery challans and updates equipment status and location", async () => {
    // 1. Create a job
    const custRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.customers (name, code) values ('Movement Test Customer Ltd', 'MTCL') returning id`
    );
    const customerId = custRes.rows[0]!.id;

    const jobRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.jobs (customer_id, job_no, status) values ($1, 'BITA/26-27/MOVE-01', 'scheduled') returning id`,
      [customerId]
    );
    const jobId = jobRes.rows[0]!.id;

    // 2. Assign Job to Technician A
    await ctx.as(
      OFFICE_USER,
      `insert into public.assignments (job_id, person_id, work_date) values ($1, $2, '2026-11-10')`,
      [jobId, TECH_PERSON_A]
    );

    // 3. Create equipment
    const equipRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.equipment (make, model, serial_no, status, current_location)
       values ('Magnaflux', 'Y-7 AC/DC', 'YOKE-MOVE-01', 'in_office', 'In office')
       returning id`
    );
    const equipId = equipRes.rows[0]!.id;

    // 4. Record movement to site with delivery challan
    const moveRes = await ctx.as<{ id: string; delivery_challan_no: string; to_location: string }>(
      OFFICE_USER,
      `insert into public.equipment_movements (
        equipment_id,
        job_id,
        delivery_challan_no,
        delivery_challan_path,
        from_location,
        to_location,
        status,
        moved_on,
        notes
      ) values (
        $1,
        $2,
        'DC-2026-089',
        'equipment/challans/DC-2026-089.pdf',
        'In office',
        'Jigani Shop 3',
        'at_site',
        '2026-11-09',
        'Handed to driver for morning delivery'
      ) returning id, delivery_challan_no, to_location`,
      [equipId, jobId]
    );
    expect(moveRes.rows[0]!.delivery_challan_no).toBe("DC-2026-089");
    expect(moveRes.rows[0]!.to_location).toBe("Jigani Shop 3");

    // 5. Update equipment status
    await ctx.as(
      OFFICE_USER,
      `update public.equipment set status = 'at_site', current_location = 'Jigani Shop 3', current_job_id = $1 where id = $2`,
      [jobId, equipId]
    );

    const updatedEquip = await ctx.as<{ status: string; current_location: string; current_job_id: string }>(
      OFFICE_USER,
      `select status, current_location, current_job_id from public.equipment where id = $1`,
      [equipId]
    );
    expect(updatedEquip.rows[0]!.status).toBe("at_site");
    expect(updatedEquip.rows[0]!.current_location).toBe("Jigani Shop 3");
    expect(updatedEquip.rows[0]!.current_job_id).toBe(jobId);

    // 6. RLS check on movements:
    // Technician A (assigned to this job) CAN see the movement
    const techAMove = await ctx.as<{ id: string }>(
      TECH_USER_A,
      `select id from public.equipment_movements where equipment_id = $1`,
      [equipId]
    );
    expect(techAMove.rows).toHaveLength(1);

    // Technician B (not assigned to this job) CANNOT see the movement
    const techBMove = await ctx.as<{ id: string }>(
      TECH_USER_B,
      `select id from public.equipment_movements where equipment_id = $1`,
      [equipId]
    );
    expect(techBMove.rows).toHaveLength(0);
  });
});
