// tests/field-api.test.ts
// Field API tests against the real database rules (PGlite), not mocks (T42).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PGlite, Results } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Enums } from "../lib/db/types";
import {
  createPairingCode,
  redeemPairingCode,
  resetRateLimitsForTesting,
} from "../lib/field/pairing";
import { authenticateDevice } from "../lib/field/auth";
import {
  acknowledgeAssignment,
  createTechnicianMessage,
  startAssignment,
  submitInspectionReport,
  uploadFieldAttachment,
} from "../lib/field/assignments";
import { sha256 } from "../lib/field/crypto";
import { createTestDb } from "../supabase/tests/setup";

const OFFICE_USER = "00000000-0000-0000-0000-00000000020a";
const TECH_A_USER = "00000000-0000-0000-0000-00000000020b";
const TECH_B_USER = "00000000-0000-0000-0000-00000000020c";
const REVIEWER_USER = "00000000-0000-0000-0000-00000000020d";

const OFFICE_PERSON = "20000000-0000-0000-0000-00000000020a";
const TECH_A_PERSON = "20000000-0000-0000-0000-00000000020b";
const TECH_B_PERSON = "20000000-0000-0000-0000-00000000020c";
const REVIEWER_PERSON = "20000000-0000-0000-0000-00000000020d";

const CUSTOMER_ID = "30000000-0000-0000-0000-000000000201";
const JOB_ID = "40000000-0000-0000-0000-000000000201";
const ASSIGNMENT_B_ID = "50000000-0000-0000-0000-000000000202";

let db: PGlite;
let as: <T>(
  userId: string | "service",
  sql: string,
  params?: unknown[],
) => Promise<Results<T>>;
let adapter: SupabaseClient<Database>;

