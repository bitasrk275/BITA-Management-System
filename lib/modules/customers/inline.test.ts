import { describe, expect, it } from "vitest";
import { resolveCustomerFromForm } from "./inline";

function fakeSupabase() {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: "cust-new", ...row }, error: null }),
          }),
        };
      },
    }),
  };
  return { client: client as never, inserted };
}

describe("resolveCustomerFromForm (+ New customer inside job and quotation forms)", () => {
  it("uses the chosen customer when no new name is typed", async () => {
    const { client, inserted } = fakeSupabase();
    const fd = new FormData();
    fd.set("customer_id", "cust-1");
    expect(await resolveCustomerFromForm(client, fd)).toEqual({ ok: true, customerId: "cust-1", created: false });
    expect(inserted).toHaveLength(0);
  });

  it("creates the new customer and uses it instead of the list choice", async () => {
    const { client, inserted } = fakeSupabase();
    const fd = new FormData();
    fd.set("customer_id", "");
    fd.set("new_customer_name", "Sample Forgings Pvt Ltd");
    fd.set("new_customer_gstin", "29aaaaa0000a1z5");
    fd.set("new_customer_proforma", "on");
    const res = await resolveCustomerFromForm(client, fd);
    expect(res).toEqual({ ok: true, customerId: "cust-new", created: true });
    expect(inserted[0]).toMatchObject({
      name: "Sample Forgings Pvt Ltd",
      gstin: "29AAAAA0000A1Z5",
      uses_proforma: true,
      payment_terms_days: 30,
    });
  });

  it("asks for a customer when neither is given", async () => {
    const { client } = fakeSupabase();
    const res = await resolveCustomerFromForm(client, new FormData());
    expect(res.ok).toBe(false);
  });
});
