// Runs the migrations in an in-memory Postgres (PGlite) with a minimal stand-in for Supabase's auth schema,
// then checks the business rules the database enforces. Test data only.
import type { PGlite, Results } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./setup";

const OFFICE = "00000000-0000-0000-0000-00000000000a";
const REVIEWER = "00000000-0000-0000-0000-00000000000b";
const OUTSIDER = "00000000-0000-0000-0000-00000000000c";

let db: PGlite;
let as: <T>(userId: string | "service", sql: string, params?: unknown[]) => Promise<Results<T>>;

beforeAll(async () => {
  ({ db, as } = await createTestDb());
  await db.exec(`
    insert into auth.users (id) values ('${OFFICE}'), ('${REVIEWER}'), ('${OUTSIDER}');
    insert into people (id, full_name, user_id, roles) values
      ('10000000-0000-0000-0000-00000000000a', 'Test Office', '${OFFICE}', '{office}'),
      ('10000000-0000-0000-0000-00000000000b', 'Test Reviewer', '${REVIEWER}', '{management,reviewer}');
    insert into people (id, full_name, initials, roles) values
      ('10000000-0000-0000-0000-00000000000d', 'Test Technician', 'TT', '{technician}');
    insert into customers (id, name, code, gstin) values
      ('20000000-0000-0000-0000-000000000001', 'Test Customer Pvt Ltd', 'TCPL', '29AAAAA0000A1Z5');
  `);
}, 60_000);

describe("job numbers", () => {
  it("numbers jobs per financial year as BITA/YY-YY/0001", async () => {
    const a = await db.query<{ n: string }>("select private.next_job_no() as n");
    const b = await db.query<{ n: string }>("select private.next_job_no() as n");
    expect(a.rows[0].n).toMatch(/^BITA\/\d{2}-\d{2}\/\d{4}$/);
    expect(Number(b.rows[0].n.slice(-4))).toBe(Number(a.rows[0].n.slice(-4)) + 1);
  });
});

describe("row level security", () => {
  it("lets office staff create and read customers", async () => {
    await as(OFFICE, "insert into customers (name) values ('Office Added Ltd')");
    const r = await as<{ name: string }>(OFFICE, "select name from customers order by name");
    expect(r.rows.map((x) => x.name)).toContain("Office Added Ltd");
  });

  it("shows nothing to a logged-in user who is not BITA staff", async () => {
    const r = await as(OUTSIDER, "select * from customers");
    expect(r.rows).toHaveLength(0);
  });

  it("blocks a user who is not BITA staff from writing", async () => {
    await expect(as(OUTSIDER, "insert into customers (name) values ('Intruder')")).rejects.toThrow();
  });

  it("does not let office staff edit people or their roles", async () => {
    const r = await as(OFFICE, "update people set roles = '{management}' where user_id = $1 returning id", [OFFICE]);
    expect(r.rows).toHaveLength(0);
  });

  it("lets management change only the reminder pause flag on an invoice", async () => {
    await db.exec(`
      insert into jobs (id, customer_id) values ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001');
      insert into invoices (job_id, kind, zoho_id, total) values ('30000000-0000-0000-0000-000000000009', 'tax_invoice', 'Z-9', 1000);
    `);
    const ok = await as(REVIEWER, "update invoices set reminders_paused = true where zoho_id = 'Z-9' returning id");
    expect(ok.rows).toHaveLength(1);
    await expect(as(REVIEWER, "update invoices set total = 1 where zoho_id = 'Z-9'")).rejects.toThrow();
  });
});

