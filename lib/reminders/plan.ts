import { todayIST } from "../dates";
import type { Database } from "../db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ELIGIBLE_REMINDER_STATUSES,
  getReminderKindForInvoice,
  type InvoiceReminderCandidate,
  type ReminderKind,
} from "./schedule";
import {
  buildReminderEmailContent,
  resolveReminderMailbox,
  resolveReminderRecipients,
  type ReminderContact,
  type ReminderCustomer,
} from "./sender";

export interface InvoiceForPlanning extends InvoiceReminderCandidate {
  id: string;
  invoice_no?: string | null;
  number?: string | null;
  invoice_date?: string | null;
  total?: number | null;
  job_no?: string | null;
  customer?: ReminderCustomer | null;
  contacts?: ReminderContact[] | null;
}

export interface ExistingReminderKey {
  invoice_id: string;
  scheduled_for: string;
}

export interface PlannedPaymentReminder {
  invoice_id: string;
  scheduled_for: string;
  kind: ReminderKind;
  from_mailbox: string | null;
  sent_to: string[];
}

export interface PlannedReminderEmail extends PlannedPaymentReminder {
  reminder_id: string | null;
  invoice_no: string;
  invoice_date: string | null;
  due_date: string;
  job_no: string | null;
  customer_name: string | null;
  total: number;
  balance: number;
  subject: string;
  body: string;
}

/**
 * Type guard to check if an object is already a normalized InvoiceForPlanning.
 */
export function isInvoiceForPlanning(obj: unknown): obj is InvoiceForPlanning {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "id" in obj &&
    typeof (obj as { id?: unknown }).id === "string" &&
    !("jobs" in obj) &&
    !("job" in obj)
  );
}

/**
 * Normalizes database invoice rows that may have nested job -> customer -> contacts joins.
 */
export function normalizeInvoiceForPlanning(
  raw: Record<string, unknown>,
): InvoiceForPlanning {
  const job = (raw.jobs || raw.job) as Record<string, unknown> | undefined;
  const customer = (raw.customers || raw.customer || job?.customers || job?.customer) as
    | Record<string, unknown>
    | undefined;

  const rawContacts =
    raw.customer_contacts ||
    raw.contacts ||
    customer?.customer_contacts ||
    customer?.contacts;

  const contacts: ReminderContact[] = Array.isArray(rawContacts)
    ? rawContacts.map((c: unknown) => {
        const contactObj =
          typeof c === "object" && c !== null ? (c as Record<string, unknown>) : {};
        return {
          name: typeof contactObj.name === "string" ? contactObj.name : null,
          email: typeof contactObj.email === "string" ? contactObj.email : null,
          receives_invoices: Boolean(contactObj.receives_invoices),
        };
      })
    : [];

  return {
    id: String(raw.id),
    status: typeof raw.status === "string" ? raw.status : undefined,
    kind: typeof raw.kind === "string" ? raw.kind : undefined,
    invoice_no: typeof raw.invoice_no === "string" ? raw.invoice_no : null,
    number: typeof raw.number === "string" ? raw.number : null,
    invoice_date: typeof raw.invoice_date === "string" ? raw.invoice_date : null,
    due_date: typeof raw.due_date === "string" ? raw.due_date : null,
    total:
      raw.total !== null && raw.total !== undefined ? Number(raw.total) : null,
    balance:
      raw.balance !== null && raw.balance !== undefined
        ? Number(raw.balance)
        : null,
    reminders_paused: Boolean(raw.reminders_paused),
    job_no:
      typeof raw.job_no === "string"
        ? raw.job_no
        : typeof job?.job_no === "string"
          ? job.job_no
          : null,
    customer: customer
      ? {
          name: typeof customer.name === "string" ? customer.name : null,
          mailbox: typeof customer.mailbox === "string" ? customer.mailbox : null,
        }
      : null,
    contacts,
  };
}

/**
 * Builds the list of payment_reminders records due on the given day (default: today in IST).
 * Skips invoices that:
 * - Are not eligible in-app tax invoices (e.g. status draft/paid/cancelled or kind proforma)
 * - Have no reminder due on this date (based on schedule rules)
 * - Already have a reminder in the table for (invoice_id, scheduled_for)
 */
