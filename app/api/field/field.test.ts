import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../lib/db/types";
import { POST as pairRoute } from "./pair/route";
import { PUT as pushTokenRoute } from "./push-token/route";
import { GET as jobsRoute } from "./jobs/route";
import { POST as ackRoute } from "./assignments/[id]/acknowledge/route";
import { POST as startRoute } from "./assignments/[id]/start/route";
import { GET as templateRoute } from "./report-template/[method]/route";
import { POST as reportRoute } from "./assignments/[id]/report/route";
import { POST as photosRoute } from "./assignments/[id]/photos/route";
import { POST as messagesRoute } from "./messages/route";
import * as authModule from "../../../lib/field/auth";
import * as pairingModule from "../../../lib/field/pairing";
import * as assignmentsModule from "../../../lib/field/assignments";
import * as serviceModule from "../../../lib/field/service";

describe("Field API routes", () => {
  const mockSupabase = {} as unknown as SupabaseClient<Database>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(serviceModule, "getSupabaseAdmin").mockReturnValue(mockSupabase);
  });

  describe("POST /api/field/pair", () => {
    it("returns 400 when code is invalid", async () => {
      vi.spyOn(pairingModule, "redeemPairingCode").mockResolvedValue({
        ok: false,
        status: 400,
        error: "Pairing code must be 6 numeric digits.",
      });

      const req = new Request("http://localhost/api/field/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "12" }),
      });

      const res = await pairRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("6 numeric digits");
    });

    it("returns 200 with credentials on successful pairing", async () => {
      vi.spyOn(pairingModule, "redeemPairingCode").mockResolvedValue({
        ok: true,
        deviceId: "dev-abc",
        secret: "sec-xyz",
        technician: { id: "tech-1", name: "Suresh Rao" },
      });

      const req = new Request("http://localhost/api/field/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456", deviceName: "Nokia G42" }),
      });

      const res = await pairRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.deviceId).toBe("dev-abc");
      expect(json.secret).toBe("sec-xyz");
      expect(json.technician.name).toBe("Suresh Rao");
    });
  });

  describe("PUT /api/field/push-token", () => {
    it("updates push token when authorized", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      const updateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const customSupabase = {
        from: vi.fn().mockReturnValue({
          update: updateSpy,
        }),
      } as unknown as SupabaseClient<Database>;

      vi.spyOn(serviceModule, "getSupabaseAdmin").mockReturnValue(customSupabase);

      const req = new Request("http://localhost/api/field/push-token", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dev-1.sec-1",
        },
        body: JSON.stringify({ pushToken: "ExponentPushToken[new-token]" }),
      });

      const res = await pushTokenRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe("Authorization enforcement", () => {
    it("returns 401 when Authorization header is missing on protected routes", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: false,
        status: 401,
        error: "Missing or invalid authorization header.",
      });

      const req = new Request("http://localhost/api/field/jobs", {
        headers: {},
      });

      const res = await jobsRoute(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain("Missing or invalid");
    });
  });

  describe("GET /api/field/jobs", () => {
    it("returns jobs when authorized", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      vi.spyOn(assignmentsModule, "getTechnicianJobs").mockResolvedValue([
        {
          id: "assign-1",
          jobId: "job-1",
          jobNo: "BITA/26-27/0001",
          customerName: "L&T Heavy",
          site: "Site A",
          scope: "Testing",
          testMethods: ["UT"],
          workDate: "2026-11-06",
          notes: null,
          acknowledgedAt: null,
          startedAt: null,
          completedAt: null,
          equipment: [],
          inspection: null,
        },
      ]);

      const req = new Request("http://localhost/api/field/jobs", {
        headers: { Authorization: "Bearer dev-1.sec-1" },
      });

      const res = await jobsRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveLength(1);
      expect(json[0].jobNo).toBe("BITA/26-27/0001");
    });
  });

  describe("POST /api/field/assignments/:id/acknowledge", () => {
    it("returns 404 if assignment belongs to another technician", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      vi.spyOn(assignmentsModule, "acknowledgeAssignment").mockResolvedValue({
        error: "Assignment not found",
        status: 404,
      });

      const req = new Request("http://localhost/api/field/assignments/other-id/acknowledge", {
        method: "POST",
        headers: { Authorization: "Bearer dev-1.sec-1" },
      });

      const res = await ackRoute(req, {
        params: Promise.resolve({ id: "other-id" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 200 with timestamp when acknowledged", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      const now = new Date().toISOString();
      vi.spyOn(assignmentsModule, "acknowledgeAssignment").mockResolvedValue({
        ok: true,
        acknowledgedAt: now,
      });

      const req = new Request("http://localhost/api/field/assignments/assign-1/acknowledge", {
        method: "POST",
        headers: { Authorization: "Bearer dev-1.sec-1" },
      });

      const res = await ackRoute(req, {
        params: Promise.resolve({ id: "assign-1" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.acknowledgedAt).toBe(now);
    });
  });

  describe("POST /api/field/assignments/:id/start", () => {
    it("returns 200 with startedAt when started", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      const now = new Date().toISOString();
      vi.spyOn(assignmentsModule, "startAssignment").mockResolvedValue({
        ok: true,
        startedAt: now,
      });

      const req = new Request("http://localhost/api/field/assignments/assign-1/start", {
        method: "POST",
        headers: { Authorization: "Bearer dev-1.sec-1" },
      });

      const res = await startRoute(req, {
        params: Promise.resolve({ id: "assign-1" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.startedAt).toBe(now);
    });
  });

  describe("POST /api/field/assignments/:id/report", () => {
    it("submits inspection report", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      vi.spyOn(assignmentsModule, "submitInspectionReport").mockResolvedValue({
        ok: true,
        id: "insp-1",
        draft: true,
        missingFields: [],
        submittedAt: null,
      });

      const req = new Request("http://localhost/api/field/assignments/assign-1/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dev-1.sec-1",
        },
        body: JSON.stringify({
          method: "UT",
          readings: {},
          draft: true,
        }),
      });

      const res = await reportRoute(req, {
        params: Promise.resolve({ id: "assign-1" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.id).toBe("insp-1");
    });
  });

  describe("GET /api/field/report-template/:method", () => {
    it("returns field definitions for valid method", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      const req = new Request("http://localhost/api/field/report-template/UT", {
        headers: { Authorization: "Bearer dev-1.sec-1" },
      });

      const res = await templateRoute(req, {
        params: Promise.resolve({ method: "UT" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.method).toBe("UT");
      expect(json.fields.length).toBeGreaterThan(0);
      expect(json.repeatingGroups).toHaveLength(2);
    });

    it("returns 400 for unknown method", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      const req = new Request("http://localhost/api/field/report-template/UNKNOWN", {
        headers: { Authorization: "Bearer dev-1.sec-1" },
      });

      const res = await templateRoute(req, {
        params: Promise.resolve({ method: "UNKNOWN" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/field/assignments/:id/photos", () => {
    it("rejects uploads missing file", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      const formData = new FormData();
      formData.append("caption", "Test caption");

      const req = new Request("http://localhost/api/field/assignments/assign-1/photos", {
        method: "POST",
        headers: { Authorization: "Bearer dev-1.sec-1" },
        body: formData,
      });

      const res = await photosRoute(req, {
        params: Promise.resolve({ id: "assign-1" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Missing or invalid file");
    });
  });

  describe("POST /api/field/messages", () => {
    it("saves technician message", async () => {
      vi.spyOn(authModule, "authenticateDevice").mockResolvedValue({
        ok: true,
        auth: {
          deviceId: "dev-1",
          deviceName: "Phone",
          pushToken: null,
          technician: { id: "tech-1", name: "Suresh", phone: null, email: null },
        },
      });

      vi.spyOn(assignmentsModule, "createTechnicianMessage").mockResolvedValue({
        ok: true,
        messageId: "msg-123",
      });

      const req = new Request("http://localhost/api/field/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dev-1.sec-1",
        },
        body: JSON.stringify({
          kind: "leave",
          body: "Unable to come tomorrow due to fever",
        }),
      });

      const res = await messagesRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.messageId).toBe("msg-123");
    });
  });
});
