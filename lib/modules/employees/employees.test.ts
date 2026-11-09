import { describe, expect, it } from "vitest";
import { prefillReadingsFromBookedEquipment } from "../../reports/review";
import {
  computeMonthlyAttendance,
  isSundayDate,
  parseEmployeeInput,
  parseQualificationInput,
} from "./schema";

describe("Employee register & attendance calculations (Tasks A5 & A6)", () => {
  it("correctly identifies Sundays in UTC/calendar dates", () => {
    // 2026-11-01 is a Sunday, 2026-11-02 is a Monday
    expect(isSundayDate("2026-11-01")).toBe(true);
    expect(isSundayDate("2026-11-02")).toBe(false);
    expect(isSundayDate("2026-11-08")).toBe(true);
  });

  it("computes worked, leave, and idle days excluding Sundays and BITA holidays", () => {
    // November 2026 has 30 days.
    // Sundays in Nov 2026: Nov 1, 8, 15, 22, 29 (5 Sundays -> 25 working days before holidays)
    // Add 1 BITA holiday on Wednesday 2026-11-18 -> 6 non-working days, 24 working days.
    const counts = computeMonthlyAttendance({
      month: "2026-11",
      assignments: [
        // 3-day job: Mon Nov 2 to Wed Nov 4 (3 worked days)
        { work_date: "2026-11-02", end_date: "2026-11-04" },
        // Single day job on Fri Nov 6 (1 worked day)
        { work_date: "2026-11-06", end_date: null },
      ],
      leaveDates: [
        "2026-11-10", // Tuesday (1 leave day)
        "2026-11-11", // Wednesday (1 leave day)
      ],
      holidayDates: ["2026-11-18"],
    });

    expect(counts.totalCalendarDays).toBe(30);
    expect(counts.sundaysAndHolidays).toBe(6);
    expect(counts.workingDays).toBe(24);
    expect(counts.workedDays).toBe(4);
    expect(counts.leaveDays).toBe(2);
    // Idle = 24 working days - 4 worked - 2 leave = 18 idle days
    expect(counts.idleDays).toBe(18);
  });

  it("excludes salary and allowance when includeCompensation is false (non-management)", () => {
    const officeParsed = parseEmployeeInput(
      {
        full_name: "Suresh Babu",
        initials: "sb",
        position: "NDT Technician",
        roles: ["technician"],
        monthly_salary: "40000",
        per_job_allowance: "600",
      },
      { includeCompensation: false }
    );

    expect(officeParsed.initials).toBe("SB");
    expect(officeParsed.monthly_salary).toBeUndefined();
    expect(officeParsed.per_job_allowance).toBeUndefined();

    const mgmtParsed = parseEmployeeInput(
      {
        full_name: "Suresh Babu",
        initials: "sb",
        position: "NDT Technician",
        roles: ["technician"],
        monthly_salary: "40000",
        per_job_allowance: "600",
      },
      { includeCompensation: true }
    );

    expect(mgmtParsed.monthly_salary).toBe(40000);
    expect(mgmtParsed.per_job_allowance).toBe(600);
  });

  it("validates qualification input and rejects expiry earlier than issue date", () => {
    const personId = "11111111-1111-1111-1111-111111111111";
    const valid = parseQualificationInput({
      person_id: personId,
      method: "UT",
      level: "Level II",
      scheme: "ASNT SNT-TC-1A",
      issued_on: "2025-01-10",
      valid_until: "2030-01-09",
    });
    expect(valid.method).toBe("UT");
    expect(valid.level).toBe("Level II");

    expect(() =>
      parseQualificationInput({
        person_id: personId,
        method: "UT",
        level: "Level II",
        issued_on: "2026-06-01",
        valid_until: "2026-05-01",
      })
    ).toThrow(/Expiry date cannot be earlier/i);
  });

  it("prefills equipment and serial number on report readings from booked equipment (Task A6)", () => {
    const prefilled = prefillReadingsFromBookedEquipment(
      { client: "Example Steel Ltd" },
      [
        {
          make: "Olympus",
          model: "EPOCH 650",
          serial_no: "EP650-1092",
        },
      ]
    );

    expect(prefilled.equipment).toBe("Olympus EPOCH 650");
    expect(prefilled.equipment_serial).toBe("EP650-1092");

    // Does not overwrite already entered equipment readings
    const preserved = prefillReadingsFromBookedEquipment(
      {
        equipment: "Krautkramer USM 36",
        equipment_serial: "USM-882",
      },
      [
        {
          make: "Olympus",
          model: "EPOCH 650",
          serial_no: "EP650-1092",
        },
      ]
    );

    expect(preserved.equipment).toBe("Krautkramer USM 36");
    expect(preserved.equipment_serial).toBe("USM-882");
  });
});