export function planPaymentReminders(
  invoices: Array<InvoiceForPlanning | Record<string, unknown>>,
  existingReminders: ExistingReminderKey[] | Set<string> = [],
  today: string = todayIST(),
): PlannedPaymentReminder[] {
  const existingSet =
    existingReminders instanceof Set
      ? existingReminders
      : new Set(
          existingReminders.map(
            (r) => `${r.invoice_id}:${r.scheduled_for}`,
          ),
        );

  const planned: PlannedPaymentReminder[] = [];

  for (const raw of invoices) {
    const inv: InvoiceForPlanning = isInvoiceForPlanning(raw)
      ? raw
      : normalizeInvoiceForPlanning(raw as Record<string, unknown>);

    const kind = getReminderKindForInvoice(inv, today);
    if (!kind) {
      continue;
    }

    const key = `${inv.id}:${today}`;
    if (existingSet.has(key)) {
      continue;
    }

    const from_mailbox = resolveReminderMailbox(inv.customer);
    const sent_to = resolveReminderRecipients(inv.contacts);

    planned.push({
      invoice_id: inv.id,
      scheduled_for: today,
      kind,
      from_mailbox,
      sent_to,
    });
  }

  return planned;
}

/**
 * Builds rich email-only reminder payloads for n8n from planned reminders and normalized invoices.
 */
export function buildPlannedReminderEmails(
  invoices: InvoiceForPlanning[],
  planned: PlannedPaymentReminder[],
  reminderIdByInvoiceId: Map<string, string> = new Map(),
): PlannedReminderEmail[] {
  const invoiceById = new Map<string, InvoiceForPlanning>();
  for (const inv of invoices) {
    invoiceById.set(inv.id, inv);
  }

  return planned.map((p) => {
    const inv = invoiceById.get(p.invoice_id);
    const invoiceNo =
      inv?.invoice_no?.trim() || inv?.number?.trim() || p.invoice_id;
    const dueDate = inv?.due_date ?? p.scheduled_for;
    const balance = Number(inv?.balance ?? 0);
    const total =
      inv?.total !== null && inv?.total !== undefined
        ? Number(inv.total)
        : balance;
    const customerName = inv?.customer?.name ?? null;
    const jobNo = inv?.job_no ?? null;
    const invoiceDate = inv?.invoice_date ?? null;

    const { subject, body } = buildReminderEmailContent({
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      due_date: dueDate,
      scheduled_for: p.scheduled_for,
      kind: p.kind,
      total,
      balance,
      customer_name: customerName,
      job_no: jobNo,
    });

    return {
      reminder_id: reminderIdByInvoiceId.get(p.invoice_id) ?? null,
      invoice_id: p.invoice_id,
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      due_date: dueDate,
      job_no: jobNo,
      customer_name: customerName,
      total,
      balance,
      scheduled_for: p.scheduled_for,
      kind: p.kind,
      from_mailbox: p.from_mailbox,
      sent_to: p.sent_to,
      subject,
      body,
    };
  });
}

/**
 * Fetches eligible in-app tax invoices from Supabase (kind = 'tax_invoice',
 * status in ['issued', 'partly_paid'], balance > 0, reminders_paused = false, due_date not null),
 * calculates reminders due on targetDate, checks existing reminders to prevent duplicates,
 * inserts the planned rows into payment_reminders, and returns both raw records and
 * email-ready payloads for the n8n workflow.
 */
