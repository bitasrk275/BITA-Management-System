import type { Enums } from "../../../lib/db/types";
import { daysBetween } from "../../../lib/dates";

export type JobClosureInput = {
  status: Enums<"job_status">;
  reports?: readonly { status: Enums<"report_status">; sent_at?: string | null }[] | null;
  invoices?: readonly {
    kind?: Enums<"invoice_kind">;
    status?: string | null;
    balance: number | null;
  }[] | null;
};

/**
 * T20, T22 & G4: A job is ready to close when:
 * 1. It is not already closed.
 * 2. Its report has been sent (job status is `report_sent` or `invoiced`, or all reports on the job are `sent`),
 *    and no report on the job is still un-sent (`draft`, `in_review`, `returned`, `approved`).
 * 3. At least one non-cancelled tax invoice exists on the job, none is still in `draft`,
 *    and every non-cancelled tax invoice has balance 0 (nothing is outstanding after payments + TDS + credit notes).
 */
export function isJobReadyToClose(job: JobClosureInput): boolean {
  if (job.status === "closed") return false;

  const reports = job.reports ?? [];
  const hasUnsentReport = reports.some((r) => r.status !== "sent" && !r.sent_at);
  if (hasUnsentReport) return false;

  const reportSent =
    job.status === "report_sent" ||
    job.status === "invoiced" ||
    (reports.length > 0 && reports.every((r) => r.status === "sent" || !!r.sent_at));

  if (!reportSent) return false;

  const taxInvoices = (job.invoices ?? []).filter(
    (inv) =>
      (!inv.kind || inv.kind === "tax_invoice") && inv.status !== "cancelled",
  );
  if (taxInvoices.length === 0) return false;
  if (taxInvoices.some((inv) => inv.status === "draft")) return false;

  const outstanding = taxInvoices.reduce(
    (sum, inv) => sum + Math.max(0, Number(inv.balance ?? 0)),
    0,
  );
  if (outstanding > 0) return false;

  return true;
}

export type QualificationAlertRow = {
  id: string;
  method: Enums<"test_method">;
  valid_until: string | null;
  is_expired: boolean | null;
  people: { full_name: string } | null;
};

export type EquipmentAlertRow = {
  id: string;
  make: string | null;
  model: string | null;
  serial_no: string | null;
  calibration_due: string | null;
  active?: boolean;
};

export function classifyQualificationAlert(
  q: QualificationAlertRow,
  today: string,
  horizonDays = 30
): { tone: "bad" | "wait"; title: string; detail: string } | null {
  if (!q.valid_until) return null;
  const daysUntil = daysBetween(today, q.valid_until);
  const expired = q.is_expired === true || q.valid_until < today;
  if (!expired && daysUntil > horizonDays) return null;

  const personName = q.people?.full_name ?? "Technician";
  if (expired) {
    const daysLate = daysBetween(q.valid_until, today);
    return {
      tone: "bad",
      title: `${personName}'s ${q.method} certificate expired`,
      detail: `Valid until ${q.valid_until} · ${daysLate === 0 ? "expired today" : `${daysLate} days ago`}`,
    };
  }

  return {
    tone: "wait",
    title: `${personName}'s ${q.method} certificate expires soon`,
    detail: `Valid until ${q.valid_until} · ${daysUntil === 0 ? "today" : `in ${daysUntil} days`}`,
  };
}

export function classifyEquipmentAlert(
  eq: EquipmentAlertRow,
  today: string,
  horizonDays = 30
): { tone: "bad" | "wait"; title: string; detail: string } | null {
  if (eq.active === false || !eq.calibration_due) return null;
  const daysUntil = daysBetween(today, eq.calibration_due);
  const overdue = eq.calibration_due < today;
  if (!overdue && daysUntil > horizonDays) return null;

  const name = [eq.make, eq.model].filter(Boolean).join(" ") || "Equipment";
  const serial = eq.serial_no ? ` (${eq.serial_no})` : "";
  if (overdue) {
    const daysLate = daysBetween(eq.calibration_due, today);
    return {
      tone: "bad",
      title: `Calibration overdue: ${name}${serial}`,
      detail: `Due ${eq.calibration_due} · ${daysLate === 0 ? "due today" : `${daysLate} days overdue`}`,
    };
  }

  return {
    tone: "wait",
    title: `Calibration due soon: ${name}${serial}`,
    detail: `Due ${eq.calibration_due} · ${daysUntil === 0 ? "due today" : `in ${daysUntil} days`}`,
  };
}

export function resolveEnquiryAttention(
  enquiry: { from_name?: string | null; from_address?: string | null },
  contacts: readonly { name: string; email?: string | null; mobile?: string | null }[]
): string | undefined {
  const addr = enquiry.from_address?.trim().toLowerCase();
  if (addr) {
    const matched = contacts.find(
      (c) =>
        (c.email && c.email.trim().toLowerCase() === addr) ||
        (c.mobile && c.mobile.replace(/\s+/g, "") === addr.replace(/\s+/g, ""))
    );
    if (matched?.name) return matched.name;
  }
  if (enquiry.from_name?.trim()) return enquiry.from_name.trim();
  if (contacts[0]?.name) return contacts[0].name;
  return undefined;
}
