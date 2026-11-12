import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { deleteEnquiryRecord, restoreEnquiryRecord } from "@/lib/modules/enquiries/service";
import { deleteQuotationRecord, restoreQuotationRecord } from "@/lib/modules/quotations/service";
import { deleteJobRecord, restoreJobRecord } from "@/lib/modules/jobs/service";
import { deleteCustomerContact, deleteCustomerRecord } from "@/lib/modules/customers/service";
import { deleteEmployee, deleteEmployeeQualification } from "@/lib/modules/employees/service";
import { deleteEquipment, deleteEquipmentType } from "@/lib/modules/equipment/service";
import { softDeletePriceItem } from "@/lib/modules/price-items/service";
import { deleteJobExpense } from "@/lib/modules/log-book/service";
import { deleteCalendarAssignment, deleteLeaveDay } from "@/lib/modules/calendar/service";

function createMockSupabase(overrides?: {
  roles?: string[];
  settingsPermissions?: Record<string, string[]>;
  linkedJobs?: Array<{ id: string; job_no: string }>;
  directInvoices?: Array<{ id: string; invoice_no: string | null; number: string | null; status: string; issued_at: string | null }>;
  jobReports?: Array<{ id: string }>;
  invoiceReports?: Array<{ invoice: { id: string; invoice_no: string | null; number: string | null; status: string; issued_at: string | null } | null }>;
}) {
  const rpcMock = vi.fn(async () => {
    return { data: null, error: null };
  });

  const fromMock = vi.fn((table: string) => {
    if (table === "settings") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                key: "permissions",
                value: overrides?.settingsPermissions ?? {
                  delete: ["management"],
                  view_salaries: ["management"],
                  approve_reports: ["reviewer", "management"],
                  issue_invoices: ["management", "office"],
                },
              },
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === "jobs") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(async () => ({
              data: overrides?.linkedJobs ?? [],
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === "invoices") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            neq: vi.fn(async () => ({
              data: overrides?.directInvoices ?? [],
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === "reports") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data: overrides?.jobReports ?? [],
            error: null,
          })),
        })),
      };
    }

    if (table === "invoice_reports") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: overrides?.invoiceReports ?? [],
            error: null,
          })),
        })),
      };
    }

    if (table === "assignment_equipment") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data: [],
            error: null,
          })),
        })),
      };
    }

    // Default table mock with delete / eq
    return {
      delete: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
      update: vi.fn(() => ({
        in: vi.fn(async () => ({ error: null })),
      })),
    };
  });

  const authMock = {
    getUser: vi.fn(async () => ({
      data: { user: { id: "user-1" } },
      error: null,
    })),
  };

  return {
    rpc: rpcMock,
    from: fromMock,
    auth: authMock,
  } as unknown as SupabaseClient<Database> & {
    rpc: typeof rpcMock;
    from: typeof fromMock;
  };
}

