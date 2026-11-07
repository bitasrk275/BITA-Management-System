import { daysBetween, todayIST } from "../dates";

export type ReminderKind = "before_due" | "on_due" | "overdue";

export const ELIGIBLE_REMINDER_STATUSES = ["issued", "partly_paid"] as const;
export type EligibleReminderInvoiceStatus = (typeof ELIGIBLE_REMINDER_STATUSES)[number];

export interface InvoiceReminderCandidate {
  due_date?: string | null;
  balance?: number | string | null;
  reminders_paused?: boolean | null;
  status?: string | null;
  kind?: string | null;
}

/**
 * Checks whether an invoice's status and kind allow payment reminders.
 * - Only tax invoices (kind === "tax_invoice", when kind is provided) are eligible.
 * - Only issued or partly_paid invoices (status in ["issued", "partly_paid"], when status is provided)
 *   are eligible. Draft, paid, and cancelled invoices never receive reminders.
 */
export function isInvoiceStatusEligibleForReminders(
  status?: string | null,
  kind?: string | null,
): boolean {
  if (kind !== undefined && kind !== null && kind !== "tax_invoice") {
    return false;
  }

  if (status !== undefined && status !== null) {
    return (ELIGIBLE_REMINDER_STATUSES as readonly string[]).includes(status);
  }

  return true;
}

/**
 * Returns which reminder is due today for a given in-app tax invoice according to BITA's business rule:
 * - 2 days before the due date: "before_due"
 * - On the due date: "on_due"
 * - 1 to 4 days after the due date: no reminder (null)
 * - 5th day after the due date and daily thereafter: "overdue" until paid
 *
 * Returns null if:
 * - kind is provided and is not "tax_invoice" (e.g. "proforma")
 * - status is provided and is not "issued" or "partly_paid" (e.g. "draft", "paid", "cancelled")
 * - balance is 0 or negative or missing
 * - reminders are paused
 * - due_date is missing or invalid
 * - today does not match one of the scheduled reminder intervals
 */
export function getReminderKindForInvoice(
  invoice: InvoiceReminderCandidate,
  today: string = todayIST(),
): ReminderKind | null {
  if (!isInvoiceStatusEligibleForReminders(invoice.status, invoice.kind)) {
    return null;
  }

  if (invoice.reminders_paused) {
    return null;
  }

  const rawBalance = invoice.balance;
  if (rawBalance === null || rawBalance === undefined) {
    return null;
  }
  const numericBalance = Number(rawBalance);
  if (isNaN(numericBalance) || numericBalance <= 0) {
    return null;
  }

  if (!invoice.due_date || typeof invoice.due_date !== "string") {
    return null;
  }

  const daysDiff = daysBetween(invoice.due_date, today);

  if (daysDiff === -2) {
    return "before_due";
  }

  if (daysDiff === 0) {
    return "on_due";
  }

  if (daysDiff >= 5) {
    return "overdue";
  }

  return null;
}