export async function planAndInsertReminders(
  supabase: SupabaseClient<Database>,
  targetDate: string = todayIST(),
): Promise<{
  scheduled_for: string;
  total_invoices_scanned: number;
  planned_count: number;
  inserted_count: number;
  records: PlannedPaymentReminder[];
  emails: PlannedReminderEmail[];
}> {
  // 1. Fetch in-app tax invoices with status issued/partly_paid, balance > 0, unpaused, due_date set
  const { data: invoices, error: invError } = await supabase
    .from("invoices")
    .select(
      "id, job_id, kind, status, invoice_no, number, invoice_date, due_date, total, balance, reminders_paused",
    )
    .eq("kind", "tax_invoice")
    .in("status", [...ELIGIBLE_REMINDER_STATUSES])
    .gt("balance", 0)
    .eq("reminders_paused", false)
    .not("due_date", "is", null);

  if (invError) {
    throw new Error(`Failed to fetch invoices: ${invError.message}`);
  }

  const invoiceList = invoices ?? [];

  // Filter to invoices that match today's reminder schedule
  const candidates = invoiceList.filter((inv) =>
    Boolean(getReminderKindForInvoice(inv, targetDate)),
  );

  if (candidates.length === 0) {
    return {
      scheduled_for: targetDate,
      total_invoices_scanned: invoiceList.length,
      planned_count: 0,
      inserted_count: 0,
      records: [],
      emails: [],
    };
  }

  // 2. Fetch existing reminders for this target date
  const candidateIds = candidates.map((c) => c.id);
  const { data: existing, error: existError } = await supabase
    .from("payment_reminders")
    .select("invoice_id, scheduled_for")
    .eq("scheduled_for", targetDate)
    .in("invoice_id", candidateIds);

  if (existError) {
    throw new Error(`Failed to check existing reminders: ${existError.message}`);
  }

  const existingKeys = new Set(
    (existing ?? []).map((e) => `${e.invoice_id}:${e.scheduled_for}`),
  );

  // Invoices still needing planning
  const needingPlanning = candidates.filter(
    (c) => !existingKeys.has(`${c.id}:${targetDate}`),
  );

  if (needingPlanning.length === 0) {
    return {
      scheduled_for: targetDate,
      total_invoices_scanned: invoiceList.length,
      planned_count: 0,
      inserted_count: 0,
      records: [],
      emails: [],
    };
  }

  // 3. Resolve job_no, customer name/mailbox, and contacts with receives_invoices = true
  const jobIds = Array.from(new Set(needingPlanning.map((c) => c.job_id)));
  const { data: jobs, error: jobError } = await supabase
    .from("jobs")
    .select("id, job_no, customer_id")
    .in("id", jobIds);

  if (jobError) {
    throw new Error(`Failed to fetch jobs for invoices: ${jobError.message}`);
  }

  const jobMap = new Map<string, { job_no: string; customer_id: string }>();
  for (const j of jobs ?? []) {
    jobMap.set(j.id, { job_no: j.job_no, customer_id: j.customer_id });
  }

  const customerIds = Array.from(
    new Set(Array.from(jobMap.values()).map((j) => j.customer_id)),
  );

  const [custRes, contactsRes] = await Promise.all([
    supabase.from("customers").select("id, name, mailbox").in("id", customerIds),
    supabase
      .from("customer_contacts")
      .select("customer_id, name, email, receives_invoices")
      .in("customer_id", customerIds)
      .eq("receives_invoices", true),
  ]);

  if (custRes.error) {
    throw new Error(`Failed to fetch customers: ${custRes.error.message}`);
  }
  if (contactsRes.error) {
    throw new Error(`Failed to fetch customer contacts: ${contactsRes.error.message}`);
  }

  const customerMap = new Map<string, { name: string | null; mailbox: string | null }>();
  for (const c of custRes.data ?? []) {
    customerMap.set(c.id, { name: c.name, mailbox: c.mailbox });
  }

  const contactsMap = new Map<
    string,
    Array<{ name: string | null; email: string | null; receives_invoices: boolean }>
  >();
  for (const ct of contactsRes.data ?? []) {
    const list = contactsMap.get(ct.customer_id) ?? [];
    list.push({
      name: ct.name,
      email: ct.email,
      receives_invoices: ct.receives_invoices,
    });
    contactsMap.set(ct.customer_id, list);
  }

  const fullInvoices: InvoiceForPlanning[] = needingPlanning.map((inv) => {
    const jobInfo = jobMap.get(inv.job_id);
    const customerId = jobInfo?.customer_id;
    const customer = customerId ? customerMap.get(customerId) ?? null : null;
    const contacts = customerId ? contactsMap.get(customerId) ?? [] : [];
    return {
      id: inv.id,
      status: inv.status,
      kind: inv.kind,
      invoice_no: inv.invoice_no,
      number: inv.number,
      invoice_date: inv.invoice_date,
      due_date: inv.due_date,
      total: inv.total,
      balance: inv.balance,
      reminders_paused: inv.reminders_paused,
      job_no: jobInfo?.job_no ?? null,
      customer,
      contacts,
    };
  });

  const planned = planPaymentReminders(fullInvoices, existingKeys, targetDate);

  let insertedCount = 0;
  const reminderIdByInvoiceId = new Map<string, string>();

  if (planned.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from("payment_reminders")
      .insert(
        planned.map((p) => ({
          invoice_id: p.invoice_id,
          scheduled_for: p.scheduled_for,
          kind: p.kind,
          from_mailbox: p.from_mailbox,
          sent_to: p.sent_to,
        })),
      )
      .select("id, invoice_id");

    if (insertError) {
      throw new Error(`Failed to insert payment reminders: ${insertError.message}`);
    }
    insertedCount = planned.length;
    for (const row of insertedRows ?? []) {
      reminderIdByInvoiceId.set(row.invoice_id, row.id);
    }
  }

  const emails = buildPlannedReminderEmails(
    fullInvoices,
    planned,
    reminderIdByInvoiceId,
  );

  return {
    scheduled_for: targetDate,
    total_invoices_scanned: invoiceList.length,
    planned_count: planned.length,
    inserted_count: insertedCount,
    records: planned,
    emails,
  };
}
