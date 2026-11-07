import { describe, expect, it } from "vitest";
import { homeFor, roleLabel } from "./roles";

describe("homeFor", () => {
  it("redirects empty or missing roles to /login", () => {
    expect(homeFor(undefined)).toBe("/login");
    expect(homeFor([])).toBe("/login");
  });

  it("sends management to /dashboard", () => {
    expect(homeFor(["management"])).toBe("/dashboard");
    expect(homeFor(["management", "technician"])).toBe("/dashboard");
  });

  it("sends office to /office", () => {
    expect(homeFor(["office"])).toBe("/office");
    expect(homeFor(["office", "reviewer"])).toBe("/office");
  });

  it("sends reviewer to /review", () => {
    expect(homeFor(["reviewer"])).toBe("/review");
  });

  it("sends technician to /technician (retires web field screens, D-016)", () => {
    expect(homeFor(["technician"])).toBe("/technician");
  });

  it("defaults unknown roles to /login", () => {
    expect(homeFor(["unknown_role"])).toBe("/login");
  });
});

describe("roleLabel", () => {
  it("formats single and multiple roles in title case", () => {
    expect(roleLabel(["management"])).toBe("Management");
    expect(roleLabel(["office", "reviewer"])).toBe("Office · Reviewer");
    expect(roleLabel(["technician"])).toBe("Technician");
  });
});
