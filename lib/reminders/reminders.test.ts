import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getReminderKindForInvoice,
  isInvoiceStatusEligibleForReminders,
  type InvoiceReminderCandidate,
} from "./schedule";
import {
  buildReminderEmailContent,
  resolveReminderMailbox,
  resolveReminderRecipients,
  type ReminderContact,
  type ReminderCustomer,
} from "./sender";
import {
  buildPlannedReminderEmails,
  normalizeInvoiceForPlanning,
  planPaymentReminders,
} from "./plan";

describe("Payment Reminders Schedule (lib/reminders/schedule.ts)", () => {
  const baseInvoice: InvoiceReminderCandidate = {
    due_date: "2026-11-10",
    balance: 50000,
    reminders_paused: false,
    status: "issued",
    kind: "tax_invoice",
  };

  it("returns null for dates more than 2 days before the due date", () => {
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-06")).toBeNull();
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-07")).toBeNull();
  });

  it("returns 'before_due' exactly 2 days before the due date", () => {
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-08")).toBe("before_due");
  });

  it("returns null exactly 1 day before the due date (no reminder)", () => {
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-09")).toBeNull();
  });

  it("returns 'on_due' on the due date", () => {
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-10")).toBe("on_due");
  });

  it("returns null for days 1 through 4 after the due date (quiet buffer)", () => {
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-11")).toBeNull(); // Day +1
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-12")).toBeNull(); // Day +2
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-13")).toBeNull(); // Day +3
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-14")).toBeNull(); // Day +4
  });

  it("returns 'overdue' daily starting from the 5th day after due date onwards", () => {
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-15")).toBe("overdue"); // Day +5
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-16")).toBe("overdue"); // Day +6
    expect(getReminderKindForInvoice(baseInvoice, "2026-11-20")).toBe("overdue"); // Day +10
    expect(getReminderKindForInvoice(baseInvoice, "2026-12-10")).toBe("overdue"); // Day +30
  });

  it("allows 'issued' and 'partly_paid' tax invoices and rejects 'draft', 'paid', 'cancelled', and 'proforma'", () => {
    expect(isInvoiceStatusEligibleForReminders("issued", "tax_invoice")).toBe(true);
    expect(isInvoiceStatusEligibleForReminders("partly_paid", "tax_invoice")).toBe(true);
    expect(isInvoiceStatusEligibleForReminders("draft", "tax_invoice")).toBe(false);
    expect(isInvoiceStatusEligibleForReminders("paid", "tax_invoice")).toBe(false);
    expect(isInvoiceStatusEligibleForReminders("cancelled", "tax_invoice")).toBe(false);
    expect(isInvoiceStatusEligibleForReminders("issued", "proforma")).toBe(false);

    expect(
      getReminderKindForInvoice({ ...baseInvoice, status: "partly_paid" }, "2026-11-10"),
    ).toBe("on_due");
    expect(
      getReminderKindForInvoice({ ...baseInvoice, status: "draft" }, "2026-11-10"),
    ).toBeNull();
    expect(
      getReminderKindForInvoice({ ...baseInvoice, status: "paid" }, "2026-11-10"),
    ).toBeNull();
    expect(
      getReminderKindForInvoice({ ...baseInvoice, status: "cancelled" }, "2026-11-10"),
    ).toBeNull();
    expect(
      getReminderKindForInvoice({ ...baseInvoice, kind: "proforma" }, "2026-11-10"),
    ).toBeNull();
  });

  it("returns null if the balance is 0 or negative (paid in full)", () => {
    expect(
      getReminderKindForInvoice({ ...baseInvoice, balance: 0 }, "2026-11-10"),
    ).toBeNull();
    expect(
      getReminderKindForInvoice({ ...baseInvoice, balance: -100 }, "2026-11-15"),
    ).toBeNull();
    expect(
      getReminderKindForInvoice({ ...baseInvoice, balance: null }, "2026-11-10"),
    ).toBeNull();
  });

  it("returns null if reminders_paused is true, even on due or overdue dates", () => {
    expect(
      getReminderKindForInvoice(
        { ...baseInvoice, reminders_paused: true },
        "2026-11-08",
      ),
    ).toBeNull();
    expect(
      getReminderKindForInvoice(
        { ...baseInvoice, reminders_paused: true },
        "2026-11-10",
      ),
    ).toBeNull();
    expect(
      getReminderKindForInvoice(
        { ...baseInvoice, reminders_paused: true },
        "2026-11-16",
      ),
    ).toBeNull();
  });

  it("returns null if due_date is null or missing", () => {
    expect(
      getReminderKindForInvoice({ ...baseInvoice, due_date: null }, "2026-11-10"),
    ).toBeNull();
    expect(
      getReminderKindForInvoice({ ...baseInvoice, due_date: "" }, "2026-11-10"),
    ).toBeNull();
  });
});

