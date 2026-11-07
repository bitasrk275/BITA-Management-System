import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./setup";

const MGMT_USER = "00000000-0000-0000-0000-000000000001";
const OFFICE_USER = "00000000-0000-0000-0000-000000000002";
const REVIEWER_USER = "00000000-0000-0000-0000-000000000003";
const TECH_USER = "00000000-0000-0000-0000-000000000004";

describe("Phase 2 Foundation (P1): soft delete, recycle bin, settings, and permissions on PGlite", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.exec(`
      insert into auth.users (id) values
        ('${MGMT_USER}'), ('${OFFICE_USER}'), ('${REVIEWER_USER}'), ('${TECH_USER}');
      insert into public.people (id, full_name, initials, user_id, roles) values
        ('00000000-0000-0000-0000-000000000011', 'S. Radhakrishnan', 'SRK', '${MGMT_USER}', '{management,reviewer}'),
        ('00000000-0000-0000-0000-000000000012', 'Test Office Coord', 'TOC', '${OFFICE_USER}', '{office}'),
        ('00000000-0000-0000-0000-000000000013', 'Test Reviewer', 'TRV', '${REVIEWER_USER}', '{reviewer}'),
        ('00000000-0000-0000-0000-000000000014', 'Test Technician', 'TT1', '${TECH_USER}', '{technician}');
    `);
  });

  it("seeds default settings and settings_options and enforces RLS on settings", async () => {
    const settingsRes = await ctx.as<{ key: string }>(
      OFFICE_USER,
      `select key from public.settings order by key`,
    );
    expect(settingsRes.rows.map((r) => r.key)).toEqual([
      "holidays",
      "invoice_numbering",
      "permissions",
      "reminder_timings",
    ]);

    const optionsRes = await ctx.as<{ list_key: string; value: string }>(
      TECH_USER,
      `select list_key, value from public.settings_options where list_key = 'couplant' order by position`,
    );
    expect(optionsRes.rows.map((r) => r.value)).toEqual(["Oil", "Grease", "Water", "Glycerin"]);

    // Office cannot overwrite system settings
    await expect(
      ctx.as(
        OFFICE_USER,
        `insert into public.settings (key, value) values ('custom_test', '{"a":1}'::jsonb)`,
      ),
    ).rejects.toThrow(/row-level security/i);

    // Office can add a dropdown option
    await ctx.as(
      OFFICE_USER,
      `insert into public.settings_options (list_key, value, position) values ('couplant', 'Cellulose paste', 5)`,
    );
  });

  it("hides soft-deleted rows from normal SELECTs across all 6 tables, refuses office delete by default, and allows management to delete, list recycle bin, and restore", async () => {
    const custRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.customers (name, code, gstin)
       values ('Soft Delete Test Customer Ltd', 'SDTC', '29AABCS1429B1Z1')
       returning id`,
    );
    const customerId = custRes.rows[0]!.id;

    const enqRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.enquiries (customer_id, source, subject)
       values ($1, 'email', 'UT inspection enquiry for soft delete')
       returning id`,
      [customerId],
    );
    const enquiryId = enqRes.rows[0]!.id;

    const quoteRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.quotations (customer_id, enquiry_id, ref_no, subject)
       values ($1, $2, 'BITA/Q/SD-01', 'Quote for soft delete')
       returning id`,
      [customerId, enquiryId],
    );
    const quotationId = quoteRes.rows[0]!.id;

    const jobRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.jobs (customer_id, enquiry_id, quotation_id, site, test_methods)
       values ($1, $2, $3, 'Peenya', '{UT}')
       returning id`,
      [customerId, enquiryId, quotationId],
    );
    const jobId = jobRes.rows[0]!.id;

    const equipRes = await ctx.as<{ id: string }>(
      MGMT_USER,
      `insert into public.equipment (kind, make, model, serial_no)
       values ('ut_flaw_detector', 'Krautkramer', 'USM 36', 'SN-SD-001')
       returning id`,
    );
    const equipmentId = equipRes.rows[0]!.id;

    // Office cannot soft-delete by default (neither via RPC nor direct UPDATE)
    await expect(
      ctx.as(OFFICE_USER, `select public.soft_delete_record('customers', $1::uuid)`, [customerId]),
    ).rejects.toThrow(/Only management can delete/i);

    await expect(
      ctx.as(OFFICE_USER, `update public.customers set deleted_at = now() where id = $1`, [
        customerId,
      ]),
    ).rejects.toThrow(/Only management can delete/i);

    // Management soft-deletes customer, enquiry, quotation, job, and equipment
    await ctx.as(MGMT_USER, `select public.soft_delete_record('customers', $1::uuid)`, [
      customerId,
    ]);
    await ctx.as(MGMT_USER, `select public.soft_delete_record('enquiries', $1::uuid)`, [
      enquiryId,
    ]);
    await ctx.as(MGMT_USER, `select public.soft_delete_record('quotations', $1::uuid)`, [
      quotationId,
    ]);
    await ctx.as(MGMT_USER, `select public.soft_delete_record('jobs', $1::uuid)`, [jobId]);
    await ctx.as(MGMT_USER, `select public.soft_delete_record('equipment', $1::uuid)`, [
      equipmentId,
    ]);

    // Normal SELECTs return 0 rows for soft-deleted items (both office and management)
    for (const user of [OFFICE_USER, MGMT_USER]) {
      const checkCust = await ctx.as(user, `select id from public.customers where id = $1`, [
        customerId,
      ]);
      expect(checkCust.rows).toHaveLength(0);

      const checkEnq = await ctx.as(user, `select id from public.enquiries where id = $1`, [
        enquiryId,
      ]);
      expect(checkEnq.rows).toHaveLength(0);

      const checkQuote = await ctx.as(user, `select id from public.quotations where id = $1`, [
        quotationId,
      ]);
      expect(checkQuote.rows).toHaveLength(0);

      const checkJob = await ctx.as(user, `select id from public.jobs where id = $1`, [jobId]);
      expect(checkJob.rows).toHaveLength(0);

      const checkEquip = await ctx.as(user, `select id from public.equipment where id = $1`, [
        equipmentId,
      ]);
      expect(checkEquip.rows).toHaveLength(0);
    }

    // Recycle bin lists all 5 deleted records with deleted_by_name = 'S. Radhakrishnan'
    const binRes = await ctx.as<{
      table_name: string;
      record_id: string;
      label: string;
      deleted_by_name: string;
    }>(MGMT_USER, `select table_name, record_id, label, deleted_by_name from public.list_recycle_bin()`);

    expect(binRes.rows.length).toBeGreaterThanOrEqual(5);
    const deletedCustInBin = binRes.rows.find(
      (r) => r.table_name === "customers" && r.record_id === customerId,
    );
    expect(deletedCustInBin).toBeDefined();
    expect(deletedCustInBin?.label).toBe("Soft Delete Test Customer Ltd");
    expect(deletedCustInBin?.deleted_by_name).toBe("S. Radhakrishnan");

    const deletedEquipInBin = binRes.rows.find(
      (r) => r.table_name === "equipment" && r.record_id === equipmentId,
    );
    expect(deletedEquipInBin?.label).toBe("Krautkramer USM 36");

    // Office cannot restore by default
    await expect(
      ctx.as(OFFICE_USER, `select public.restore_record('customers', $1::uuid)`, [customerId]),
    ).rejects.toThrow(/Only management can restore/i);

    // Management restores the customer
    await ctx.as(MGMT_USER, `select public.restore_record('customers', $1::uuid)`, [customerId]);

    // Customer is visible again in normal SELECTs with deleted_at = null and deleted_by = null
    const restoredCust = await ctx.as<{
      id: string;
      deleted_at: string | null;
      deleted_by: string | null;
    }>(
      OFFICE_USER,
      `select id, deleted_at, deleted_by from public.customers where id = $1`,
      [customerId],
    );
    expect(restoredCust.rows).toHaveLength(1);
    expect(restoredCust.rows[0]?.deleted_at).toBeNull();
    expect(restoredCust.rows[0]?.deleted_by).toBeNull();

    // Audit log recorded both the soft-delete and the restore on customers
    const auditRes = await ctx.as<{ action: string; changed_fields: string[] }>(
      MGMT_USER,
      `select action, changed_fields from public.audit_log
       where table_name = 'customers' and record_id = $1
       order by id asc`,
      [customerId],
    );
    expect(auditRes.rows.length).toBeGreaterThanOrEqual(3);
    expect(auditRes.rows.some((r) => r.changed_fields.includes("deleted_at"))).toBe(true);
  });

  it("allows office to soft-delete and restore when management grants office 'delete' permission in public.settings", async () => {
    await ctx.as(
      MGMT_USER,
      `update public.settings
       set value = jsonb_set(value, '{delete}', '["management", "office"]'::jsonb)
       where key = 'permissions'`,
    );

    const custRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.customers (name, code) values ('Office Deletable Co', 'ODC') returning id`,
    );
    const custId = custRes.rows[0]!.id;

    // Now office can soft-delete and restore
    await ctx.as(OFFICE_USER, `select public.soft_delete_record('customers', $1::uuid)`, [custId]);

    const afterDelete = await ctx.as(
      OFFICE_USER,
      `select id from public.customers where id = $1`,
      [custId],
    );
    expect(afterDelete.rows).toHaveLength(0);

    await ctx.as(OFFICE_USER, `select public.restore_record('customers', $1::uuid)`, [custId]);

    const afterRestore = await ctx.as(
      OFFICE_USER,
      `select id from public.customers where id = $1`,
      [custId],
    );
    expect(afterRestore.rows).toHaveLength(1);

    // Reset permissions back to default (management only)
    await ctx.as(
      MGMT_USER,
      `update public.settings
       set value = jsonb_set(value, '{delete}', '["management"]'::jsonb)
       where key = 'permissions'`,
    );
  });

  it("records Customer PO value (po_value) on jobs and rejects negative po_value (P2)", async () => {
    const custRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.customers (name, code, gstin)
       values ('PO Value Turbine Works', 'PVTW', '29AABCP1234F1Z2')
       returning id`,
    );
    const custId = custRes.rows[0]!.id;

    const jobRes = await ctx.as<{
      id: string;
      po_number: string | null;
      po_date: string | null;
      po_value: string | null;
    }>(
      OFFICE_USER,
      `insert into public.jobs (customer_id, site, po_number, po_date, po_value)
       values ($1, 'Peenya Stage II', 'PO/PVTW/2026/88', '2026-11-07', 125000.50)
       returning id, po_number, po_date::text as po_date, po_value::text as po_value`,
      [custId],
    );

    expect(jobRes.rows[0]?.po_number).toBe("PO/PVTW/2026/88");
    expect(jobRes.rows[0]?.po_date).toBe("2026-11-07");
    expect(Number(jobRes.rows[0]?.po_value)).toBe(125000.5);

    // Negative po_value is rejected by the database check constraint
    await expect(
      ctx.as(
        OFFICE_USER,
        `update public.jobs set po_value = -100 where id = $1`,
        [jobRes.rows[0]!.id],
      ),
    ).rejects.toThrow(/check/i);
  });

  it("manages price_items with RLS, soft delete, and recycle bin restoration (P3)", async () => {
    // 1. Default seeded items are visible to staff
    const seededRes = await ctx.as<{ name: string; default_rate: string }>(
      OFFICE_USER,
      `select name, default_rate::text as default_rate from public.price_items order by name`,
    );
    expect(seededRes.rows.some((r) => r.name === "UT service" && Number(r.default_rate) === 7500)).toBe(
      true,
    );
    expect(seededRes.rows.some((r) => r.name === "Conveyance" && Number(r.default_rate) === 4000)).toBe(
      true,
    );

    // 2. Technician cannot see price items
    const techRes = await ctx.as(TECH_USER, `select id from public.price_items`);
    expect(techRes.rows).toHaveLength(0);

    // 3. Office can add and edit a price item
    const createdRes = await ctx.as<{ id: string }>(
      OFFICE_USER,
      `insert into public.price_items (name, description, sac, unit, default_rate)
       values ('RLA assessment', 'Remaining Life Assessment charges', '998346', 'job', 25000)
       returning id`,
    );
    const priceItemId = createdRes.rows[0]!.id;

    // 4. Management soft-deletes the price item; it disappears from normal SELECTs and appears in list_recycle_bin
    await ctx.as(MGMT_USER, `select public.soft_delete_record('price_items', $1::uuid)`, [priceItemId]);

    const afterDelete = await ctx.as(
      OFFICE_USER,
      `select id from public.price_items where id = $1`,
      [priceItemId],
    );
    expect(afterDelete.rows).toHaveLength(0);

    const binRes = await ctx.as<{ table_name: string; record_id: string; label: string }>(
      MGMT_USER,
      `select table_name, record_id, label from public.list_recycle_bin() where table_name = 'price_items'`,
    );
    expect(binRes.rows.some((r) => r.record_id === priceItemId && r.label === "RLA assessment")).toBe(
      true,
    );

    // 5. Management restores the price item
    await ctx.as(MGMT_USER, `select public.restore_record('price_items', $1::uuid)`, [priceItemId]);

    const afterRestore = await ctx.as(
      OFFICE_USER,
      `select id, name from public.price_items where id = $1`,
      [priceItemId],
    );
    expect(afterRestore.rows).toHaveLength(1);
  });
});
