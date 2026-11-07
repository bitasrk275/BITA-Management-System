import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";
import {
  sha256,
  constantTimeCompare,
  generateRandomSecret,
  generatePairingCode,
} from "./crypto";
import {
  extractDeviceToken,
  authenticateDevice,
} from "./auth";
import {
  isRateLimited,
  recordFailedAttempt,
  resetRateLimitsForTesting,
  redeemPairingCode,
  createPairingCode,
} from "./pairing";
import {
  isValidExpoPushToken,
  sendExpoPushNotification,
  notifyTechnician,
} from "./notify";
import {
  verifyTechnicianAssignment,
  acknowledgeAssignment,
  startAssignment,
  submitInspectionReport,
  uploadFieldAttachment,
  createTechnicianMessage,
  getTechnicianJobs,
  MAX_PHOTO_BYTES,
} from "./assignments";

describe("Field App: crypto helpers", () => {
  it("sha256 creates deterministic 64-char hex strings", () => {
    const hash1 = sha256("123456");
    const hash2 = sha256("123456");
    const hash3 = sha256("654321");
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64);
  });

  it("constantTimeCompare correctly compares secrets", () => {
    const secret = "secret-token-12345";
    const secretHash = sha256(secret);

    expect(constantTimeCompare(secret, secretHash)).toBe(true);
    expect(constantTimeCompare("wrong-secret", secretHash)).toBe(false);
    expect(constantTimeCompare("", secretHash)).toBe(false);
  });

  it("generateRandomSecret produces 64-character hex strings", () => {
    const s1 = generateRandomSecret();
    const s2 = generateRandomSecret();
    expect(s1).toHaveLength(64);
    expect(s2).toHaveLength(64);
    expect(s1).not.toBe(s2);
  });

  it("generatePairingCode produces 6 numeric digits", () => {
    for (let i = 0; i < 20; i++) {
      const code = generatePairingCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("Field App: device authentication", () => {
  it("extractDeviceToken parses Bearer <deviceId>.<secret>", () => {
    expect(extractDeviceToken("Bearer dev123.sec456")).toEqual({
      deviceId: "dev123",
      secret: "sec456",
    });
    expect(extractDeviceToken("Bearer invalid-format")).toBeNull();
    expect(extractDeviceToken("Basic something")).toBeNull();
    expect(extractDeviceToken(null)).toBeNull();
  });

  it("authenticateDevice rejects missing or invalid header", async () => {
    const mockSupabase = {} as unknown as SupabaseClient<Database>;
    const res = await authenticateDevice(mockSupabase, null);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.error).toContain("Missing or invalid");
    }
  });

  it("authenticateDevice rejects unknown device", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await authenticateDevice(mockSupabase, "Bearer dev1.sec1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.error).toContain("Unknown or invalid device");
    }
  });

  it("authenticateDevice rejects revoked device", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "dev-1",
                person_id: "person-1",
                device_name: "Pixel 7",
                secret_hash: sha256("valid-secret"),
                push_token: null,
                revoked_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await authenticateDevice(mockSupabase, "Bearer dev-1.valid-secret");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.error).toContain("revoked");
    }
  });

  it("authenticateDevice rejects invalid secret", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "dev-1",
                person_id: "person-1",
                device_name: "Pixel 7",
                secret_hash: sha256("valid-secret"),
                push_token: null,
                revoked_at: null,
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await authenticateDevice(mockSupabase, "Bearer dev-1.wrong-secret");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.error).toContain("Invalid device credentials");
    }
  });

  it("authenticateDevice succeeds with valid secret, updates last_seen_at and loads technician", async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "technician_devices") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "dev-1",
                    person_id: "person-1",
                    device_name: "Pixel 7",
                    secret_hash: sha256("valid-secret"),
                    push_token: "ExponentPushToken[abc]",
                    revoked_at: null,
                  },
                  error: null,
                }),
              }),
            }),
            update: updateSpy,
          };
        }
        if (table === "people") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "person-1",
                    full_name: "Rajesh Kumar",
                    mobile: "+919876543210",
                    email: "rajesh@example.com",
                  },
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await authenticateDevice(mockSupabase, "Bearer dev-1.valid-secret");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.auth.deviceId).toBe("dev-1");
      expect(res.auth.technician.name).toBe("Rajesh Kumar");
      expect(res.auth.technician.phone).toBe("+919876543210");
    }
    expect(updateSpy).toHaveBeenCalled();
  });
});