function createPgliteSupabaseAdapter(pgDb: PGlite): SupabaseClient<Database> {
  function from(table: string) {
    let mode: "select" | "insert" | "update" = "select";
    let insertData: Record<string, unknown> | null = null;
    let updateData: Record<string, unknown> | null = null;
    const whereClauses: { sql: string; val?: unknown }[] = [];
    let isSingle = false;
    let isMaybeSingle = false;

    async function execute() {
      try {
        let sql = "";
        const params: unknown[] = [];

        if (mode === "insert" && insertData) {
          const keys = Object.keys(insertData);
          const cols = keys.map((k) => `"${k}"`).join(", ");
          const placeholders = keys.map((k, i) => {
            const val = insertData![k];
            if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
              params.push(JSON.stringify(val));
              return `$${i + 1}::jsonb`;
            } else {
              params.push(val);
              return `$${i + 1}`;
            }
          }).join(", ");

          sql = `INSERT INTO public."${table}" (${cols}) VALUES (${placeholders}) RETURNING *;`;
        } else if (mode === "update" && updateData) {
          const keys = Object.keys(updateData);
          const setParts = keys.map((k, i) => {
            const val = updateData![k];
            if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
              params.push(JSON.stringify(val));
              return `"${k}" = $${i + 1}::jsonb`;
            } else {
              params.push(val);
              return `"${k}" = $${i + 1}`;
            }
          }).join(", ");

          let whereSql = "";
          if (whereClauses.length > 0) {
            whereSql = " WHERE " + whereClauses.map((c) => {
              if (c.val !== undefined) {
                params.push(c.val);
                return c.sql.replace("$PARAM", `$${params.length}`);
              }
              return c.sql;
            }).join(" AND ");
          }

          sql = `UPDATE public."${table}" SET ${setParts}${whereSql} RETURNING *;`;
        } else {
          // select
          let whereSql = "";
          if (whereClauses.length > 0) {
            whereSql = " WHERE " + whereClauses.map((c) => {
              if (c.val !== undefined) {
                params.push(c.val);
                return c.sql.replace("$PARAM", `$${params.length}`);
              }
              return c.sql;
            }).join(" AND ");
          }
          sql = `SELECT * FROM public."${table}"${whereSql};`;
        }

        const res = await pgDb.query(sql, params);
        const rows = res.rows as Record<string, unknown>[];

        if (isSingle) {
          if (rows.length === 0) {
            return { data: null, error: { message: "No rows returned" } };
          }
          return { data: rows[0], error: null };
        }
        if (isMaybeSingle) {
          if (rows.length === 0) {
            return { data: null, error: null };
          }
          return { data: rows[0], error: null };
        }

        return { data: rows, error: null };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { data: null, error: { message } };
      }
    }

    type Builder = {
      select: () => Builder;
      insert: (data: unknown) => Builder;
      update: (data: unknown) => Builder;
      eq: (col: string, val: unknown) => Builder;
      neq: (col: string, val: unknown) => Builder;
      is: (col: string, val: unknown) => Builder;
      gt: (col: string, val: unknown) => Builder;
      gte: (col: string, val: unknown) => Builder;
      lte: (col: string, val: unknown) => Builder;
      order: () => Builder;
      single: () => Promise<{ data: unknown; error: unknown }>;
      maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      then: (
        onfulfilled?: (val: { data: unknown; error: unknown }) => unknown,
        onrejected?: (err: unknown) => unknown,
      ) => Promise<unknown>;
    };

    const builder: Builder = {
      select() {
        return builder;
      },
      insert(data: unknown) {
        mode = "insert";
        insertData = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
        return builder;
      },
      update(data: unknown) {
        mode = "update";
        updateData = data as Record<string, unknown>;
        return builder;
      },
      eq(col: string, val: unknown) {
        whereClauses.push({ sql: `"${col}" = $PARAM`, val });
        return builder;
      },
      neq(col: string, val: unknown) {
        whereClauses.push({ sql: `"${col}" != $PARAM`, val });
        return builder;
      },
      is(col: string, val: unknown) {
        if (val === null) {
          whereClauses.push({ sql: `"${col}" is null` });
        } else {
          whereClauses.push({ sql: `"${col}" = $PARAM`, val });
        }
        return builder;
      },
      gt(col: string, val: unknown) {
        whereClauses.push({ sql: `"${col}" > $PARAM`, val });
        return builder;
      },
      gte(col: string, val: unknown) {
        whereClauses.push({ sql: `"${col}" >= $PARAM`, val });
        return builder;
      },
      lte(col: string, val: unknown) {
        whereClauses.push({ sql: `"${col}" <= $PARAM`, val });
        return builder;
      },
      order() {
        return builder;
      },
      single() {
        isSingle = true;
        return execute();
      },
      maybeSingle() {
        isMaybeSingle = true;
        return execute();
      },
      then(onfulfilled, onrejected) {
        return execute().then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  return {
    from,
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string) {
            try {
              await pgDb.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, path]);
              return { data: { path }, error: null };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              return { data: null, error: { message } };
            }
          },
        };
      },
    },
  } as unknown as SupabaseClient<Database>;
}

beforeAll(async () => {
  ({ db, as } = await createTestDb());
  adapter = createPgliteSupabaseAdapter(db);

  await db.exec(`
    insert into auth.users (id) values
      ('${OFFICE_USER}'),
      ('${TECH_A_USER}'),
      ('${TECH_B_USER}'),
      ('${REVIEWER_USER}');

    insert into people (id, full_name, initials, mobile, email, user_id, roles) values
      ('${OFFICE_PERSON}', 'Anitha Coordinator', 'ACO', '+91 99000 11111', 'anitha@bita.example', '${OFFICE_USER}', '{office}'),
      ('${TECH_A_PERSON}', 'Ramesh Technician', 'RMT', '+91 98000 22222', 'ramesh@bita.example', '${TECH_A_USER}', '{technician}'),
      ('${TECH_B_PERSON}', 'Suresh Technician', 'SRT', '+91 97000 33333', 'suresh@bita.example', '${TECH_B_USER}', '{technician}'),
      ('${REVIEWER_PERSON}', 'Dr. Radhakrishnan Reviewer', 'SRK', '+91 99000 44444', 'srk@bita.example', '${REVIEWER_USER}', '{reviewer,management}');

    insert into customers (id, name, code, payment_terms_days) values
      ('${CUSTOMER_ID}', 'Apex Forgings Pvt Ltd', 'AFPL', 30);

    insert into jobs (id, job_no, customer_id, scope, test_methods, status) values
      ('${JOB_ID}', 'BITA/26-27/0999', '${CUSTOMER_ID}', 'Ultrasonic testing of shafts', '{UT}', 'scheduled');

    insert into assignments (id, job_id, person_id, work_date) values
      ('${ASSIGNMENT_B_ID}', '${JOB_ID}', '${TECH_B_PERSON}', current_date);
  `);
}, 60_000);

