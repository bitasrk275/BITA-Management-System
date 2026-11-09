import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/lib/db/types";

const mocks = vi.hoisted(() => ({ requireStaff: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("@/components/ui", async () => await import("../../../components/ui"));
vi.mock("./actions", () => ({ saveRegister: vi.fn(async () => {}) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.stubGlobal("React", React);

import RegistersPage from "./page";
import { RegisterForm } from "./register-form";
import RegisterDetail from "./[register]/[id]/page";

const person: Tables<"people"> = {
  id: "10000000-0000-0000-0000-000000000001", full_name: "FAKE TEST Technician", initials: "TT", position: "Test Inspector",
  mobile: "+910000000001", email: "technician@example.test", user_id: null, roles: ["technician"], active: true, signature_path: null, created_at: "2026-11-06T00:00:00Z", deleted_at: null, deleted_by: null, monthly_salary: null, per_job_allowance: null,
};
const qualification: Tables<"qualifications"> = {
  id: "20000000-0000-0000-0000-000000000001", person_id: person.id, method: "UT", level: "Level II", scheme: "Test scheme", certifying_body: "Fake Certification Body", certificate_no: "FAKE-CERT-001", issued_on: "2025-01-01", valid_until: "2026-01-01", certificate_path: null, created_at: "2026-11-06T00:00:00Z",
};
const equipment: Tables<"equipment"> = {
  id: "30000000-0000-0000-0000-000000000001", equipment_type_id: null, kind: "ut_flaw_detector", make: "Test Instruments", model: "Demo Detector", serial_no: "FAKE-EQ-001", calibrated_on: "2025-01-01", calibration_due: "2026-01-01", status: "in_office", current_location: "In office", current_job_id: null, active: true, notes: "Fake test equipment", certificate_path: null, created_at: "2026-11-06T00:00:00Z", deleted_at: null, deleted_by: null,
};

function setup(roles = ["management"], failure = false) {
  const rows = { people: [person], qualification_status: [{ ...qualification, is_expired: true }], equipment: [equipment] };
  const from = vi.fn((table: keyof typeof rows | "qualifications") => {
    const data = table === "qualifications" ? [qualification] : rows[table];
    const query = {
      select: () => query, eq: () => query,
      order: () => Promise.resolve({ data: failure ? null : data, error: failure ? { message: "Test read failure" } : null }),
      maybeSingle: () => Promise.resolve({ data: data[0], error: null }),
    };
    return query;
  });
  mocks.requireStaff.mockResolvedValue({ person: { roles }, supabase: { from } });
}

// Optional export for local Chromium checks. Contains only the invented fixtures above.
function exportScreen(name: string, markup: string) {
  if (!process.env.T4_RENDER_DIR) return;
  mkdirSync(process.env.T4_RENDER_DIR, { recursive: true });
  writeFileSync(join(process.env.T4_RENDER_DIR, `${name}.html`), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><main class="mx-auto max-w-5xl px-4 py-6">${markup}</main></body></html>`);
}

beforeEach(() => { vi.clearAllMocks(); setup(); });

describe("register screens", () => {
  it("renders all three register lists with database expiry and calibration warnings", async () => {
    for (const tab of ["people", "qualifications", "equipment"]) {
      const html = renderToStaticMarkup(await RegistersPage({ searchParams: Promise.resolve({ tab }) }));
      expect(html).toContain(`href="/registers/${tab}/new"`);
      if (tab === "qualifications") { expect(html).toContain("Expired"); expect(html).toContain("FAKE-CERT-001"); }
      if (tab === "equipment") { expect(html).toContain("Overdue"); expect(html).toContain("FAKE-EQ-001"); }
      exportScreen(`${tab}-list`, html);
    }
  });

  it("hides add controls for office staff and renders readonly forms", async () => {
    setup(["office"]);
    const html = renderToStaticMarkup(await RegistersPage({ searchParams: Promise.resolve({ tab: "people" }) }));
    expect(html).not.toContain("/registers/people/new");
    const form = renderToStaticMarkup(<RegisterForm register="people" people={[person]} record={person} action={async () => {}} canEdit={false} />);
    expect(form).toContain("disabled");
    expect(form).not.toContain("Save changes");
  });

  it("renders usable forms for all record kinds without wide tables", () => {
    for (const register of ["people", "qualifications", "equipment"] as const) {
      const html = renderToStaticMarkup(<RegisterForm register={register} people={[person]} action={async () => {}} canEdit />);
      expect(html).toContain("Add record");
      expect(html).not.toContain("<table");
      if (register !== "people") expect(html).toContain("Save the record, then attach its certificate copy.");
      exportScreen(`${register}-form`, html);
    }
  });

  it("uses a separate private multipart upload form on existing records", async () => {
    for (const [register, id] of [["qualifications", qualification.id], ["equipment", equipment.id]]) {
      const html = renderToStaticMarkup(await RegisterDetail({ params: Promise.resolve({ register, id }), searchParams: Promise.resolve({}) }));
      expect(html).toContain(`action="/registers/${register}/${id}/certificate"`);
      expect(html).toContain('method="post"');
      expect(html).toContain('encType="multipart/form-data"');
      expect(html).toContain("Upload certificate");
      exportScreen(`${register}-detail`, html);
    }
  });

  it("shows read failures without claiming an empty register", async () => {
    setup(["management"], true);
    const html = renderToStaticMarkup(await RegistersPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Test read failure");
    expect(html).not.toContain("No matching records");
  });
});