describe("Field App: pairing & rate limiting", () => {
  beforeEach(() => {
    resetRateLimitsForTesting();
  });

  it("enforces 5 failed attempts per minute per IP limit", () => {
    const ip = "192.168.1.100";
    expect(isRateLimited(ip)).toBe(false);

    for (let i = 0; i < 4; i++) {
      recordFailedAttempt(ip);
      expect(isRateLimited(ip)).toBe(false);
    }

    recordFailedAttempt(ip); // 5th failed attempt
    expect(isRateLimited(ip)).toBe(true);

    // Another IP is unaffected
    expect(isRateLimited("192.168.1.101")).toBe(false);
  });

  it("createPairingCode inserts hashed 6-digit code with 15m expiration", async () => {
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "code-id-1" },
          error: null,
        }),
      }),
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await createPairingCode(mockSupabase, {
      personId: "person-123",
      createdBy: "staff-456",
    });

    expect(result.id).toBe("code-id-1");
    expect(result.code).toMatch(/^\d{6}$/);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

    const insertedPayload = insertSpy.mock.calls[0][0];
    expect(insertedPayload.person_id).toBe("person-123");
    expect(insertedPayload.created_by).toBe("staff-456");
    expect(insertedPayload.code_hash).toBe(sha256(result.code));
  });

  it("redeemPairingCode rejects non-6-digit code", async () => {
    const mockSupabase = {} as unknown as SupabaseClient<Database>;
    const res = await redeemPairingCode(mockSupabase, {
      code: "123",
      ip: "10.0.0.1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("6 numeric digits");
    }
  });

  it("redeemPairingCode rejects invalid or expired code", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              gt: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await redeemPairingCode(mockSupabase, {
      code: "123456",
      ip: "10.0.0.2",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("Invalid or expired");
    }
  });

  it("redeemPairingCode successfully redeems valid code and marks used", async () => {
    const code = "654321";
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: "code-row" }], error: null }),
        }),
      }),
    });
    const insertDeviceSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "new-device-id" },
          error: null,
        }),
      }),
    });

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "pairing_codes") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  gt: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: "pairing-row-1",
                        person_id: "person-999",
                        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                        used_at: null,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            update: updateSpy,
          };
        }
        if (table === "technician_devices") {
          return {
            insert: insertDeviceSpy,
          };
        }
        if (table === "people") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "person-999",
                    full_name: "Amit Sharma",
                  },
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await redeemPairingCode(mockSupabase, {
      code,
      deviceName: "Samsung Galaxy A54",
      pushToken: "ExponentPushToken[token123]",
      ip: "10.0.0.3",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.deviceId).toBe("new-device-id");
      expect(res.secret).toHaveLength(64);
      expect(res.technician.name).toBe("Amit Sharma");
      expect(res.technician.id).toBe("person-999");
    }

    expect(updateSpy).toHaveBeenCalled();
    const insertedDevice = insertDeviceSpy.mock.calls[0][0];
    expect(insertedDevice.person_id).toBe("person-999");
    expect(insertedDevice.device_name).toBe("Samsung Galaxy A54");
    expect(insertedDevice.push_token).toBe("ExponentPushToken[token123]");
    expect(insertedDevice.secret_hash).toBeDefined();
  });
});

