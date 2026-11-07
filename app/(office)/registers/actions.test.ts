import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireStaff: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("@/lib/forms", async () => await import("../../../lib/forms"));

import { createPhonePairingCode, revokeTechnicianDevice, saveRegister } from "./actions";

const PERSON = "10000000-0000-0000-0000-000000000001";
const EQUIPMENT = "20000000-0000-0000-0000-000000000001";

function database(roles = ["management"]) {
  const query = {
    insert: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(),
  };
  for (const name of ["insert", "update", "eq", "select"] as const) query[name].mockReturnValue(query);
  query.single.mockResolvedValue({ data: { id: EQUIPMENT }, error: null });
  query.maybeSingle.mockResolvedValue({ data: { person_id: PERSON }, error: null });
  const upload = vi.fn().mockResolvedValue({ error: null });
  const supabase = { from: vi.fn().mockReturnValue(query), storage: { from: vi.fn().mockReturnValue({ upload }) } };
  mocks.requireStaff.mockResolvedValue({ supabase, person: { id: PERSON, roles } });
  return { query, supabase, upload };
}

function equipmentForm(withFile = false) {
  const fd = new FormData(); fd.set("kind", "mpi_yoke"); fd.set("active", "on");
  if (withFile) fd.set("certificate", new File(["%PDF-1.4 fake test certificate"], "test.pdf", { type: "application/pdf" }));
  return fd;
}

beforeEach(() => vi.clearAllMocks());

describe("management-only register saves", () => {
  it("blocks office users before database writes or uploads", async () => {
    const { supabase } = database(["office"]);
    await expect(saveRegister("equipment", "new", equipmentForm(true))).rejects.toThrow("Only%20management");
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it("does not report a successful save when RLS hides the updated row", async () => {
    const { query } = database();
    query.single.mockResolvedValue({ data: null, error: { message: "row-level security" } });
    await expect(saveRegister("equipment", EQUIPMENT, equipmentForm())).rejects.toThrow("You%20do%20not%20have%20permission");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("saves details without changing certificate links or accepting a forged storage path", async () => {
    const { query, supabase } = database();
    const fd = equipmentForm();
    fd.set("certificate_path", "calibration/other/certificate.pdf");
    await expect(saveRegister("equipment", EQUIPMENT, fd)).rejects.toThrow(`REDIRECT /registers/equipment/${EQUIPMENT}?saved=1`);
    expect(query.update).toHaveBeenCalledTimes(1);
    expect(query.update.mock.calls[0][0]).not.toHaveProperty("certificate_path");
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it("keeps an existing qualification with its original person", async () => {
    const { query } = database();
    const fd = new FormData(); fd.set("person_id", EQUIPMENT); fd.set("method", "UT"); fd.set("level", "II");
    await expect(saveRegister("qualifications", EQUIPMENT, fd)).rejects.toThrow("original%20person");
    expect(query.update).not.toHaveBeenCalled();
  });

  it("prevents accidental self-deactivation while editing roles", async () => {
    const { supabase } = database();
    const fd = new FormData(); fd.set("full_name", "Test Manager"); fd.set("roles", "management");
    await expect(saveRegister("people", PERSON, fd)).rejects.toThrow("cannot%20deactivate%20yourself");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("createPhonePairingCode blocks non-management users", async () => {
    database(["office"]);
    await expect(createPhonePairingCode(PERSON)).rejects.toThrow("Only%20management%20can%20link%20phones");
  });

  it("createPhonePairingCode creates 6-digit code and redirects with code in URL", async () => {
    const { query } = database();
    query.single.mockResolvedValue({ data: { id: "code-id-1" }, error: null });
    await expect(createPhonePairingCode(PERSON)).rejects.toThrow(/pairingCode=\d{6}/);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/registers/people/${PERSON}`);
  });

  it("revokeTechnicianDevice blocks non-management users", async () => {
    database(["office"]);
    await expect(revokeTechnicianDevice(PERSON, "device-1")).rejects.toThrow("Only%20management%20can%20revoke%20phones");
  });

  it("revokeTechnicianDevice sets revoked_at timestamp and redirects", async () => {
    const { query } = database();
    query.eq.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    await expect(revokeTechnicianDevice(PERSON, "device-1")).rejects.toThrow(`REDIRECT /registers/people/${PERSON}?saved=1`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/registers/people/${PERSON}`);
  });
});
