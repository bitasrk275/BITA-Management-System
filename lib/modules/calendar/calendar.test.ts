import { describe, expect, it, vi } from "vitest";
import {
  getDaysInRange,
  getMonthRange,
  getWeekRange,
  isDateInsideRange,
  isDatesOverlapping,
} from "./schema";
import {
  checkCalendarConflicts,
  assignCalendarJob,
} from "./service";

// Mock notifyTechnician to avoid network or expo push during unit tests
vi.mock("../../field/notify", () => ({
  notifyTechnician: vi.fn().mockResolvedValue({ success: true, count: 1 }),
}));

describe("Calendar Module (Task A3)", () => {
  describe("Date utilities & ranges", () => {
    it("returns valid week range starting Monday and ending Sunday", () => {
      // 2026-11-04 is a Wednesday
      const week = getWeekRange("2026-11-04");
      expect(week.startDate).toBe("2026-11-02"); // Monday
      expect(week.endDate).toBe("2026-11-08"); // Sunday
    });

    it("returns correct month range for 28/30/31 day months", () => {
      const feb2026 = getMonthRange(2026, 2);
      expect(feb2026.startDate).toBe("2026-02-01");
      expect(feb2026.endDate).toBe("2026-02-28");

      const nov2026 = getMonthRange(2026, 11);
      expect(nov2026.startDate).toBe("2026-11-01");
      expect(nov2026.endDate).toBe("2026-11-30");
    });

    it("generates continuous list of days in range", () => {
      const days = getDaysInRange("2026-11-05", "2026-11-08");
      expect(days).toEqual(["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    });

    it("accurately detects overlapping multi-day intervals", () => {
      // [Nov 5, Nov 7] and [Nov 7, Nov 10] overlap on Nov 7
      expect(isDatesOverlapping("2026-11-05", "2026-11-07", "2026-11-07", "2026-11-10")).toBe(true);

      // [Nov 5, Nov 7] and [Nov 8, Nov 10] do not overlap
      expect(isDatesOverlapping("2026-11-05", "2026-11-07", "2026-11-08", "2026-11-10")).toBe(false);

      // Single day job vs multi-day job
      expect(isDatesOverlapping("2026-11-06", null, "2026-11-05", "2026-11-08")).toBe(true);
      expect(isDatesOverlapping("2026-11-04", null, "2026-11-05", "2026-11-08")).toBe(false);
    });

    it("checks if date is inside a range", () => {
      expect(isDateInsideRange("2026-11-06", "2026-11-05", "2026-11-08")).toBe(true);
      expect(isDateInsideRange("2026-11-09", "2026-11-05", "2026-11-08")).toBe(false);
    });
  });

  describe("Conflict detection", () => {
    it("flags when technician is on leave on the requested date", async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === "leave_days") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () =>
                      Promise.resolve({
                        data: [{ leave_date: "2026-11-10", reason: "Medical leave" }],
                        error: null,
                      }),
                  }),
                }),
              }),
            };
          }
          if (table === "assignments") {
            return {
              select: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
          }
          return {};
        },
      } as unknown as import("@supabase/supabase-js").SupabaseClient<import("../../db/types").Database>;

      const conflicts = await checkCalendarConflicts(mockSupabase, {
        technicianId: "tech-1",
        workDate: "2026-11-09",
        endDate: "2026-11-11",
      });

      expect(conflicts.hasConflicts).toBe(true);
      expect(conflicts.technicianLeaveConflicts).toHaveLength(1);
      expect(conflicts.technicianLeaveConflicts[0]?.date).toBe("2026-11-10");
      expect(conflicts.technicianLeaveConflicts[0]?.reason).toBe("Medical leave");
    });

    it("detects when equipment is already booked on another active job on overlapping dates", async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === "leave_days") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "assignments") {
            return {
              select: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
          }
          if (table === "assignment_equipment") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        equipment_id: "eq-100",
                        assignment: {
                          id: "other-assign-1",
                          work_date: "2026-11-12",
                          end_date: "2026-11-14",
                          job: { id: "job-2", job_no: "BITA/26-27/0050", status: "scheduled" },
                        },
                        equipment: {
                          id: "eq-100",
                          make: "Olympus",
                          model: "Epoch 650",
                          serial_no: "SN-9988",
                          calibration_due: "2027-01-01",
                        },
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          return {};
        },
      } as unknown as import("@supabase/supabase-js").SupabaseClient<import("../../db/types").Database>;

      // Propose booking for Nov 13 - Nov 15 (overlaps Nov 12 - Nov 14 on Nov 13, 14)
      const conflicts = await checkCalendarConflicts(mockSupabase, {
        technicianId: "tech-1",
        workDate: "2026-11-13",
        endDate: "2026-11-15",
        equipmentIds: ["eq-100"],
      });

      expect(conflicts.hasConflicts).toBe(true);
      expect(conflicts.equipmentConflicts).toHaveLength(1);
      expect(conflicts.equipmentConflicts[0]?.conflictingJobNo).toBe("BITA/26-27/0050");
      expect(conflicts.equipmentConflicts[0]?.equipmentLabel).toContain("Epoch 650");
    });

    it("ignores conflicting assignment when excludeAssignmentId is provided (moving assignment)", async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === "leave_days") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "assignments") {
            return {
              select: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
          }
          if (table === "assignment_equipment") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        equipment_id: "eq-100",
                        assignment: {
                          id: "my-assign-1",
                          work_date: "2026-11-12",
                          end_date: "2026-11-14",
                          job: { id: "job-1", job_no: "BITA/26-27/0001", status: "scheduled" },
                        },
                        equipment: {
                          id: "eq-100",
                          make: "Olympus",
                          model: "Epoch 650",
                          serial_no: "SN-9988",
                          calibration_due: "2027-01-01",
                        },
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          if (table === "equipment") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "eq-expired",
                        make: "Magnaflux",
                        model: "Y-7",
                        serial_no: "M-112",
                        calibration_due: "2026-10-01",
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          return {};
        },
      } as unknown as import("@supabase/supabase-js").SupabaseClient<import("../../db/types").Database>;

      // Same assignment ID excluded
      const conflicts = await checkCalendarConflicts(mockSupabase, {
        technicianId: "tech-1",
        workDate: "2026-11-13",
        endDate: "2026-11-14",
        equipmentIds: ["eq-100"],
        excludeAssignmentId: "my-assign-1",
      });

      expect(conflicts.hasConflicts).toBe(false);
      expect(conflicts.equipmentConflicts).toHaveLength(0);
    });

    it("warns when equipment calibration is overdue or expires before job completion", async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === "leave_days") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "assignments") {
            return {
              select: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
          }
          if (table === "assignment_equipment") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        equipment_id: "eq-expired",
                        assignment: null,
                        equipment: {
                          id: "eq-expired",
                          make: "Magnaflux",
                          model: "Y-7",
                          serial_no: "M-112",
                          calibration_due: "2026-10-01", // Overdue
                        },
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          if (table === "equipment") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "eq-expired",
                        make: "Magnaflux",
                        model: "Y-7",
                        serial_no: "M-112",
                        calibration_due: "2026-10-01",
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          return {};
        },
      } as unknown as import("@supabase/supabase-js").SupabaseClient<import("../../db/types").Database>;

      const conflicts = await checkCalendarConflicts(mockSupabase, {
        technicianId: "tech-1",
        workDate: "2026-11-10",
        endDate: "2026-11-12",
        equipmentIds: ["eq-expired"],
      });

      expect(conflicts.hasWarnings).toBe(true);
      expect(conflicts.calibrationWarnings).toHaveLength(1);
      expect(conflicts.calibrationWarnings[0]?.equipmentId).toBe("eq-expired");
    });
  });

  describe("Scheduling & Moving actions", () => {
    it("refuses to assign job if an equipment conflict exists and force is false", async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === "leave_days") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "assignments") {
            return {
              select: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
          }
          if (table === "assignment_equipment") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        equipment_id: "eq-1",
                        assignment: {
                          id: "a-1",
                          work_date: "2026-11-15",
                          end_date: null,
                          job: { id: "j-1", job_no: "BITA/26-27/0002", status: "scheduled" },
                        },
                        equipment: {
                          id: "eq-1",
                          make: "Olympus",
                          model: "Epoch",
                          serial_no: "SN-1",
                          calibration_due: "2027-01-01",
                        },
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          return {};
        },
      } as unknown as import("@supabase/supabase-js").SupabaseClient<import("../../db/types").Database>;

      await expect(
        assignCalendarJob(mockSupabase, {
          jobId: "j-2",
          technicianId: "tech-1",
          workDate: "2026-11-15",
          equipmentIds: ["eq-1"],
        })
      ).rejects.toThrow("Equipment Olympus Epoch #SN-1 is already booked on BITA/26-27/0002");
    });

    it("successfully creates multi-day assignment and attaches equipment", async () => {
      let insertedAssignment: Record<string, unknown> = {};
      let insertedEquipRows: Record<string, unknown>[] = [];
      let updatedJobStatus: string | null = null;

      const mockSupabase = {
        from: (table: string) => {
          if (table === "leave_days") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "assignments") {
            return {
              select: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
              insert: (payload: Record<string, unknown>) => {
                insertedAssignment = payload;
                return {
                  select: () => ({
                    single: () => Promise.resolve({ data: { id: "new-assign-1", ...payload }, error: null }),
                  }),
                };
              },
            };
          }
          if (table === "assignment_equipment") {
            return {
              select: () => ({
                in: () => Promise.resolve({ data: [], error: null }),
              }),
              insert: (rows: Record<string, unknown>[]) => {
                insertedEquipRows = rows;
                return Promise.resolve({ error: null });
              },
            };
          }
          if (table === "equipment") {
            return {
              select: () => ({
                in: () => Promise.resolve({ data: [], error: null }),
              }),
              update: () => ({
                in: () => Promise.resolve({ error: null }),
              }),
            };
          }
          if (table === "jobs") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: "job-1", status: "awaiting_approval", job_no: "BITA/26-27/0001", customer: { name: "Test Corp" } },
                      error: null,
                    }),
                }),
              }),
              update: (patch: { status: string }) => {
                updatedJobStatus = patch.status;
                return {
                  eq: () => Promise.resolve({ error: null }),
                };
              },
            };
          }
          return {};
        },
      } as unknown as import("@supabase/supabase-js").SupabaseClient<import("../../db/types").Database>;

      const res = await assignCalendarJob(mockSupabase, {
        jobId: "job-1",
        technicianId: "tech-1",
        workDate: "2026-11-20",
        endDate: "2026-11-22",
        equipmentIds: ["eq-1", "eq-2"],
      });

      expect(res.id).toBe("new-assign-1");
      expect(insertedAssignment.work_date).toBe("2026-11-20");
      expect(insertedAssignment.end_date).toBe("2026-11-22");
      expect(insertedEquipRows).toHaveLength(2);
      expect(updatedJobStatus).toBe("scheduled");
    });
  });
});