describe("Field App: push notifications", () => {
  it("isValidExpoPushToken checks Expo token format", () => {
    expect(isValidExpoPushToken("ExponentPushToken[xxxx-yyyy]")).toBe(true);
    expect(isValidExpoPushToken("ExpoPushToken[xxxx-yyyy]")).toBe(true);
    expect(isValidExpoPushToken("not-a-token")).toBe(false);
    expect(isValidExpoPushToken(null)).toBe(false);
  });

  it("sendExpoPushNotification sends push to Expo API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ data: [{ status: "ok" }] }),
    });

    const result = await sendExpoPushNotification(
      {
        to: ["ExponentPushToken[abc]"],
        title: "New Job",
        body: "Inspection at Whitefield site",
        data: { jobId: "job-1" },
      },
      mockFetch as unknown as typeof fetch,
    );

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("notifyTechnician queries active devices and pushes", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({
                data: [{ push_token: "ExponentPushToken[dev1]" }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const res = await notifyTechnician(
      mockSupabase,
      "person-1",
      { title: "Job Assigned", body: "Job #123" },
      mockFetch as unknown as typeof fetch,
    );

    expect(res.ok).toBe(true);
    expect(res.count).toBe(1);
  });
});

describe("Field App: assignment operations & authorization checks", () => {
  it("verifyTechnicianAssignment returns null when assignment belongs to another technician", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "assign-1",
                person_id: "other-technician-id",
                job_id: "job-1",
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const assignment = await verifyTechnicianAssignment(
      mockSupabase,
      "assign-1",
      "calling-technician-id",
    );
    expect(assignment).toBeNull();
  });

  it("acknowledgeAssignment updates acknowledged_at", async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "assign-1",
                person_id: "tech-1",
                job_id: "job-1",
              },
              error: null,
            }),
          }),
        }),
        update: updateSpy,
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await acknowledgeAssignment(mockSupabase, "assign-1", "tech-1");
    expect("ok" in res && res.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledged_at: expect.any(String) }),
    );
  });

  it("startAssignment updates started_at", async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "assign-1",
                person_id: "tech-1",
                job_id: "job-1",
              },
              error: null,
            }),
          }),
        }),
        update: updateSpy,
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await startAssignment(mockSupabase, "assign-1", "tech-1");
    expect("ok" in res && res.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ started_at: expect.any(String) }),
    );
  });

  it("submitInspectionReport validates method and calculates missing fields", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "assignments") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "assign-1", person_id: "tech-1", job_id: "job-1" },
                }),
              }),
            }),
          };
        }
        if (table === "inspections") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "new-inspection-1" },
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await submitInspectionReport(mockSupabase, "assign-1", "tech-1", {
      method: "UT",
      readings: {}, // Empty readings
      draft: true,
    });

    expect("ok" in res && res.ok).toBe(true);
    if ("ok" in res && res.ok) {
      expect(res.draft).toBe(true);
      expect(res.missingFields.length).toBeGreaterThan(0);
      expect(res.submittedAt).toBeNull();
    }
  });

  it("submitInspectionReport final submission advances job to inspection_done when complete", async () => {
    const jobUpdateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const assignUpdateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "assignments") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "assign-1", person_id: "tech-1", job_id: "job-1" },
                }),
              }),
            }),
            update: assignUpdateSpy,
          };
        }
        if (table === "inspections") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "insp-1" },
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "jobs") {
          return {
            update: jobUpdateSpy,
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    // Full valid readings for DPT per fields.ts:
    const completeDptReadings = {
      client: "Acme Power",
      project: "Turbine Inspection",
      inspection_site: "Bengaluru Site A",
      inspection_date: "2026-11-06",
      component_description: "Turbine Blade #4",
      cleaner: "Cleaner 100",
      cleaner_batch: "B-12",
      penetrant: "Penetrant 200",
      penetrant_batch: "P-34",
      developer: "Developer 300",
      developer_batch: "D-56",
      standard: "ASME Sec V",
      dwell_time: "15 mins",
      developing_time: "10 mins",
      technicians: [
        {
          name: "Ravi Kumar",
          qualification: "Level II",
          certificate_no: "NDT-2026-01",
          issued_on: "2024-01-01",
          valid_until: "2027-01-01",
        },
      ],
      items: [
        {
          description: "Weld seam A1",
          quantity: 1,
          observations: "No surface breaking discontinuities observed",
        },
      ],
    };

    const res = await submitInspectionReport(mockSupabase, "assign-1", "tech-1", {
      method: "DPT",
      readings: completeDptReadings,
      draft: false,
    });

    expect("ok" in res && res.ok).toBe(true);
    if ("ok" in res && res.ok) {
      expect(res.draft).toBe(false);
      expect(res.missingFields).toEqual([]);
      expect(res.submittedAt).toBeDefined();
    }

    expect(jobUpdateSpy).toHaveBeenCalledWith({ status: "inspection_done" });
    expect(assignUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ completed_at: expect.any(String) }),
    );
  });

  it("uploadFieldAttachment rejects files over 6 MB", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "assign-1", person_id: "tech-1", job_id: "job-1" },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const largeBuffer = Buffer.alloc(MAX_PHOTO_BYTES + 10);
    const res = await uploadFieldAttachment(mockSupabase, "assign-1", "tech-1", {
      fileBuffer: largeBuffer,
      fileName: "large.jpg",
      contentType: "image/jpeg",
    });

    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("6 MB");
    }
  });

  it("uploadFieldAttachment uploads valid photo under 6 MB to documents/jobs/<job id>/", async () => {
    const uploadSpy = vi.fn().mockResolvedValue({ error: null });
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "att-1" },
          error: null,
        }),
      }),
    });

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "assignments") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "assign-1", person_id: "tech-1", job_id: "job-888" },
                }),
              }),
            }),
          };
        }
        if (table === "inspections") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: "insp-888" } }),
              }),
            }),
          };
        }
        if (table === "attachments") {
          return {
            insert: insertSpy,
          };
        }
        return {};
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: uploadSpy,
        }),
      },
    } as unknown as SupabaseClient<Database>;

    const buffer = Buffer.from("fake-image-bytes");
    const res = await uploadFieldAttachment(mockSupabase, "assign-1", "tech-1", {
      fileBuffer: buffer,
      fileName: "defect photo.jpg",
      contentType: "image/jpeg",
      caption: "Crack on pipe elbow",
      kind: "defect_photo",
    });

    expect("ok" in res && res.ok).toBe(true);
    if ("ok" in res && res.ok) {
      expect(res.attachmentId).toBe("att-1");
      expect(res.storagePath).toMatch(/^jobs\/job-888\/\d+-defect_photo\.jpg$/);
    }
    expect(uploadSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^jobs\/job-888\//),
      buffer,
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
  });

  it("createTechnicianMessage records messages with valid kinds", async () => {
    const insertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "msg-123" },
          error: null,
        }),
      }),
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient<Database>;

    const res = await createTechnicianMessage(mockSupabase, "tech-1", {
      kind: "equipment_problem",
      body: "UT probe cable is damaged",
      jobId: "job-55",
    });

    expect("ok" in res && res.ok).toBe(true);
    if ("ok" in res && res.ok) {
      expect(res.messageId).toBe("msg-123");
    }
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        person_id: "tech-1",
        kind: "equipment_problem",
        body: "UT probe cable is damaged",
        job_id: "job-55",
      }),
    );
  });

  it("createTechnicianMessage rejects invalid message kind or empty body", async () => {
    const mockSupabase = {} as unknown as SupabaseClient<Database>;
    const res1 = await createTechnicianMessage(mockSupabase, "tech-1", {
      kind: "invalid-kind" as unknown as "other",
      body: "hello",
    });
    expect("error" in res1).toBe(true);

    const res2 = await createTechnicianMessage(mockSupabase, "tech-1", {
      kind: "site_issue",
      body: "   ",
    });
    expect("error" in res2).toBe(true);
  });

  it("getTechnicianJobs loads assignments, equipment, and inspection status", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "assignments") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: "assign-1",
                        job_id: "job-1",
                        person_id: "tech-1",
                        work_date: "2026-11-06",
                        notes: "Morning shift",
                        acknowledged_at: "2026-11-06T08:00:00Z",
                        started_at: "2026-11-06T09:00:00Z",
                        completed_at: null,
                        jobs: {
                          id: "job-1",
                          job_no: "BITA/26-27/0010",
                          site: "Peenya Industrial Area",
                          scope: "Weld Testing",
                          test_methods: ["UT"],
                          customers: { id: "c-1", name: "Apex Fabricators" },
                        },
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "assignment_equipment") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    assignment_id: "assign-1",
                    equipment: {
                      id: "eq-1",
                      kind: "ut_flaw_detector",
                      model: "EPOCH 650",
                      serial_no: "SN-9999",
                      calibration_due: "2027-05-01",
                    },
                  },
                ],
              }),
            }),
          };
        }
        if (table === "inspections") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "insp-1",
                    assignment_id: "assign-1",
                    method: "UT",
                    missing_fields: ["couplant"],
                    observations: "Draft notes",
                    readings: {},
                    submitted_at: null,
                  },
                ],
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient<Database>;

    const jobs = await getTechnicianJobs(mockSupabase, "tech-1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobNo).toBe("BITA/26-27/0010");
    expect(jobs[0].customerName).toBe("Apex Fabricators");
    expect(jobs[0].equipment).toHaveLength(1);
    expect(jobs[0].equipment[0].model).toBe("EPOCH 650");
    expect(jobs[0].inspection?.status).toBe("draft");
    expect(jobs[0].inspection?.missingFields).toEqual(["couplant"]);
  });
});