describe("Payment Reminders Sender (lib/reminders/sender.ts)", () => {
  it("resolves the 'from' mailbox from the customer's mailbox column (TDPS rule)", () => {
    const tdpsCustomer: ReminderCustomer = { mailbox: "tdps-desk@bita.example" };
    expect(resolveReminderMailbox(tdpsCustomer)).toBe("tdps-desk@bita.example");

    const defaultCustomer: ReminderCustomer = { mailbox: null };
    expect(resolveReminderMailbox(defaultCustomer)).toBeNull();

    expect(resolveReminderMailbox(null)).toBeNull();
  });

  it("resolves recipient emails from contacts with receives_invoices = true only", () => {
    const contacts: ReminderContact[] = [
      { email: "accounts@fakeclient.com", receives_invoices: true },
      { email: "finance@fakeclient.com", receives_invoices: true },
      { email: "site-engineer@fakeclient.com", receives_invoices: false },
      { email: null, receives_invoices: true },
      { email: "accounts@fakeclient.com", receives_invoices: true }, // Duplicate
    ];

    const recipients = resolveReminderRecipients(contacts);
    expect(recipients).toEqual([
      "accounts@fakeclient.com",
      "finance@fakeclient.com",
    ]);
  });

  it("handles empty or missing contact lists gracefully", () => {
    expect(resolveReminderRecipients([])).toEqual([]);
    expect(resolveReminderRecipients(null)).toEqual([]);
    expect(resolveReminderRecipients(undefined)).toEqual([]);
  });

  it("builds email-only subject and body for before_due, on_due, and overdue reminders", () => {
    const beforeDue = buildReminderEmailContent({
      invoice_no: "BITA/INV/26-27/0012",
      invoice_date: "2026-10-12",
      due_date: "2026-11-12",
      scheduled_for: "2026-11-10",
      kind: "before_due",
      total: 118000,
      balance: 50000,
      customer_name: "Peenya Forge Pvt Ltd",
      job_no: "BITA/26-27/0045",
    });

    expect(beforeDue.subject).toContain("Upcoming Payment Reminder: Invoice BITA/INV/26-27/0012");
    expect(beforeDue.subject).toContain("Job BITA/26-27/0045");
    expect(beforeDue.body).toContain("Dear Peenya Forge Pvt Ltd,");
    expect(beforeDue.body).toContain("in 2 days");
    expect(beforeDue.body).toContain("₹50,000.00");

    const overdue = buildReminderEmailContent({
      invoice_no: "BITA/INV/26-27/0008",
      invoice_date: "2026-10-01",
      due_date: "2026-11-01",
      scheduled_for: "2026-11-08",
      kind: "overdue",
      total: 59000,
      balance: 59000,
      customer_name: "Kaveri Heavy Engg",
      job_no: "BITA/26-27/0019",
    });

    expect(overdue.subject).toContain("Overdue Payment Reminder (7 days past due)");
    expect(overdue.body).toContain("by 7 days");
    expect(overdue.body).toContain("BITA/INV/26-27/0008");
  });
});