describe("reports", () => {
  const JOB = "30000000-0000-0000-0000-000000000001";
  const INSP = "40000000-0000-0000-0000-000000000001";

  beforeAll(async () => {
    await db.exec(`
      insert into jobs (id, customer_id) values ('${JOB}', '20000000-0000-0000-0000-000000000001');
      insert into inspections (id, job_id, method, readings, submitted_at, missing_fields)
        values ('${INSP}', '${JOB}', 'UT', '{"couplant": "Oil"}', now(), '{sensitivity}');
    `);
  });

  it("cannot be prepared while mandatory readings are missing", async () => {
    await expect(
      db.query(`insert into reports (job_id, inspection_id, method, report_no) values ($1, $2, 'UT', 'T-001')`, [JOB, INSP]),
    ).rejects.toThrow(/Mandatory readings missing: sensitivity/);
  });

  it("can be approved only by a technical reviewer, and the PDF only after approval", async () => {
    await db.exec(`update inspections set missing_fields = '{}' where id = '${INSP}'`);
    await db.query(`insert into reports (job_id, inspection_id, method, report_no) values ($1, $2, 'UT', 'T-002')`, [JOB, INSP]);

    await expect(db.query("update reports set pdf_path = 'x.pdf' where report_no = 'T-002'")).rejects.toThrow();
    await expect(
      db.query(`update reports set status = 'approved', approved_at = now(),
                approved_by = '10000000-0000-0000-0000-00000000000a' where report_no = 'T-002'`),
    ).rejects.toThrow(/Only a technical reviewer/);

    await db.query(`update reports set status = 'approved', approved_at = now(),
                    approved_by = '10000000-0000-0000-0000-00000000000b', pdf_path = 'x.pdf' where report_no = 'T-002'`);
  });
});

describe("correction log", () => {
  it("keeps the original and corrected value, and who made the change", async () => {
    const job = "30000000-0000-0000-0000-000000000002";
    const insp = "40000000-0000-0000-0000-000000000002";
    await db.exec(`
      insert into jobs (id, customer_id) values ('${job}', '20000000-0000-0000-0000-000000000001');
      insert into inspections (id, job_id, method, observations) values ('${insp}', '${job}', 'MPT', 'No indications');
    `);
    await db.exec("select set_config('app.actor_person_id', '10000000-0000-0000-0000-00000000000d', false)");
    await db.query("update inspections set observations = 'Linear indication at weld toe' where id = $1", [insp]);
    await db.exec("select set_config('app.actor_person_id', '', false)");

    const r = await db.query<{ changed_fields: string[]; old_obs: string; new_obs: string; changed_by_person: string }>(
      `select changed_fields, old_row ->> 'observations' as old_obs, new_row ->> 'observations' as new_obs, changed_by_person
       from audit_log where record_id = $1 and action = 'update'`,
      [insp],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      changed_fields: ["observations"],
      old_obs: "No indications",
      new_obs: "Linear indication at weld toe",
      changed_by_person: "10000000-0000-0000-0000-00000000000d",
    });
  });
});

