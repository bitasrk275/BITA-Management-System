import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../supabase/tests/setup";

describe("G12 – UAT database seed (demo.sql), reset (uat-reset.sql), and non-fake safety guard", () => {
  it("applies all migrations, seeds Phase 2 UAT data idempotently, resets cleanly, and refuses if non-fake customers exist", async () => {
    const { db } = await createTestDb();

    const demoSql = readFileSync(
      join(__dirname, "..", "supabase", "seed", "demo.sql"),
      "utf8",
    );
    const resetSql = readFileSync(
      join(__dirname, "..", "supabase", "seed", "uat-reset.sql"),
      "utf8",
    );

    // 1. Run demo.sql twice to verify idempotency
    await db.exec(demoSql);
    await db.exec(demoSql);

    // 2. Check customers across multiple GST states (29 Karnataka, 33 Tamil Nadu, 27 Maharashtra)
    const custRes = await db.query<{
      id: string;
      name: string;
      gstin: string;
      notes: string;
    }>(`select id, name, gstin, notes from public.customers order by id`);
    expect(custRes.rows.length).toBeGreaterThanOrEqual(3);
    const statePrefixes = new Set(custRes.rows.map((r) => r.gstin.slice(0, 2)));
    expect(statePrefixes.has("29")).toBe(true);
    expect(statePrefixes.has("33")).toBe(true);
    expect(statePrefixes.has("27")).toBe(true);

    // 3. Check 2 technicians without logins + qualifications (including expired)
    const techRes = await db.query<{ id: string; user_id: string | null }>(
      `select id, user_id from public.people where 'technician' = any(roles) and user_id is null`,
    );
    expect(techRes.rows.length).toBeGreaterThanOrEqual(2);

    const qualRes = await db.query<{ is_expired: boolean }>(
      `select is_expired from public.qualification_status`,
    );
    expect(qualRes.rows.length).toBeGreaterThanOrEqual(4);
    expect(qualRes.rows.some((q) => q.is_expired === true)).toBe(true);

    // 4. Check equipment (4+ items including one expired calibration)
    const eqRes = await db.query<{
      id: string;
      calibration_due: string;
      is_overdue: boolean;
    }>(
      `select id, calibration_due::text, (calibration_due < current_date) as is_overdue from public.equipment`,
    );
    expect(eqRes.rows.length).toBeGreaterThanOrEqual(4);
    expect(eqRes.rows.some((e) => e.is_overdue === true)).toBe(true);

    // 5. Check Phase 2 price_items, settings (company_profile, invoice_numbering starting at 1, holidays)
    const priceRes = await db.query<{ count: string }>(
      `select count(*)::text as count from public.price_items where deleted_at is null`,
    );
    expect(Number(priceRes.rows[0].count)).toBeGreaterThanOrEqual(5);

    const settingsRes = await db.query<{ key: string; value: Record<string, unknown> }>(
      `select key, value from public.settings where key in ('company_profile', 'invoice_numbering', 'holidays')`,
    );
    const settingsByKey = new Map(settingsRes.rows.map((r) => [r.key, r.value]));
    expect(String(settingsByKey.get("company_profile")?.name ?? "")).toContain("UAT SANDBOX");
    expect(settingsByKey.get("invoice_numbering")?.next_tax_no).toBe(1);
    expect(settingsByKey.get("invoice_numbering")?.next_proforma_no).toBe(1);
    expect(Array.isArray(settingsByKey.get("holidays")?.dates)).toBe(true);

    // 6. Check enquiry, uploaded quotation (pdf_path), and scheduled job on calendar
    const quoteRes = await db.query<{ id: string; pdf_path: string | null; status: string }>(
      `select id, pdf_path, status from public.quotations where pdf_path is not null`,
    );
    expect(quoteRes.rows.length).toBeGreaterThanOrEqual(1);
    expect(quoteRes.rows[0].status).toBe("accepted");

    const schedJobRes = await db.query<{ id: string; job_no: string }>(
      `select j.id, j.job_no
       from public.jobs j
       join public.assignments a on a.job_id = j.id
       where j.status = 'scheduled'`,
    );
    expect(schedJobRes.rows.length).toBeGreaterThanOrEqual(1);

    // 7. Run uat-reset.sql and verify tables are truncated, then re-seed cleanly
    await db.exec(resetSql);
    const afterResetCust = await db.query<{ count: string }>(
      `select count(*)::text as count from public.customers`,
    );
    expect(Number(afterResetCust.rows[0].count)).toBe(0);

    await db.exec(demoSql);
    const reseededCust = await db.query<{ count: string }>(
      `select count(*)::text as count from public.customers`,
    );
    expect(Number(reseededCust.rows[0].count)).toBeGreaterThanOrEqual(3);

    // 8. Insert a non-fake customer row and verify both demo.sql and uat-reset.sql refuse to run
    await db.exec(`
      insert into public.customers (name, code, gstin, billing_address, notes)
      values ('Real Aerospace Components Ltd', 'RACL', '29AAACR9999A1Z5', 'Bengaluru', 'Real customer record')
    `);

    await expect(db.exec(demoSql)).rejects.toThrow(
      /Refusing to run demo\.sql: public\.customers contains non-fake customer records/,
    );
    await expect(db.exec(resetSql)).rejects.toThrow(
      /Refusing to run uat-reset\.sql: public\.customers contains non-fake customer records/,
    );
  }, 60_000);
});
