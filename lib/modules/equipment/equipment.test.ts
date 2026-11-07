import { describe, expect, it } from "vitest";
import {
  checkEquipmentCalibration,
  parseEquipmentItemInput,
  parseEquipmentMovementInput,
  parseEquipmentTypeInput,
  sanitizeSearchTerm,
} from "./schema";

describe("lib/modules/equipment/schema", () => {
  it("sanitizes search terms removing PostgREST reserved characters", () => {
    expect(sanitizeSearchTerm("Olympus, (EPOCH)%*")).toBe("Olympus   EPOCH");
    expect(sanitizeSearchTerm(null)).toBe("");
  });

  describe("checkEquipmentCalibration", () => {
    it("identifies valid equipment well before expiry", () => {
      const res = checkEquipmentCalibration("2026-12-31", "2026-11-01", 30);
      expect(res.status).toBe("valid");
      expect(res.isOverdue).toBe(false);
      expect(res.isDueSoon).toBe(false);
      expect(res.daysRemaining).toBe(60);
      expect(res.label).toBe("Valid until 2026-12-31");
    });

    it("identifies due-soon equipment within the threshold", () => {
      const res = checkEquipmentCalibration("2026-11-15", "2026-11-01", 30);
      expect(res.status).toBe("due_soon");
      expect(res.isOverdue).toBe(false);
      expect(res.isDueSoon).toBe(true);
      expect(res.daysRemaining).toBe(14);
      expect(res.label).toBe("Due in 14 days");
    });

    it("identifies due today", () => {
      const res = checkEquipmentCalibration("2026-11-07", "2026-11-07", 30);
      expect(res.status).toBe("due_soon");
      expect(res.daysRemaining).toBe(0);
      expect(res.label).toBe("Due today");
    });

    it("identifies expired calibration", () => {
      const res = checkEquipmentCalibration("2026-10-31", "2026-11-07", 30);
      expect(res.status).toBe("expired");
      expect(res.isOverdue).toBe(true);
      expect(res.isDueSoon).toBe(false);
      expect(res.daysRemaining).toBe(-7);
      expect(res.label).toBe("Expired 7 days ago");
    });

    it("handles missing calibration dates gracefully", () => {
      const res = checkEquipmentCalibration(null);
      expect(res.status).toBe("unknown");
      expect(res.daysRemaining).toBeNull();
      expect(res.label).toBe("No calibration date");
    });
  });

  describe("parseEquipmentTypeInput", () => {
    it("parses valid type input from object", () => {
      const parsed = parseEquipmentTypeInput({
        name: "Thickness gauge",
        description: "Precision ultrasonic gauge",
      });
      expect(parsed.name).toBe("Thickness gauge");
      expect(parsed.description).toBe("Precision ultrasonic gauge");
    });

    it("throws on missing type name", () => {
      expect(() => parseEquipmentTypeInput({ name: "" })).toThrow("Equipment type name is required");
    });
  });

  describe("parseEquipmentItemInput", () => {
    it("parses valid equipment item input", () => {
      const parsed = parseEquipmentItemInput({
        make: "Olympus",
        model: "EPOCH 650",
        serial_no: "SN-9988",
        status: "at_site",
        current_location: "Peenya Shop 2",
        calibration_due: "2027-01-15",
        active: "true",
      });
      expect(parsed.make).toBe("Olympus");
      expect(parsed.model).toBe("EPOCH 650");
      expect(parsed.serial_no).toBe("SN-9988");
      expect(parsed.status).toBe("at_site");
      expect(parsed.current_location).toBe("Peenya Shop 2");
      expect(parsed.active).toBe(true);
    });

    it("defaults in_office location to 'In office'", () => {
      const parsed = parseEquipmentItemInput({
        make: "Magnaflux",
        serial_no: "YOKE-01",
        status: "in_office",
      });
      expect(parsed.status).toBe("in_office");
      expect(parsed.current_location).toBe("In office");
    });

    it("throws if serial, model, and make are all missing", () => {
      expect(() => parseEquipmentItemInput({})).toThrow(
        "Equipment must have at least a serial number, model, or make"
      );
    });
  });

  describe("parseEquipmentMovementInput", () => {
    it("parses valid movement input", () => {
      const parsed = parseEquipmentMovementInput({
        equipment_id: "00000000-0000-0000-0000-000000000001",
        job_id: "00000000-0000-0000-0000-000000000002",
        to_location: "Dabaspet Site",
        delivery_challan_no: "DC-2026-044",
        status: "at_site",
        notes: "Dispatched with technician Ravi",
      });
      expect(parsed.equipment_id).toBe("00000000-0000-0000-0000-000000000001");
      expect(parsed.job_id).toBe("00000000-0000-0000-0000-000000000002");
      expect(parsed.to_location).toBe("Dabaspet Site");
      expect(parsed.delivery_challan_no).toBe("DC-2026-044");
      expect(parsed.status).toBe("at_site");
      expect(parsed.notes).toBe("Dispatched with technician Ravi");
      expect(parsed.moved_on).toBeDefined();
    });

    it("requires equipment_id and to_location", () => {
      expect(() => parseEquipmentMovementInput({ to_location: "Site A" })).toThrow("Equipment ID is required");
      expect(() =>
        parseEquipmentMovementInput({ equipment_id: "00000000-0000-0000-0000-000000000001" })
      ).toThrow("Destination location is required");
    });
  });

  describe("service functions with mocked client", () => {
    it("lists equipment and computes calibration status for each item", async () => {
      const { listEquipment } = await import("./service");
      const fakeData = [
        {
          id: "eq-1",
          make: "Olympus",
          model: "EPOCH 650",
          serial_no: "SN-001",
          status: "in_office",
          current_location: "In office",
          calibration_due: "2026-11-20",
          equipment_types: { id: "type-1", name: "UT flaw detector" },
          jobs: null,
        },
      ];

      const mockSupabase = {
        from: () => ({
          select: () => ({
            order: () => ({
              is: () => Promise.resolve({ data: fakeData, error: null }),
            }),
          }),
        }),
      } as unknown as import("@supabase/supabase-js").SupabaseClient<import("../../db/types").Database>;

      const items = await listEquipment(mockSupabase, {
        refDateStr: "2026-11-07",
        thresholdDays: 30,
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.calibration.status).toBe("due_soon");
      expect(items[0]?.calibration.daysRemaining).toBe(13);
    });

    it("records movement and updates equipment record", async () => {
      const { recordEquipmentMovement } = await import("./service");

      let updatedEquipmentPatch: Record<string, unknown> = {};
      let insertedMovementPayload: Record<string, unknown> = {};

      const mockSupabase = {
        from: (table: string) => {
          if (table === "equipment_movements") {
            return {
              insert: (payload: Record<string, unknown>) => {
                insertedMovementPayload = payload;
                return {
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { id: "move-1", ...payload },
                        error: null,
                      }),
                  }),
                };
              },
            };
          }
          if (table === "equipment") {
            return {
              update: (patch: Record<string, unknown>) => {
                updatedEquipmentPatch = patch;
                return {
                  eq: () => Promise.resolve({ error: null }),
                };
              },
            };
          }
          return {};
        },
      } as unknown as import("@supabase/supabase-js").SupabaseClient<import("../../db/types").Database>;

      const result = await recordEquipmentMovement(mockSupabase, {
        equipment_id: "eq-1",
        job_id: "job-1",
        to_location: "Peenya Site",
        delivery_challan_no: "DC-01",
        delivery_challan_path: null,
        from_location: "In office",
        status: "at_site",
        moved_on: "2026-11-07",
        moved_by: null,
        notes: null,
      });

      expect(result.id).toBe("move-1");
      expect(insertedMovementPayload.to_location).toBe("Peenya Site");
      expect(insertedMovementPayload.delivery_challan_no).toBe("DC-01");
      expect(updatedEquipmentPatch.status).toBe("at_site");
      expect(updatedEquipmentPatch.current_location).toBe("Peenya Site");
      expect(updatedEquipmentPatch.current_job_id).toBe("job-1");
    });
  });
});
