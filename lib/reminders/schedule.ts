import { daysBetween, todayIST } from "../dates";

export type ReminderKind = "before_due" | "on_due" | "overdue";

export const ELIGIBLE_REMINDER_STATUSES = ["issued", "partly_paid"] as const;
export type EligibleReminderInvoiceStatus = (typeof ELIGIBLE_REMINDER_STATUSES)[number];

export interface ReminderTimings {
  before_due_days: number;
  on_due: boolean;
  overdue_start_days: number;
  calibration_alert_days?: number;
}

export const DEFAULT_REMINDER_TIMINGS: ReminderTimings = {
  before_due_days: 2,
  on_due: true,
  overdue_start_days: 5,
  calibration_alert_days: 30,
};

export function normalizeReminderTimings(raw?: unknown): ReminderTimings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_REMINDER_TIMINGS };
  }
  const obj = raw as Record<string, unknown>;
  const beforeDue = Number(obj.before_due_days);
  const overdueStart = Number(obj.overdue_start_days);
  const calAlert = Number(obj.calibration_alert_days);
  return {
    before_due_days:
      Number.isFinite(beforeDue) && beforeDue >= 0
        ? Math.trunc(beforeDue)
        : DEFAULT_REMINDER_TIMINGS.before_due_days,
    on_due:
      typeof obj.on_due === "boolean"
        ? obj.on_due
        : DEFAULT_REMINDER_TIMINGS.on_due,
    overdue_start_days:
      Number.isFinite(overdueStart) && overdueStart >= 1
        ? Math.trunc(overdueStart)
        : DEFAULT_REMINDER_TIMINGS.overdue_start_days,
    calibration_alert_days:
      Number.isFinite(calAlert) && calAlert >= 1
        ? Math.trunc(calAlert)
        : DEFAULT_REMINDER_TIMINGS.calibration_alert_days,
  };
}

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
 * - `before_due_days` (default 2) days before the due date: "before_due"
 * - On the due date (if `on_due` is true): "on_due"
 * - 1 to (overdue_start_days - 1) days after the due date: no reminder (null)
 * - `overdue_start_days` (default 5) day after the due date and daily thereafter: "overdue" until paid
 */
export function getReminderKindForInvoice(
  invoice: InvoiceReminderCandidate,
  today: string = todayIST(),
  timings?: Partial<ReminderTimings>,
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

  const resolvedTimings = timings
    ? normalizeReminderTimings(timings)
    : DEFAULT_REMINDER_TIMINGS;

  const daysDiff = daysBetween(invoice.due_date, today);

  if (resolvedTimings.before_due_days > 0 && daysDiff === -resolvedTimings.before_due_days) {
    return "before_due";
  }

  if (resolvedTimings.on_due && daysDiff === 0) {
    return "on_due";
  }

  if (daysDiff >= resolvedTimings.overdue_start_days) {
    return "overdue";
  }

  return null;
}