describe("Payment Reminders Plan (lib/reminders/plan.ts)", () => {
  const targetDate = "2026-11-10";

  const sampleInvoices = [
    {
      id: "inv-before-due",
      status: "issued",
      kind: "tax_invoice",
      invoice_no: "BITA/INV/26-27/0001",
      due_date: "2026-11-12", // 2 days after targetDate -> targetDate is 2 days before
      total: 11800,
      balance: 10000,
      reminders_paused: false,
      job_no: "BITA/26-27/0001",
      customer: { name: "Client A", mailbox: "client-a@bita.example" },
      contacts: [{ email: "pay@client-a.com", receives_invoices: true }],
    },
    {
      id: "inv-on-due",
      status: "partly_paid",
      kind: "tax_invoice",
      invoice_no: "BITA/INV/26-27/0002",
      due_date: "2026-11-10", // Exactly on targetDate
      total: 50000,
      balance: 25000,
      reminders_paused: false,
      job_no: "BITA/26-27/0002",
      customer: { name: "TDPS Fake", mailbox: "tdps-desk@bita.example" },
      contacts: [{ email: "finance@tdps.example", receives_invoices: true }],
    },
    {
      id: "inv-overdue",
      status: "issued",
      kind: "tax_invoice",
      invoice_no: "BITA/INV/26-27/0003",
      due_date: "2026-11-05", // 5 days before targetDate -> overdue
      total: 40000,
      balance: 40000,
      reminders_paused: false,
      job_no: "BITA/26-27/0003",
      customer: { name: "Client C", mailbox: null },
      contacts: [{ email: "billing@client-c.com", receives_invoices: true }],
    },
    {
      id: "inv-draft-ignored",
      status: "draft",
      kind: "tax_invoice",
      due_date: "2026-11-10",
      balance: 20000,
      reminders_paused: false,
    },
    {
      id: "inv-cancelled-ignored",
      status: "cancelled",
      kind: "tax_invoice",
      due_date: "2026-11-10",
      balance: 20000,
      reminders_paused: false,
    },
    {
      id: "inv-proforma-ignored",
      status: "issued",
      kind: "proforma",
      due_date: "2026-11-10",
      balance: 20000,
      reminders_paused: false,
    },
    {
      id: "inv-quiet-buffer",
      status: "issued",
      kind: "tax_invoice",
      due_date: "2026-11-08", // 2 days overdue -> quiet buffer, no reminder
      balance: 15000,
      reminders_paused: false,
    },
    {
      id: "inv-already-planned",
      status: "issued",
      kind: "tax_invoice",
      due_date: "2026-11-10",
      balance: 30000,
      reminders_paused: false,
      customer: { mailbox: null },
      contacts: [{ email: "ap@client-d.com", receives_invoices: true }],
    },
    {
      id: "inv-paid",
      status: "paid",
      kind: "tax_invoice",
      due_date: "2026-11-10",
      balance: 0,
      reminders_paused: false,
    },
    {
      id: "inv-paused",
      status: "issued",
      kind: "tax_invoice",
      due_date: "2026-11-10",
      balance: 50000,
      reminders_paused: true,
    },
  ];

  it("plans reminders for eligible issued/partly_paid tax invoices and skips drafts, proformas, or existing rows", () => {
    const existing = [
      { invoice_id: "inv-already-planned", scheduled_for: targetDate },
    ];

    const planned = planPaymentReminders(sampleInvoices, existing, targetDate);

    expect(planned).toHaveLength(3);

    // 1. Before due
    expect(planned.find((p) => p.invoice_id === "inv-before-due")).toEqual({
      invoice_id: "inv-before-due",
      scheduled_for: targetDate,
      kind: "before_due",
      from_mailbox: "client-a@bita.example",
      sent_to: ["pay@client-a.com"],
    });

    // 2. On due (TDPS mailbox verified)
    expect(planned.find((p) => p.invoice_id === "inv-on-due")).toEqual({
      invoice_id: "inv-on-due",
      scheduled_for: targetDate,
      kind: "on_due",
      from_mailbox: "tdps-desk@bita.example",
      sent_to: ["finance@tdps.example"],
    });

    // 3. Overdue
    expect(planned.find((p) => p.invoice_id === "inv-overdue")).toEqual({
      invoice_id: "inv-overdue",
      scheduled_for: targetDate,
      kind: "overdue",
      from_mailbox: null,
      sent_to: ["billing@client-c.com"],
    });

    // 4. Draft, cancelled, proforma, and already-planned were skipped
    expect(planned.find((p) => p.invoice_id === "inv-draft-ignored")).toBeUndefined();
    expect(planned.find((p) => p.invoice_id === "inv-cancelled-ignored")).toBeUndefined();
    expect(planned.find((p) => p.invoice_id === "inv-proforma-ignored")).toBeUndefined();
    expect(planned.find((p) => p.invoice_id === "inv-already-planned")).toBeUndefined();
  });

  it("builds complete email payloads for n8n from planned reminders", () => {
    const planned = planPaymentReminders(sampleInvoices, [], targetDate);
    const idMap = new Map([["inv-on-due", "rem-uuid-2"]]);
    const emails = buildPlannedReminderEmails(sampleInvoices, planned, idMap);

    const onDueEmail = emails.find((e) => e.invoice_id === "inv-on-due");
    expect(onDueEmail).toBeDefined();
    expect(onDueEmail?.reminder_id).toBe("rem-uuid-2");
    expect(onDueEmail?.invoice_no).toBe("BITA/INV/26-27/0002");
    expect(onDueEmail?.customer_name).toBe("TDPS Fake");
    expect(onDueEmail?.from_mailbox).toBe("tdps-desk@bita.example");
    expect(onDueEmail?.sent_to).toEqual(["finance@tdps.example"]);
    expect(onDueEmail?.subject).toContain("Payment Due Today: Invoice BITA/INV/26-27/0002");
    expect(onDueEmail?.body).toContain("₹25,000.00");
  });

  it("normalizes joined database rows correctly", () => {
    const rawJoin = {
      id: "raw-inv-1",
      status: "issued",
      kind: "tax_invoice",
      invoice_no: "BITA/INV/26-27/0099",
      due_date: "2026-11-10",
      total: "14750.00",
      balance: "12500.50",
      reminders_paused: false,
      jobs: {
        job_no: "BITA/26-27/0099",
        customer: {
          name: "Test Customer Ltd",
          mailbox: "accounts-mailbox@bita.example",
          customer_contacts: [
            { email: "c1@test.com", receives_invoices: true },
            { email: "c2@test.com", receives_invoices: false },
          ],
        },
      },
    };

    const normalized = normalizeInvoiceForPlanning(rawJoin);
    expect(normalized.id).toBe("raw-inv-1");
    expect(normalized.status).toBe("issued");
    expect(normalized.kind).toBe("tax_invoice");
    expect(normalized.invoice_no).toBe("BITA/INV/26-27/0099");
    expect(normalized.job_no).toBe("BITA/26-27/0099");
    expect(normalized.balance).toBe(12500.5);
    expect(normalized.customer?.name).toBe("Test Customer Ltd");
    expect(normalized.customer?.mailbox).toBe("accounts-mailbox@bita.example");
    expect(normalized.contacts).toHaveLength(2);
  });

  it("exports a valid email-only n8n workflow in n8n/payment-reminders-email.json with no WhatsApp nodes", () => {
    const workflowPath = resolve(process.cwd(), "n8n/payment-reminders-email.json");
    const rawJson = readFileSync(workflowPath, "utf8");
    const workflow = JSON.parse(rawJson) as {
      name: string;
      nodes: Array<{ name: string; type: string; parameters: Record<string, unknown> }>;
    };

    expect(workflow.name).toContain("Email Only");
    expect(Array.isArray(workflow.nodes)).toBe(true);
    expect(workflow.nodes.some((n) => n.type === "n8n-nodes-base.emailSend")).toBe(true);
    expect(
      workflow.nodes.some((n) => n.type.toLowerCase().includes("whatsapp")),
    ).toBe(false);
    expect(rawJson.toLowerCase()).not.toContain("whatsapp");
  });
});
