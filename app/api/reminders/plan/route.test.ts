import { describe, expect, it, beforeEach } from "vitest";
import { PATCH, POST } from "./route";

describe("Reminders Plan API Route (/api/reminders/plan)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.REMINDERS_CRON_SECRET = "test-secret-12345";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("POST returns 401 if no secret header is provided", async () => {
    const req = new Request("http://localhost/api/reminders/plan", {
      method: "POST",
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("POST returns 401 if wrong secret is provided", async () => {
    const req = new Request("http://localhost/api/reminders/plan", {
      method: "POST",
      headers: {
        "x-reminders-cron-secret": "wrong-secret",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("POST accepts Bearer token in Authorization header", async () => {
    const req = new Request("http://localhost/api/reminders/plan", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-secret-12345",
      },
    });

    // It will proceed past the auth check to Supabase connection
    const res = await POST(req);
    expect(res.status).not.toBe(401);
  });

  it("POST returns 500 if REMINDERS_CRON_SECRET is not configured on server", async () => {
    delete process.env.REMINDERS_CRON_SECRET;
    const req = new Request("http://localhost/api/reminders/plan", {
      method: "POST",
      headers: {
        "x-reminders-cron-secret": "test-secret-12345",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("REMINDERS_CRON_SECRET is not configured");
  });

  it("PATCH enforces REMINDERS_CRON_SECRET and validates reminder_id", async () => {
    const unauthReq = new Request("http://localhost/api/reminders/plan", {
      method: "PATCH",
      body: JSON.stringify({ reminder_id: "rem-1" }),
    });
    const unauthRes = await PATCH(unauthReq);
    expect(unauthRes.status).toBe(401);

    const badBodyReq = new Request("http://localhost/api/reminders/plan", {
      method: "PATCH",
      headers: {
        "x-reminders-cron-secret": "test-secret-12345",
      },
      body: JSON.stringify({}),
    });
    const badBodyRes = await PATCH(badBodyReq);
    expect(badBodyRes.status).toBe(400);
    const badBodyJson = await badBodyRes.json();
    expect(badBodyJson.error).toContain("reminder_id");
  });
});
