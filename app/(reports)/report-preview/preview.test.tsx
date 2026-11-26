import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireStaff: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireStaff: mocks.requireStaff, isStaff: (roles: string[]) => roles.some((role) => ["management", "office", "reviewer"].includes(role)) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/ui", async () => await import("../../../components/ui"));
vi.mock("@/templates/reports/report", async () => await import("../../../templates/reports/report"));
vi.mock("@/templates/reports/preview-data", async () => await import("../../../templates/reports/preview-data"));
vi.mock("@/templates/reports/report.css", () => ({}));
vi.stubGlobal("React", React);

import ReportPreview from "./[method]/page";

beforeEach(() => { vi.clearAllMocks(); mocks.requireStaff.mockResolvedValue({ person: { roles: ["management"] } }); });

describe("staff-only fake report previews", () => {
  it.each(["UT", "MT", "MPT", "DPT"])("renders the %s draft only after the staff check", async (method) => {
    const html = renderToStaticMarkup(await ReportPreview({ params: Promise.resolve({ method }) }));
    expect(mocks.requireStaff).toHaveBeenCalledTimes(1);
    expect(html).toContain("Sample Customer");
    expect(html).toContain("NOT APPROVED FOR ISSUE");
    expect(html).not.toContain("report-signoff");
    if (process.env.T8A_RENDER_DIR) {
      mkdirSync(process.env.T8A_RENDER_DIR, { recursive: true });
      writeFileSync(join(process.env.T8A_RENDER_DIR, `${method}-preview.html`), `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body>${html}</body></html>`);
    }
  });

  it.each([null, { roles: ["technician"] }, { roles: [] }])("does not render a preview for a non-staff person", async (person) => {
    mocks.requireStaff.mockResolvedValue({ person });
    await expect(ReportPreview({ params: Promise.resolve({ method: "UT" }) })).rejects.toThrow("NOT_FOUND");
  });

  it("refuses unsupported methods rather than falling back to a different report type", async () => {
    await expect(ReportPreview({ params: Promise.resolve({ method: "VT" }) })).rejects.toThrow("NOT_FOUND");
  });
});