describe("G6: Delete Everywhere + Permissions Enforcement", () => {
  describe("1. Enquiries soft delete and restore", () => {
    it("allows delete for roles with delete permission (management)", async () => {
      const supabase = createMockSupabase();
      const res = await deleteEnquiryRecord(supabase, "enq-101", ["management"]);
      expect(res).toEqual({ ok: true });
      expect(supabase.rpc).toHaveBeenCalledWith("soft_delete_record", {
        p_table: "enquiries",
        p_id: "enq-101",
      });
    });

    it("rejects delete for roles without delete permission (office, technician)", async () => {
      const supabase = createMockSupabase();
      const resOffice = await deleteEnquiryRecord(supabase, "enq-101", ["office"]);
      expect(resOffice.ok).toBe(false);
      expect(resOffice).toHaveProperty("error");
      expect((resOffice as { error: string }).error).toContain("Permission denied");

      const resTech = await deleteEnquiryRecord(supabase, "enq-101", ["technician"]);
      expect(resTech.ok).toBe(false);
      expect((resTech as { error: string }).error).toContain("Permission denied");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("restores enquiry record via restoreRecord RPC", async () => {
      const supabase = createMockSupabase();
      const res = await restoreEnquiryRecord(supabase, "enq-101");
      expect(res).toEqual({ ok: true });
      expect(supabase.rpc).toHaveBeenCalledWith("restore_record", {
        p_table: "enquiries",
        p_id: "enq-101",
      });
    });
  });

  describe("2. Quotations soft delete and active job guard", () => {
    it("refuses to delete quotation when an active job is linked", async () => {
      const supabase = createMockSupabase({
        linkedJobs: [{ id: "job-1", job_no: "BITA/26-27/0001" }],
      });

      const res = await deleteQuotationRecord(supabase, "quote-1", ["management"]);
      expect(res.ok).toBe(false);
      expect((res as { error: string }).error).toContain("Cannot delete quotation");
      expect((res as { error: string }).error).toContain("BITA/26-27/0001");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("succeeds when no active job is linked and caller has permission", async () => {
      const supabase = createMockSupabase({ linkedJobs: [] });

      const res = await deleteQuotationRecord(supabase, "quote-1", ["management"]);
      expect(res).toEqual({ ok: true });
      expect(supabase.rpc).toHaveBeenCalledWith("soft_delete_record", {
        p_table: "quotations",
        p_id: "quote-1",
      });
    });

    it("restores quotation record via restoreRecord RPC", async () => {
      const supabase = createMockSupabase();
      const res = await restoreQuotationRecord(supabase, "quote-1");
      expect(res).toEqual({ ok: true });
      expect(supabase.rpc).toHaveBeenCalledWith("restore_record", {
        p_table: "quotations",
        p_id: "quote-1",
      });
    });
  });

  describe("3. Jobs soft delete and issued invoice guard", () => {
    it("refuses to delete job when a direct issued invoice exists", async () => {
      const supabase = createMockSupabase({
        directInvoices: [
          {
            id: "inv-1",
            invoice_no: "BITA/26-27/INV-0001",
            number: "5388",
            status: "issued",
            issued_at: "2026-11-10T10:00:00Z",
          },
        ],
      });

      const res = await deleteJobRecord(supabase, "job-1", ["management"]);
      expect(res.ok).toBe(false);
      expect((res as { error: string }).error).toContain("Cannot delete job: an issued invoice");
      expect((res as { error: string }).error).toContain("Cancel by credit note first");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("refuses to delete job when an issued invoice is linked via job reports", async () => {
      const supabase = createMockSupabase({
        directInvoices: [],
        jobReports: [{ id: "rep-1" }],
        invoiceReports: [
          {
            invoice: {
              id: "inv-multi",
              invoice_no: "BITA/26-27/INV-0005",
              number: "5392",
              status: "partially_paid",
              issued_at: "2026-11-11T12:00:00Z",
            },
          },
        ],
      });

      const res = await deleteJobRecord(supabase, "job-1", ["management"]);
      expect(res.ok).toBe(false);
      expect((res as { error: string }).error).toContain("Cannot delete job: an issued invoice");
      expect((res as { error: string }).error).toContain("Cancel by credit note first");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("succeeds when job has no invoices or all invoices are cancelled / draft", async () => {
      const supabase = createMockSupabase({
        directInvoices: [
          {
            id: "inv-draft",
            invoice_no: null,
            number: null,
            status: "draft",
            issued_at: null,
          },
        ],
        jobReports: [],
      });

      const res = await deleteJobRecord(supabase, "job-1", ["management"]);
      expect(res).toEqual({ ok: true });
      expect(supabase.rpc).toHaveBeenCalledWith("soft_delete_record", {
        p_table: "jobs",
        p_id: "job-1",
      });
    });

    it("restores job record via restoreRecord RPC", async () => {
      const supabase = createMockSupabase();
      const res = await restoreJobRecord(supabase, "job-1");
      expect(res).toEqual({ ok: true });
      expect(supabase.rpc).toHaveBeenCalledWith("restore_record", {
        p_table: "jobs",
        p_id: "job-1",
      });
    });
  });

  describe("4. Permission matrix enforcement across all delete service paths", () => {
    it("enforces delete permission on customer delete & contact delete", async () => {
      const supabase = createMockSupabase();

      // Blocked for office
      const custBlocked = await deleteCustomerRecord(supabase, "cust-1", ["office"]);
      expect(custBlocked.ok).toBe(false);
      const contactBlocked = await deleteCustomerContact(supabase, "contact-1", ["office"]);
      expect(contactBlocked.ok).toBe(false);

      // Allowed for management
      const custOk = await deleteCustomerRecord(supabase, "cust-1", ["management"]);
      expect(custOk.ok).toBe(true);
      const contactOk = await deleteCustomerContact(supabase, "contact-1", ["management"]);
      expect(contactOk.ok).toBe(true);
    });

    it("enforces delete permission on employee delete & qualification delete", async () => {
      const supabase = createMockSupabase();

      await expect(deleteEmployee(supabase, "emp-1", ["technician"])).rejects.toThrow(
        /Permission denied/,
      );
      await expect(deleteEmployeeQualification(supabase, "qual-1", ["technician"])).rejects.toThrow(
        /Permission denied/,
      );

      await expect(deleteEmployee(supabase, "emp-1", ["management"])).resolves.toEqual({
        success: true,
      });
      await expect(deleteEmployeeQualification(supabase, "qual-1", ["management"])).resolves.toEqual({
        success: true,
      });
    });

    it("enforces delete permission on equipment & equipment types", async () => {
      const supabase = createMockSupabase();

      await expect(deleteEquipment(supabase, "eq-1", ["office"])).rejects.toThrow(/Permission denied/);
      await expect(deleteEquipmentType(supabase, "type-1", ["office"])).rejects.toThrow(
        /Permission denied/,
      );

      await expect(deleteEquipment(supabase, "eq-1", ["management"])).resolves.toEqual({
        success: true,
      });
      await expect(deleteEquipmentType(supabase, "type-1", ["management"])).resolves.toEqual({
        success: true,
      });
    });

    it("enforces delete permission on price items", async () => {
      const supabase = createMockSupabase();

      const blocked = await softDeletePriceItem(supabase, "item-1", ["reviewer"]);
      expect(blocked.ok).toBe(false);

      const ok = await softDeletePriceItem(supabase, "item-1", ["management"]);
      expect(ok.ok).toBe(true);
    });

    it("enforces delete permission on log-book job expenses", async () => {
      const supabase = createMockSupabase();

      await expect(deleteJobExpense(supabase, "exp-1", ["office"])).rejects.toThrow(/Permission denied/);
      await expect(deleteJobExpense(supabase, "exp-1", ["management"])).resolves.toEqual({
        success: true,
      });
    });

    it("enforces delete permission on calendar assignments and leave days", async () => {
      const supabase = createMockSupabase();

      await expect(deleteCalendarAssignment(supabase, "assign-1", ["technician"])).rejects.toThrow(
        /Permission denied/,
      );
      await expect(deleteLeaveDay(supabase, "leave-1", ["technician"])).rejects.toThrow(
        /Permission denied/,
      );

      await expect(deleteCalendarAssignment(supabase, "assign-1", ["management"])).resolves.toEqual({
        success: true,
      });
      await expect(deleteLeaveDay(supabase, "leave-1", ["management"])).resolves.toEqual({
        success: true,
      });
    });

    it("dynamically respects customized permissions matrix from settings", async () => {
      // If management configures Settings permissions matrix to grant delete to 'office'
      const customSupabase = createMockSupabase({
        settingsPermissions: {
          delete: ["management", "office"],
        },
      });

      const res = await deleteEnquiryRecord(customSupabase, "enq-99", ["office"]);
      expect(res.ok).toBe(true);
      expect(customSupabase.rpc).toHaveBeenCalledWith("soft_delete_record", {
        p_table: "enquiries",
        p_id: "enq-99",
      });
    });
  });
});