describe("Field API tests on PGlite (T42)", () => {
  let createdPairingCode: string;
  let activeDeviceId: string;
  let activeSecret: string;

  it("1. creates and redeems pairing code, rejects duplicate and expired redeems", async () => {
    resetRateLimitsForTesting();

    // 1a. createPairingCode: inserts into pairing_codes table
    const result = await createPairingCode(adapter, {
      personId: TECH_A_PERSON,
      createdBy: OFFICE_PERSON,
    });
    expect(result.id).toBeDefined();
    expect(result.code).toMatch(/^\d{6}$/);
    createdPairingCode = result.code;

    // Verify row in real DB
    const codeQuery = await db.query<{ person_id: string; used_at: string | null }>(
      "select person_id, used_at from pairing_codes where id = $1",
      [result.id],
    );
    expect(codeQuery.rows[0].person_id).toBe(TECH_A_PERSON);
    expect(codeQuery.rows[0].used_at).toBeNull();

    // 1b. redeemPairingCode: creates device and marks code used
    const redeemResult = await redeemPairingCode(adapter, {
      code: createdPairingCode,
      deviceName: "Pixel 8 Pro",
      pushToken: "ExponentPushToken[test-123]",
      ip: "192.168.1.10",
    });

    expect(redeemResult.ok).toBe(true);
    if (!redeemResult.ok) throw new Error("Expected redeem to succeed");

    activeDeviceId = redeemResult.deviceId;
    activeSecret = redeemResult.secret;
    expect(redeemResult.technician.id).toBe(TECH_A_PERSON);
    expect(redeemResult.technician.name).toBe("Ramesh Technician");

    // Verify in real DB: pairing_codes.used_at is set, and technician_devices row exists
    const updatedCode = await db.query<{ used_at: string | null }>(
      "select used_at from pairing_codes where id = $1",
      [result.id],
    );
    expect(updatedCode.rows[0].used_at).not.toBeNull();

    const deviceQuery = await db.query<{ person_id: string; device_name: string; secret_hash: string }>(
      "select person_id, device_name, secret_hash from technician_devices where id = $1",
      [activeDeviceId],
    );
    expect(deviceQuery.rows[0].person_id).toBe(TECH_A_PERSON);
    expect(deviceQuery.rows[0].device_name).toBe("Pixel 8 Pro");
    expect(deviceQuery.rows[0].secret_hash).toBe(sha256(activeSecret));

    // 1c. Second redeem of the same code fails
    const secondRedeem = await redeemPairingCode(adapter, {
      code: createdPairingCode,
      deviceName: "Pixel 8 Pro",
      ip: "192.168.1.10",
    });
    expect(secondRedeem.ok).toBe(false);
    if (secondRedeem.ok) throw new Error("Expected second redeem to fail");
    expect(secondRedeem.status).toBe(400);
    expect(secondRedeem.error).toMatch(/Invalid or expired/i);

    // 1d. Expired code fails
    const expiredCode = "998877";
    await db.query(
      `insert into pairing_codes (person_id, code_hash, expires_at)
       values ($1, $2, now() - interval '30 minutes')`,
      [TECH_A_PERSON, sha256(expiredCode)],
    );

    const expiredRedeem = await redeemPairingCode(adapter, {
      code: expiredCode,
      deviceName: "Old Phone",
      ip: "192.168.1.11",
    });
    expect(expiredRedeem.ok).toBe(false);
    if (expiredRedeem.ok) throw new Error("Expected expired redeem to fail");
    expect(expiredRedeem.status).toBe(400);
    expect(expiredRedeem.error).toMatch(/Invalid or expired/i);
  });

  it("2. authenticateDevice: right secret ok, wrong secret 401, revoked_at set 401", async () => {
    // 2a. Right secret -> ok, touches last_seen_at
    const authSuccess = await authenticateDevice(adapter, `Bearer ${activeDeviceId}.${activeSecret}`);
    expect(authSuccess.ok).toBe(true);
    if (!authSuccess.ok) throw new Error("Expected auth to succeed");
    expect(authSuccess.auth.deviceId).toBe(activeDeviceId);
    expect(authSuccess.auth.technician.id).toBe(TECH_A_PERSON);

    const deviceRow = await db.query<{ last_seen_at: string | null }>(
      "select last_seen_at from technician_devices where id = $1",
      [activeDeviceId],
    );
    expect(deviceRow.rows[0].last_seen_at).not.toBeNull();

    // 2b. Wrong secret -> 401
    const authWrong = await authenticateDevice(adapter, `Bearer ${activeDeviceId}.incorrectsecret1234567890`);
    expect(authWrong.ok).toBe(false);
    if (authWrong.ok) throw new Error("Expected wrong secret to fail");
    expect(authWrong.status).toBe(401);
    expect(authWrong.error).toMatch(/Invalid device credentials/i);

    // 2c. Non-existent device -> 401
    const authUnknown = await authenticateDevice(
      adapter,
      "Bearer 00000000-0000-0000-0000-000000000099.somesupersupersupersupersupersupersupersupersupersupersuper",
    );
    expect(authUnknown.ok).toBe(false);
    if (authUnknown.ok) throw new Error("Expected unknown device to fail");
    expect(authUnknown.status).toBe(401);

    // 2d. Revoked device -> 401
    await db.query("update technician_devices set revoked_at = now() where id = $1", [activeDeviceId]);
    const authRevoked = await authenticateDevice(adapter, `Bearer ${activeDeviceId}.${activeSecret}`);
    expect(authRevoked.ok).toBe(false);
    if (authRevoked.ok) throw new Error("Expected revoked device to fail");
    expect(authRevoked.status).toBe(401);
    expect(authRevoked.error).toMatch(/revoked/i);

    // Un-revoke for subsequent tests
    await db.query("update technician_devices set revoked_at = null where id = $1", [activeDeviceId]);
  });

  it("3. Technician A cannot acknowledge, start, report or upload on Technician B's assignment (404)", async () => {
    // Technician A attempts to act on Technician B's assignment ASSIGNMENT_B_ID:

    // 3a. Acknowledge -> 404
    const ackRes = await acknowledgeAssignment(adapter, ASSIGNMENT_B_ID, TECH_A_PERSON);
    expect("error" in ackRes && ackRes.status).toBe(404);

    // 3b. Start -> 404
    const startRes = await startAssignment(adapter, ASSIGNMENT_B_ID, TECH_A_PERSON);
    expect("error" in startRes && startRes.status).toBe(404);

    // 3c. Submit inspection -> 404
    const reportRes = await submitInspectionReport(adapter, ASSIGNMENT_B_ID, TECH_A_PERSON, {
      method: "UT",
      readings: {},
      draft: true,
    });
    expect("error" in reportRes && reportRes.status).toBe(404);

    // 3d. Upload attachment -> 404
    const uploadRes = await uploadFieldAttachment(adapter, ASSIGNMENT_B_ID, TECH_A_PERSON, {
      fileBuffer: Buffer.from("dummy-photo-content"),
      fileName: "defect.jpg",
      contentType: "image/jpeg",
    });
    expect("error" in uploadRes && uploadRes.status).toBe(404);

    // Verify database state: assignment B remains untouched
    const checkB = await db.query<{ acknowledged_at: string | null; started_at: string | null; completed_at: string | null }>(
      "select acknowledged_at, started_at, completed_at from assignments where id = $1",
      [ASSIGNMENT_B_ID],
    );
    expect(checkB.rows[0].acknowledged_at).toBeNull();
    expect(checkB.rows[0].started_at).toBeNull();
    expect(checkB.rows[0].completed_at).toBeNull();
  });

  it("4. Submit with missing required fields stays draft; complete submit updates assignment & job; resubmit returns 409", async () => {
    // Technician B operates on their own assignment ASSIGNMENT_B_ID

    // 4a. Acknowledge and start own assignment
    const ackB = await acknowledgeAssignment(adapter, ASSIGNMENT_B_ID, TECH_B_PERSON);
    expect("ok" in ackB && ackB.ok).toBe(true);

    const startB = await startAssignment(adapter, ASSIGNMENT_B_ID, TECH_B_PERSON);
    expect("ok" in startB && startB.ok).toBe(true);

    // 4b. Submit with missing mandatory fields and draft=false -> stays draft
    const incompleteReadings = {
      equipment: "Olympus EPOCH 650",
      couplant: "Oil",
      // missing: probe, reference_blocks, screen_range, sensitivity, etc.
    };
    const draftSubmitRes = await submitInspectionReport(adapter, ASSIGNMENT_B_ID, TECH_B_PERSON, {
      method: "UT",
      readings: incompleteReadings,
      observations: "Partial scan conducted",
      draft: false,
    });

    expect("ok" in draftSubmitRes && draftSubmitRes.ok).toBe(true);
    if ("ok" in draftSubmitRes) {
      expect(draftSubmitRes.missingFields.length).toBeGreaterThan(0);
      expect(draftSubmitRes.submittedAt).toBeNull();
    }

    // Verify in real DB: inspection exists but submitted_at is null, job is still scheduled
    const dbInsp1 = await db.query<{ submitted_at: string | null; missing_fields: string[] }>(
      "select submitted_at, missing_fields from inspections where assignment_id = $1",
      [ASSIGNMENT_B_ID],
    );
    expect(dbInsp1.rows[0].submitted_at).toBeNull();
    expect(dbInsp1.rows[0].missing_fields.length).toBeGreaterThan(0);

    const dbJob1 = await db.query<{ status: string }>("select status from jobs where id = $1", [JOB_ID]);
    expect(dbJob1.rows[0].status).toBe("scheduled");

    // 4c. Complete submit with all required fields (UT)
    const completeReadings = {
      client: "Apex Forgings Pvt Ltd",
      project: "Rotor Shafts NDT",
      inspection_site: "Customer Works",
      inspection_date: "2026-11-07",
      equipment: "Olympus EPOCH 650",
      equipment_serial: "EP-9912",
      probes: "Single Crystal 2 MHz",
      reference_blocks: "V1, V2 Blocks",
      screen_range: "0-200 mm",
      sensitivity: "80% FSH",
      scanning_level: "Plus 6 dB",
      couplant: "Servo Machine Oil",
      surface_condition: "Smooth ground",
      standard: "ASME Section V Article 4",
      acceptance_criteria: "ASME Section VIII Div 1",
      technicians: [
        {
          name: "Suresh Technician",
          qualification: "UT Level II",
          certificate_no: "UT-IND-2024-081",
          issued_on: "2024-01-15",
          valid_until: "2029-01-14",
        },
      ],
      items: [
        {
          description: "Forged Rotor Shaft #1",
          quantity: 1,
          observations: "No recordable indications detected. 100% volumetric inspection acceptable.",
        },
      ],
    };

    const completeSubmitRes = await submitInspectionReport(adapter, ASSIGNMENT_B_ID, TECH_B_PERSON, {
      method: "UT",
      readings: completeReadings,
      observations: "Inspection completed satisfactorily.",
      draft: false,
    });

    expect("ok" in completeSubmitRes && completeSubmitRes.ok).toBe(true);
    if ("ok" in completeSubmitRes) {
      expect(completeSubmitRes.missingFields).toEqual([]);
      expect(completeSubmitRes.submittedAt).not.toBeNull();
    }

    // Verify in real DB: inspection.submitted_at is set, assignment.completed_at is set, job.status is 'inspection_done'
    const dbInsp2 = await db.query<{ submitted_at: string | null }>(
      "select submitted_at from inspections where assignment_id = $1",
      [ASSIGNMENT_B_ID],
    );
    expect(dbInsp2.rows[0].submitted_at).not.toBeNull();

    const dbAssign2 = await db.query<{ completed_at: string | null }>(
      "select completed_at from assignments where id = $1",
      [ASSIGNMENT_B_ID],
    );
    expect(dbAssign2.rows[0].completed_at).not.toBeNull();

    const dbJob2 = await db.query<{ status: string }>("select status from jobs where id = $1", [JOB_ID]);
    expect(dbJob2.rows[0].status).toBe("inspection_done");

    // 4d. Re-submitting before approval succeeds and logs a diff to inspection_edits (Phase 2 / A1)
    const updatedReadings = {
      ...completeReadings,
      couplant: "Special Ultrasonic Gel Batch #4",
    };
    const resubmitRes = await submitInspectionReport(adapter, ASSIGNMENT_B_ID, TECH_B_PERSON, {
      method: "UT",
      readings: updatedReadings,
      observations: "Updated scan with higher viscosity couplant.",
      draft: false,
    });
    expect("ok" in resubmitRes && resubmitRes.ok).toBe(true);

    // Verify inspection_edits in real DB
    const edits = await db.query<{
      edited_by: string;
      diff: Record<string, { old: unknown; new: unknown }>;
    }>("select edited_by, diff from inspection_edits where assignment_id = $1", [ASSIGNMENT_B_ID]);
    expect(edits.rows.length).toBeGreaterThan(0);
    expect(edits.rows[0].edited_by).toBe(TECH_B_PERSON);
    expect(edits.rows[0].diff.couplant).toBeDefined();
    expect(edits.rows[0].diff.couplant.old).toBe("Servo Machine Oil");
    expect(edits.rows[0].diff.couplant.new).toBe("Special Ultrasonic Gel Batch #4");

    // 4d-2. Once technical reviewer approves report, phone editing is locked (409)
    await db.query(
      `insert into reports (job_id, inspection_id, method, report_no, status, approved_at, approved_by)
       values ($1, $2, 'UT', 'BITA/26-27/UT-0099', 'approved', now(), $3)`,
      [JOB_ID, dbInsp2.rows[0].submitted_at ? (await db.query<{ id: string }>("select id from inspections where assignment_id = $1", [ASSIGNMENT_B_ID])).rows[0].id : null, REVIEWER_PERSON],
    );

    const lockedRes = await submitInspectionReport(adapter, ASSIGNMENT_B_ID, TECH_B_PERSON, {
      method: "UT",
      readings: updatedReadings,
      draft: false,
    });
    expect("error" in lockedRes && lockedRes.status).toBe(409);
    if ("error" in lockedRes) {
      expect(lockedRes.error).toMatch(/locked|approved/i);
    }

    // 4e. Successful photo upload by Technician B on their own assignment (includes include_in_report default true)
    const uploadB = await uploadFieldAttachment(adapter, ASSIGNMENT_B_ID, TECH_B_PERSON, {
      fileBuffer: Buffer.from("fake-photo-data"),
      fileName: "shaft_scan.jpg",
      contentType: "image/jpeg",
      caption: "Shaft ultrasonic scan A-scan display",
      kind: "site_photo",
    });
    expect("ok" in uploadB && uploadB.ok).toBe(true);
    if ("ok" in uploadB) {
      expect(uploadB.storagePath).toMatch(/^jobs\//);
      const attRow = await db.query<{ caption: string; storage_path: string; include_in_report: boolean }>(
        "select caption, storage_path, include_in_report from attachments where id = $1",
        [uploadB.attachmentId],
      );
      expect(attRow.rows[0].caption).toBe("Shaft ultrasonic scan A-scan display");
      expect(attRow.rows[0].include_in_report).toBe(true);
    }

    // 4f. File exceeding 6 MB is rejected with 400
    const hugeBuffer = Buffer.alloc(7 * 1024 * 1024);
    const hugeUpload = await uploadFieldAttachment(adapter, ASSIGNMENT_B_ID, TECH_B_PERSON, {
      fileBuffer: hugeBuffer,
      fileName: "huge.jpg",
      contentType: "image/jpeg",
    });
    expect("error" in hugeUpload && hugeUpload.status).toBe(400);
  });

  it("5. Message kinds: delay accepted, unknown kind rejected with 400, empty body rejected with 400", async () => {
    // 5a. Valid delay message
    const delayMsg = await createTechnicianMessage(adapter, TECH_A_PERSON, {
      kind: "delay",
      body: "Stuck in highway checkpoint, will reach site by 11:30 AM",
      jobId: JOB_ID,
    });
    expect("ok" in delayMsg && delayMsg.ok).toBe(true);
    if ("ok" in delayMsg) {
      expect(delayMsg.messageId).toBeDefined();

      const dbMsg = await db.query<{ kind: string; body: string; person_id: string }>(
        "select kind, body, person_id from technician_messages where id = $1",
        [delayMsg.messageId],
      );
      expect(dbMsg.rows[0].kind).toBe("delay");
      expect(dbMsg.rows[0].body).toBe("Stuck in highway checkpoint, will reach site by 11:30 AM");
      expect(dbMsg.rows[0].person_id).toBe(TECH_A_PERSON);
    }

    // 5b. Invalid message kind -> 400
    const invalidKindMsg = await createTechnicianMessage(adapter, TECH_A_PERSON, {
      kind: "urgent_call" as unknown as Enums<"technician_message_kind">,
      body: "Please call me immediately",
    });
    expect("error" in invalidKindMsg && invalidKindMsg.status).toBe(400);
    if ("error" in invalidKindMsg) {
      expect(invalidKindMsg.error).toMatch(/Invalid message kind/i);
    }

    // 5c. Empty body -> 400
    const emptyBodyMsg = await createTechnicianMessage(adapter, TECH_A_PERSON, {
      kind: "delay",
      body: "   ",
    });
    expect("error" in emptyBodyMsg && emptyBodyMsg.status).toBe(400);
    if ("error" in emptyBodyMsg) {
      expect(emptyBodyMsg.error).toMatch(/body cannot be empty/i);
    }
  });

  it("6. RLS: a logged-in staff user cannot insert pairing_codes directly", async () => {
    // Authenticated office user attempts to insert directly into pairing_codes table
    await expect(
      as(
        OFFICE_USER,
        `insert into pairing_codes (person_id, code_hash, expires_at)
         values ($1, $2, now() + interval '15 minutes')`,
        [TECH_A_PERSON, sha256("112233")],
      ),
    ).rejects.toThrow();

    // But service role can insert directly (which is what getSupabaseAdmin() does)
    const serviceRes = await as<{ id: string }>(
      "service",
      `insert into pairing_codes (person_id, code_hash, expires_at)
       values ($1, $2, now() + interval '15 minutes')
       returning id`,
      [TECH_A_PERSON, sha256("112233")],
    );
    expect(serviceRes.rows[0].id).toBeDefined();

    // Authenticated office user CAN select from pairing_codes per staff_read policy
    const selectRes = await as<{ id: string }>(
      OFFICE_USER,
      "select id from pairing_codes where person_id = $1",
      [TECH_A_PERSON],
    );
    expect(selectRes.rows.length).toBeGreaterThan(0);
  });
});