describe("invoices", () => {
  it("allows only one GST invoice per job", async () => {
    const job = "30000000-0000-0000-0000-000000000003";
    await db.exec(`insert into jobs (id, customer_id) values ('${job}', '20000000-0000-0000-0000-000000000001')`);
    await db.query(`insert into invoices (job_id, kind, zoho_id) values ($1, 'proforma', 'P-1')`, [job]);
    await db.query(`insert into invoices (job_id, kind, zoho_id) values ($1, 'tax_invoice', 'I-1')`, [job]);
    await expect(db.query(`insert into invoices (job_id, kind, zoho_id) values ($1, 'tax_invoice', 'I-2')`, [job])).rejects.toThrow();
  });

  it("issues an in-app invoice with BITA/YY-YY/INV-0001, freezes it, and tracks payments into balance", async () => {
    const job = "30000000-0000-0000-0000-000000000031";
    await db.exec(`insert into jobs (id, customer_id) values ('${job}', '20000000-0000-0000-0000-000000000001')`);

    const draft = await as<{ id: string; status: string; balance: string }>(
      OFFICE,
      `insert into invoices (job_id, kind, taxable_value, cgst, sgst, total)
       values ($1, 'tax_invoice', 10000, 900, 900, 11800)
       returning id, status, balance`,
      [job],
    );
    const invId = draft.rows[0].id;
    expect(draft.rows[0].status).toBe("draft");
    expect(Number(draft.rows[0].balance)).toBe(11800);

    await as(
      OFFICE,
      `insert into invoice_lines (invoice_id, position, description, qty, rate, amount)
       values ($1, 1, 'UT of exciter shaft', 2, 5000, 10000)`,
      [invId],
    );

    // Cannot record a payment before the invoice is issued
    await expect(
      as(OFFICE, `insert into payments (invoice_id, amount, mode) values ($1, 5000, 'NEFT')`, [invId]),
    ).rejects.toThrow(/issued invoice/);

    // Issue the invoice -> assigns invoice_no and freezes content
    const issued = await as<{ invoice_no: string; number: string; status: string; issued_at: string }>(
      OFFICE,
      `update invoices set status = 'issued' where id = $1 returning invoice_no, number, status, issued_at`,
      [invId],
    );
    expect(issued.rows[0].invoice_no).toMatch(/^BITA\/\d{2}-\d{2}\/INV-\d{4}$/);
    expect(issued.rows[0].number).toBe(issued.rows[0].invoice_no);
    expect(issued.rows[0].issued_at).toBeTruthy();

    // Editing total or lines after issue is blocked
    await expect(as(OFFICE, `update invoices set total = 20000 where id = $1`, [invId])).rejects.toThrow(/Issued invoices cannot be edited/);
    await expect(
      as(OFFICE, `insert into invoice_lines (invoice_id, description, qty, rate, amount) values ($1, 'Extra', 1, 100, 100)`, [invId]),
    ).rejects.toThrow(/Cannot modify lines/);

    // Partial payment -> partly_paid and balance reduced
    const p1 = await as<{ id: string }>(
      OFFICE,
      `insert into payments (invoice_id, amount, mode, reference) values ($1, 5000, 'NEFT', 'UTR-1') returning id`,
      [invId],
    );
    const afterPart = await as<{ status: string; balance: string }>(
      OFFICE,
      `select status, balance from invoices where id = $1`,
      [invId],
    );
    expect(afterPart.rows[0].status).toBe("partly_paid");
    expect(Number(afterPart.rows[0].balance)).toBe(6800);

    // Overpayment (> remaining balance 6800) is refused
    await expect(
      as(OFFICE, `insert into payments (invoice_id, amount, mode) values ($1, 7000, 'NEFT')`, [invId]),
    ).rejects.toThrow(/exceeds the invoice balance/);

    // Updating an existing payment within (balance + old.amount = 11800) is allowed
    await as(OFFICE, `update payments set amount = 6000 where id = $1`, [p1.rows[0].id]);

    // Remaining payment (5800) -> paid and balance 0
    await as(OFFICE, `insert into payments (invoice_id, amount, mode, reference) values ($1, 5800, 'NEFT', 'UTR-2')`, [invId]);
    const afterFull = await as<{ status: string; balance: string }>(
      OFFICE,
      `select status, balance from invoices where id = $1`,
      [invId],
    );
    expect(afterFull.rows[0].status).toBe("paid");
    expect(Number(afterFull.rows[0].balance)).toBe(0);
  });

  it("refuses to issue an invoice with no lines or mismatched totals, and fills due_date from customer payment_terms_days", async () => {
    const cust45 = "20000000-0000-0000-0000-000000000045";
    const job = "30000000-0000-0000-0000-000000000032";
    await db.exec(`
      insert into customers (id, name, code, payment_terms_days) values ('${cust45}', 'Forty-Five Day Co', 'FFDC', 45);
      insert into jobs (id, customer_id) values ('${job}', '${cust45}');
    `);

    const draft = await as<{ id: string }>(
      OFFICE,
      `insert into invoices (job_id, kind, invoice_date, taxable_value, cgst, sgst, total)
       values ($1, 'tax_invoice', '2026-11-06', 10000, 900, 900, 11800)
       returning id`,
      [job],
    );
    const invId = draft.rows[0].id;

    // 1. Refuse issuing with 0 lines
    await expect(as(OFFICE, `update invoices set status = 'issued' where id = $1`, [invId])).rejects.toThrow(
      /without at least one line item/,
    );

    // Add a line whose amount (8000) does not match taxable_value (10000)
    await as(
      OFFICE,
      `insert into invoice_lines (invoice_id, position, description, qty, rate, amount)
       values ($1, 1, 'DPT inspection', 1, 8000, 8000)`,
      [invId],
    );
    await expect(as(OFFICE, `update invoices set status = 'issued' where id = $1`, [invId])).rejects.toThrow(
      /does not match sum of line amounts/,
    );

    // Fix line amount to 10000, but test mismatched total and both IGST + CGST
    await as(OFFICE, `update invoice_lines set rate = 10000, amount = 10000 where invoice_id = $1`, [invId]);
    await expect(
      as(OFFICE, `update invoices set igst = 1800, total = 13600, status = 'issued' where id = $1`, [invId]),
    ).rejects.toThrow(/both IGST and CGST\/SGST/);

    await expect(
      as(OFFICE, `update invoices set total = 12000, status = 'issued' where id = $1`, [invId]),
    ).rejects.toThrow(/does not equal taxable_value/);

    // Valid issue -> sets due_date = '2026-11-06' + 45 days = '2026-12-21'
    const issued = await as<{ due_date: string }>(
      OFFICE,
      `update invoices set status = 'issued' where id = $1 returning due_date::text as due_date`,
      [invId],
    );
    expect(issued.rows[0].due_date).toBe("2026-12-21");
  });

  it("lets only the server set the old Zoho id, so nobody can skip the issue checks", async () => {
    const job = "30000000-0000-0000-0000-000000000003";
    await expect(
      as(OFFICE, `insert into invoices (job_id, kind, zoho_id) values ('${job}', 'proforma', 'Z-OFFICE')`),
    ).rejects.toThrow(/zoho_id can only be set by the server/);
    await expect(
      as(REVIEWER, "update invoices set zoho_id = 'Z-CHANGED' where zoho_id = 'P-1'"),
    ).rejects.toThrow(/zoho_id can only be set by the server/);
    const ok = await as(
      "service",
      `insert into invoices (job_id, kind, zoho_id) values ('${job}', 'proforma', 'Z-SERVER') returning id`,
    );
    expect(ok.rows).toHaveLength(1);
  });
});

