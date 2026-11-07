import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/types";
import {
  parseContactInput,
  parseCustomerInput,
  sanitizeCustomerSearchTerm,
} from "./schema";
import {
  createCustomerRecord,
  deleteCustomerRecord,
  listCustomers,
  restoreCustomerRecord,
  updateCustomerRecord,
} from "./service";
import {
  normalizePermissionsMatrix,
  parseSettingsOptionInput,
} from "../settings/schema";

describe("customers module schema", () => {
  it("validates and normalizes customer input from plain objects and FormData", () => {
    const res = parseCustomerInput({
      name: "  Test Turbines India Ltd ",
      code: " ttil ",
      gstin: " 29aaact1234f1z5 ",
      billing_address: " Peenya Industrial Area, Bengaluru ",
      uses_proforma: true,
      payment_terms_days: "45",
      mailbox: "accounts@ttil.example",
      notes: "Priority account",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({
        name: "Test Turbines India Ltd",
        code: "TTIL",
        gstin: "29AAACT1234F1Z5",
        billing_address: "Peenya Industrial Area, Bengaluru",
        uses_proforma: true,
        payment_terms_days: 45,
        mailbox: "accounts@ttil.example",
        notes: "Priority account",
      });
    }

    const fd = new FormData();
    fd.set("name", "Kaveri Forgings Pvt Ltd");
    fd.set("code", "kfpl");
    fd.set("uses_proforma", "on");
    const fdRes = parseCustomerInput(fd);
    expect(fdRes.ok).toBe(true);
    if (fdRes.ok) {
      expect(fdRes.value.code).toBe("KFPL");
      expect(fdRes.value.uses_proforma).toBe(true);
      expect(fdRes.value.payment_terms_days).toBe(30);
    }
  });

  it("rejects missing customer name or out-of-range payment terms", () => {
    expect(parseCustomerInput({ name: "   " })).toEqual({
      ok: false,
      error: "Customer name is required.",
    });

    expect(parseCustomerInput({ name: "Acme", payment_terms_days: -5 })).toEqual({
      ok: false,
      error: "Payment terms must be between 0 and 365 days.",
    });
  });

  it("validates contact input and sanitizes search terms", () => {
    expect(parseContactInput({ name: "" })).toEqual({
      ok: false,
      error: "Contact name is required.",
    });

    const contact = parseContactInput({
      name: "Ramesh Rao",
      mobile: "9845012345",
      email: "ramesh@ttil.example",
      receives_reports: true,
      receives_invoices: false,
    });
    expect(contact.ok).toBe(true);

    expect(sanitizeCustomerSearchTerm("Test, (India)%*")).toBe("Test   India");
  });
});

describe("customers module service", () => {
  it("lists, creates, updates, soft-deletes, and restores customers through the Supabase client", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: "cust-1",
        name: "Test Turbines India Ltd",
        code: "TTIL",
        gstin: "29AAACT1234F1Z5",
        billing_address: null,
        uses_proforma: false,
        payment_terms_days: 30,
        mailbox: null,
        notes: null,
        zoho_contact_id: null,
        created_at: "2026-11-07T00:00:00Z",
        deleted_at: null,
        deleted_by: null,
      },
      error: null,
    });

    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            or: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "cust-1",
                  name: "Test Turbines India Ltd",
                  code: "TTIL",
                  gstin: "29AAACT1234F1Z5",
                  uses_proforma: false,
                  customer_contacts: [{ count: 2 }],
                },
              ],
              error: null,
            }),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({ single: singleMock })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({ single: singleMock })),
          })),
        })),
      })),
      rpc: rpcMock,
    } as unknown as SupabaseClient<Database>;

    const listed = await listCustomers(supabase, { q: "TTIL" });
    expect(listed.error).toBeNull();
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.contact_count).toBe(2);

    const parsed = parseCustomerInput({ name: "Test Turbines India Ltd", code: "TTIL" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const created = await createCustomerRecord(supabase, parsed.value);
      expect(created.error).toBeNull();
      expect(created.data?.id).toBe("cust-1");

      const updated = await updateCustomerRecord(supabase, "cust-1", parsed.value);
      expect(updated.error).toBeNull();
    }

    const delRes = await deleteCustomerRecord(supabase, "cust-1");
    expect(delRes).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("soft_delete_record", {
      p_table: "customers",
      p_id: "cust-1",
    });

    const restRes = await restoreCustomerRecord(supabase, "cust-1");
    expect(restRes).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("restore_record", {
      p_table: "customers",
      p_id: "cust-1",
    });
  });
});

describe("settings schema helpers", () => {
  it("normalizes permissions matrix and validates dropdown option input", () => {
    const matrix = normalizePermissionsMatrix({
      delete: ["management", "office"],
      view_salaries: ["management"],
    });
    expect(matrix.delete).toEqual(["management", "office"]);
    expect(matrix.approve_reports).toEqual(["reviewer", "management"]);

    expect(
      parseSettingsOptionInput({ list_key: "Couplant_Type", value: "Ultrasonic gel", position: 3 }),
    ).toEqual({
      ok: true,
      value: {
        list_key: "couplant_type",
        value: "Ultrasonic gel",
        position: 3,
        active: true,
      },
    });

    expect(parseSettingsOptionInput({ list_key: "bad-key!", value: "Oil" }).ok).toBe(false);
  });
});
