export const LOG_BOOK_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type LogBookStatus = (typeof LOG_BOOK_STATUSES)[number];

export const EXPENSE_KINDS = ["travel", "food", "lodging", "consumables", "other"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  travel: "Travel",
  food: "Food",
  lodging: "Lodging",
  consumables: "Consumables",
  other: "Other",
};

export interface CreateJobExpenseInput {
  job_id: string;
  log_book_id?: string | null;
  person_id?: string | null;
  expense_date?: string;
  kind: ExpenseKind;
  amount: number;
  note?: string | null;
}

export interface UpdateLogBookEntryInput {
  status?: LogBookStatus;
  notes?: string | null;
  work_date?: string;
  end_date?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function isValidDateStr(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value.trim())) return false;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value.trim();
}

export function isLogBookStatus(value: unknown): value is LogBookStatus {
  return typeof value === "string" && (LOG_BOOK_STATUSES as readonly string[]).includes(value);
}

export function isExpenseKind(value: unknown): value is ExpenseKind {
  return typeof value === "string" && (EXPENSE_KINDS as readonly string[]).includes(value);
}

export function todayIST(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function currentMonthIST(now = new Date()): string {
  return todayIST(now).slice(0, 7);
}

export function parseMonthRange(monthStr?: string | null): {
  month: string;
  startDate: string;
  endDate: string;
} {
  const m =
    monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim())
      ? monthStr.trim()
      : currentMonthIST();

  const [yStr, mStr] = m.split("-");
  const year = Number(yStr);
  const monthIdx = Number(mStr); // 1..12
  if (!Number.isFinite(year) || monthIdx < 1 || monthIdx > 12) {
    return parseMonthRange(currentMonthIST());
  }

  const startDate = `${yStr}-${mStr}-01`;
  // Last day of month: day 0 of next month in UTC
  const lastDay = new Date(Date.UTC(year, monthIdx, 0)).getUTCDate();
  const endDate = `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`;

  return { month: m, startDate, endDate };
}

export function parseJobExpenseInput(raw: Record<string, unknown>): CreateJobExpenseInput {
  const jobId = typeof raw.job_id === "string" ? raw.job_id.trim() : "";
  if (!isValidUuid(jobId)) {
    throw new Error("A valid job is required for the expense.");
  }

  const logBookIdRaw = typeof raw.log_book_id === "string" ? raw.log_book_id.trim() : "";
  const logBookId = logBookIdRaw ? logBookIdRaw : null;
  if (logBookId && !isValidUuid(logBookId)) {
    throw new Error("Invalid log book entry reference.");
  }

  const personIdRaw = typeof raw.person_id === "string" ? raw.person_id.trim() : "";
  const personId = personIdRaw ? personIdRaw : null;
  if (personId && !isValidUuid(personId)) {
    throw new Error("Invalid technician/person reference.");
  }

  const kindRaw = typeof raw.kind === "string" ? raw.kind.trim().toLowerCase() : "travel";
  if (!isExpenseKind(kindRaw)) {
    throw new Error("Choose a valid expense kind (travel, food, lodging, consumables, or other).");
  }

  const amountNum =
    typeof raw.amount === "number"
      ? raw.amount
      : typeof raw.amount === "string" && raw.amount.trim() !== ""
        ? Number(raw.amount)
        : NaN;

  if (!Number.isFinite(amountNum) || amountNum < 0) {
    throw new Error("Enter a valid non-negative expense amount.");
  }

  const expenseDateRaw =
    typeof raw.expense_date === "string" && raw.expense_date.trim() !== ""
      ? raw.expense_date.trim()
      : todayIST();

  if (!isValidDateStr(expenseDateRaw)) {
    throw new Error("Enter a valid expense date (YYYY-MM-DD).");
  }

  const noteRaw = typeof raw.note === "string" ? raw.note.trim() : "";

  return {
    job_id: jobId,
    log_book_id: logBookId,
    person_id: personId,
    expense_date: expenseDateRaw,
    kind: kindRaw,
    amount: Math.round(amountNum * 100) / 100,
    note: noteRaw || null,
  };
}

export function parseUpdateLogBookEntryInput(
  raw: Record<string, unknown>
): UpdateLogBookEntryInput {
  const out: UpdateLogBookEntryInput = {};

  if (raw.status !== undefined) {
    if (!isLogBookStatus(raw.status)) {
      throw new Error("Invalid log book status. Expected scheduled, completed, or cancelled.");
    }
    out.status = raw.status;
  }

  if (raw.notes !== undefined) {
    out.notes = typeof raw.notes === "string" && raw.notes.trim() !== "" ? raw.notes.trim() : null;
  }

  if (raw.work_date !== undefined && raw.work_date !== "") {
    if (!isValidDateStr(raw.work_date)) {
      throw new Error("Enter a valid work date (YYYY-MM-DD).");
    }
    out.work_date = raw.work_date.trim();
  }

  if (raw.end_date !== undefined) {
    if (raw.end_date === null || raw.end_date === "") {
      out.end_date = null;
    } else if (!isValidDateStr(raw.end_date)) {
      throw new Error("Enter a valid end date (YYYY-MM-DD).");
    } else {
      out.end_date = raw.end_date.trim();
    }
  }

  if (out.work_date && out.end_date && out.end_date < out.work_date) {
    throw new Error("End date cannot be earlier than work date.");
  }

  return out;
}

export function computeExpenseTotals(
  expenses: ReadonlyArray<{
    job_id: string;
    expense_date: string;
    kind: string;
    amount: number;
  }>,
  month?: string
): {
  totalAll: number;
  monthlyTotal: number;
  byJob: Record<string, number>;
  byKind: Record<ExpenseKind, number>;
} {
  const byJob: Record<string, number> = {};
  const byKind: Record<ExpenseKind, number> = {
    travel: 0,
    food: 0,
    lodging: 0,
    consumables: 0,
    other: 0,
  };

  let totalAll = 0;
  let monthlyTotal = 0;

  for (const exp of expenses) {
    const amt = Number(exp.amount) || 0;
    totalAll = Math.round((totalAll + amt) * 100) / 100;
    byJob[exp.job_id] = Math.round(((byJob[exp.job_id] ?? 0) + amt) * 100) / 100;

    const k: ExpenseKind = isExpenseKind(exp.kind) ? exp.kind : "other";
    byKind[k] = Math.round((byKind[k] + amt) * 100) / 100;

    if (!month || exp.expense_date.startsWith(month)) {
      monthlyTotal = Math.round((monthlyTotal + amt) * 100) / 100;
    }
  }

  return {
    totalAll,
    monthlyTotal,
    byJob,
    byKind,
  };
}