describe("file storage", () => {
  it("lets staff upload documents but only management upload signatures", async () => {
    await as(OFFICE, "insert into storage.objects (bucket_id, name) values ('documents', 'po/test.pdf')");
    await expect(
      as(OFFICE, "insert into storage.objects (bucket_id, name) values ('branding', 'sig.png')"),
    ).rejects.toThrow();
    await as(REVIEWER, "insert into storage.objects (bucket_id, name) values ('branding', 'sig.png')");
  });

  it("hides files from a logged-in user who is not BITA staff", async () => {
    const r = await as(OUTSIDER, "select * from storage.objects");
    expect(r.rows).toHaveLength(0);
  });
});

describe("technician logins", () => {
  const TECH = "00000000-0000-0000-0000-00000000000e";
  const TECH_PERSON = "10000000-0000-0000-0000-00000000000e";
  const MY_JOB = "30000000-0000-0000-0000-0000000000a1";
  const OTHER_JOB = "30000000-0000-0000-0000-0000000000a2";

  beforeAll(async () => {
    await db.exec(`
      insert into auth.users (id) values ('${TECH}');
      insert into people (id, full_name, user_id, roles) values ('${TECH_PERSON}', 'Test Field Tech', '${TECH}', '{technician}');
      insert into jobs (id, customer_id) values
        ('${MY_JOB}', '20000000-0000-0000-0000-000000000001'),
        ('${OTHER_JOB}', '20000000-0000-0000-0000-000000000001');
      insert into assignments (job_id, person_id, work_date) values ('${MY_JOB}', '${TECH_PERSON}', current_date);
      insert into invoices (job_id, kind, zoho_id, total) values ('${MY_JOB}', 'proforma', 'Z-T1', 5000);
      insert into quotations (ref_no, customer_id) values ('T-QT', '20000000-0000-0000-0000-000000000001');
    `);
  });

  it("sees only the jobs they are assigned to", async () => {
    const r = await as<{ id: string }>(TECH, "select id from jobs");
    expect(r.rows.map((x) => x.id)).toEqual([MY_JOB]);
  });

  it("never sees invoices, quotations or enquiries", async () => {
    for (const table of ["invoices", "invoice_lines", "payments", "quotations", "quotation_items", "enquiries", "audit_log"]) {
      const r = await as(TECH, `select * from ${table}`);
      expect(r.rows, table).toHaveLength(0);
    }
  });

  it("can enter field data only for their own job", async () => {
    await as(TECH, `insert into inspections (job_id, method, submitted_by) values ($1, 'UT', $2)`, [MY_JOB, TECH_PERSON]);
    await expect(
      as(TECH, `insert into inspections (job_id, method, submitted_by) values ($1, 'UT', $2)`, [OTHER_JOB, TECH_PERSON]),
    ).rejects.toThrow();
  });

  it("can acknowledge an assignment but not move it", async () => {
    const ok = await as(TECH, "update assignments set acknowledged_at = now() where job_id = $1 returning id", [MY_JOB]);
    expect(ok.rows).toHaveLength(1);
    await expect(as(TECH, "update assignments set work_date = current_date + 7 where job_id = $1", [MY_JOB])).rejects.toThrow(
      /only acknowledge or complete/,
    );
  });

  it("can upload photos only under their own job's folder", async () => {
    await as(TECH, `insert into storage.objects (bucket_id, name) values ('documents', 'jobs/${MY_JOB}/photo.jpg')`);
    await expect(
      as(TECH, `insert into storage.objects (bucket_id, name) values ('documents', 'jobs/${OTHER_JOB}/photo.jpg')`),
    ).rejects.toThrow();
  });

  it("is not treated as office staff", async () => {
    await expect(as(TECH, "insert into customers (name) values ('Tech Added')")).rejects.toThrow();
  });
});

