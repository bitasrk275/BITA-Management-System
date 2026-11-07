import { daysBetween, shortDate } from "../dates";
import type { ReminderKind } from "./schedule";

export interface ReminderCustomer {
  name?: string | null;
  mailbox?: string | null;
}

export interface ReminderContact {
  name?: string | null;
  email?: string | null;
  receives_invoices?: boolean | null;
}

export interface ReminderEmailContext {
  invoice_no: string;
  invoice_date?: string | null;
  due_date: string;
  scheduled_for: string;
  kind: ReminderKind;
  total?: number | null;
  balance: number;
  customer_name?: string | null;
  job_no?: string | null;
}

export interface ReminderEmailContent {
  subject: string;
  body: string;
}

/**
 * Resolves the sender mailbox from the customer record.
 * TDPS and other dedicated accounts specify their own BITA mailbox in customers.mailbox.
 * Returns null if no mailbox is configured on the customer.
 */
export function resolveReminderMailbox(
  customer?: ReminderCustomer | null,
): string | null {
  if (!customer?.mailbox) {
    return null;
  }
  const mailbox = customer.mailbox.trim();
  return mailbox.length > 0 ? mailbox : null;
}

/**
 * Resolves recipient email addresses for an invoice payment reminder.
 * Looks up customer contacts flagged with receives_invoices = true.
 * Trims, lowercases, validates basic email shape, and deduplicates addresses.
 */
export function resolveReminderRecipients(
  contacts?: ReminderContact[] | null,
): string[] {
  if (!contacts || !Array.isArray(contacts)) {
    return [];
  }

  const seen = new Set<string>();
  for (const c of contacts) {
    if (c.receives_invoices && c.email) {
      const email = c.email.trim().toLowerCase();
      if (email.length > 0 && email.includes("@")) {
        seen.add(email);
      }
    }
  }

  return Array.from(seen);
}

function formatINRPlain(amount: number): string {
  const n = Number(amount) || 0;
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Builds the email-only subject and plain-text body for a scheduled payment reminder.
 * No WhatsApp messages are generated (Decision D-016 / T37).
 */
export function buildReminderEmailContent(
  ctx: ReminderEmailContext,
): ReminderEmailContent {
  const invoiceNo = ctx.invoice_no.trim() || "Tax Invoice";
  const customerName = ctx.customer_name?.trim() || "Valued Customer";
  const dueDateDisplay = shortDate(ctx.due_date);
  const invoiceDateDisplay = ctx.invoice_date ? shortDate(ctx.invoice_date) : null;
  const balanceDisplay = formatINRPlain(ctx.balance);
  const totalDisplay =
    ctx.total !== null && ctx.total !== undefined
      ? formatINRPlain(ctx.total)
      : balanceDisplay;

  const daysOverdue = Math.max(0, daysBetween(ctx.due_date, ctx.scheduled_for));

  let subjectPrefix: string;
  let openingLine: string;

  if (ctx.kind === "before_due") {
    subjectPrefix = "Upcoming Payment Reminder";
    openingLine = `This is a gentle reminder that payment for Tax Invoice ${invoiceNo} is due on ${dueDateDisplay} (in 2 days).`;
  } else if (ctx.kind === "on_due") {
    subjectPrefix = "Payment Due Today";
    openingLine = `This is a reminder that payment for Tax Invoice ${invoiceNo} is due today (${dueDateDisplay}).`;
  } else {
    subjectPrefix =
      daysOverdue > 0
        ? `Overdue Payment Reminder (${daysOverdue} days past due)`
        : "Overdue Payment Reminder";
    openingLine = `Our records indicate that payment for Tax Invoice ${invoiceNo}, which was due on ${dueDateDisplay}, remains outstanding${
      daysOverdue > 0 ? ` by ${daysOverdue} days` : ""
    }.`;
  }

  const jobSuffix = ctx.job_no ? ` · Job ${ctx.job_no}` : "";
  const subject = `${subjectPrefix}: Invoice ${invoiceNo}${jobSuffix} – Bangalore Inspection & Testing Agency`;

  const detailsLines = [
    `  • Invoice No      : ${invoiceNo}`,
    ...(invoiceDateDisplay ? [`  • Invoice Date    : ${invoiceDateDisplay}`] : []),
    ...(ctx.job_no ? [`  • BITA Job ID     : ${ctx.job_no}`] : []),
    `  • Due Date        : ${dueDateDisplay}`,
    `  • Invoice Total   : ${totalDisplay}`,
    `  • Balance Due     : ${balanceDisplay}`,
  ];

  const body = [
    `Dear ${customerName},`,
    "",
    openingLine,
    "",
    "Invoice Summary:",
    ...detailsLines,
    "",
    "Kindly arrange the remittance at the earliest and share the UTR / payment reference details with our accounts desk so we may update your ledger.",
    "If payment has already been made, please share the transaction reference and disregard this reminder.",
    "",
    "Warm regards,",
    "Accounts Desk",
    "Bangalore Inspection & Testing Agency (BITA)",
  ].join("\n");

  return { subject, body };
}
