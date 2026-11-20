import { describe, expect, it } from "vitest";
import { createTestDb } from "../supabase/tests/setup";

// Round 3: a report can be created on its own (no job) and linked to a job later.
describe("reports without a job", () => {
  it("allows a draft report with no job, then links it to a job", { timeout: 30_000 }, async () => {
    const { as } = await createTestDb();
    const cust = await as<{ id: string }>("service", "insert into customers (name) values ('Sample Forgings Ltd') returning id");
    const job = await as<{ id: string }>(
      "service",
      "insert into jobs (customer_id, test_methods) values ($1, '{UT}') returning id",
      [cust.rows[0]!.id],
    );
    const rep = await as<{ id: string; job_id: string | null }>(
      "service",
      "insert into reports (method, report_no, report_date, content, status) values ('UT', 'FAKE/UT/0001', '2026-11-20', '{}'::jsonb, 'draft') returning id, job_id",
    );
    expect(rep.rows[0]!.job_id).toBeNull();

    await as("service", "update reports set job_id = $1 where id = $2", [job.rows[0]!.id, rep.rows[0]!.id]);
    const linked = await as<{ job_id: string }>("service", "select job_id from reports where id = $1", [rep.rows[0]!.id]);
    expect(linked.rows[0]!.job_id).toBe(job.rows[0]!.id);
  });
});