describe("approval by the logged-in person only", () => {
  const JOB = "30000000-0000-0000-0000-0000000000b1";
  const INSP = "40000000-0000-0000-0000-0000000000b1";

  beforeAll(async () => {
    await db.exec(`
      insert into jobs (id, customer_id) values ('${JOB}', '20000000-0000-0000-0000-000000000001');
      insert into inspections (id, job_id, method, submitted_at) values ('${INSP}', '${JOB}', 'UT', now());
      insert into reports (job_id, inspection_id, method, report_no, status) values ('${JOB}', '${INSP}', 'UT', 'T-ACT-1', 'in_review');
    `);
  });

  it("does not let office staff record a reviewer as approver", async () => {
    await expect(
      as(OFFICE, `update reports set status = 'approved', approved_at = now(),
                  approved_by = '10000000-0000-0000-0000-00000000000b' where report_no = 'T-ACT-1'`),
    ).rejects.toThrow(/only as yourself/);
  });

  it("lets the reviewer approve as themselves, then freezes the report", async () => {
    await as(REVIEWER, `update reports set status = 'approved', approved_at = now(),
                        approved_by = '10000000-0000-0000-0000-00000000000b' where report_no = 'T-ACT-1'`);
    await expect(
      as(REVIEWER, `update reports set content = '{"changed": true}' where report_no = 'T-ACT-1'`),
    ).rejects.toThrow(/cannot be edited/);
  });

  it("does not let office staff withdraw an approval", async () => {
    await expect(
      as(OFFICE, `update reports set status = 'returned', approved_at = null, approved_by = null where report_no = 'T-ACT-1'`),
    ).rejects.toThrow(/Only a technical reviewer can return/);
  });
});

describe("quotations", () => {
  it("can be approved only by management", async () => {
    await expect(
      db.query(`insert into quotations (ref_no, customer_id, status, approved_at, approved_by)
                values ('T-Q1', '20000000-0000-0000-0000-000000000001', 'approved', now(), '10000000-0000-0000-0000-00000000000a')`),
    ).rejects.toThrow(/Only management/);
  });
});

describe("technician phone pairing", () => {
  it("hides pairing codes and devices from non-staff and lets office revoke only", async () => {
    await db.exec(`
      insert into pairing_codes (person_id, code_hash, expires_at) values ('10000000-0000-0000-0000-00000000000d', 'hash-1', now() + interval '15 minutes');
      insert into technician_devices (id, person_id, secret_hash) values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000d', 'secret-1');
    `);
    const outsider = await as(OUTSIDER, "select * from technician_devices");
    expect(outsider.rows).toHaveLength(0);
    const office = await as(OFFICE, "update technician_devices set revoked_at = now() where id = '50000000-0000-0000-0000-000000000001' returning id");
    expect(office.rows).toHaveLength(1);
    await expect(as(OFFICE, "update technician_devices set secret_hash = 'x' where id = '50000000-0000-0000-0000-000000000001'")).rejects.toThrow();
    await expect(as(OFFICE, "insert into pairing_codes (person_id, code_hash, expires_at) values ('10000000-0000-0000-0000-00000000000d', 'h2', now())")).rejects.toThrow();
  });
});
