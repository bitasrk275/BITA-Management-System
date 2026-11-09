import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/types";
import {
  type CreateJobExpenseInput,
  type ExpenseKind,
  type LogBookStatus,
  type UpdateLogBookEntryInput,
  computeExpenseTotals,
  parseMonthRange,
} from "./schema";

export type LogBookExpenseItem = {
  id: string;
  job_id: string;
  log_book_id: string | null;
  person_id: string | null;
  person_name: string | null;
  expense_date: string;
  kind: ExpenseKind;
  amount: number;
  note: string | null;
  created_at: string;
};

export type LogBookEntryWithDetails = {
  id: string;
  assignment_id: string | null;
  job_id: string;
  job_no: string;
  customer_id: string | null;
  customer_name: string;
  site: string | null;
  scope: string | null;
  person_id: string | null;
  technician_name: string | null;
  work_date: string;
  end_date: string | null;
  status: LogBookStatus;
  notes: string | null;
  job_expense_total: number;
  entry_expenses: LogBookExpenseItem[];
};

export type LogBookOverview = {
  month: string;
  startDate: string;
  endDate: string;
  entries: LogBookEntryWithDetails[];
  expenses: LogBookExpenseItem[];
  totals: {
    totalEntries: number;
    scheduledCount: number;
    completedCount: number;
    cancelledCount: number;
    monthlyExpenseTotal: number;
    totalAllExpenses: number;
    byJob: Record<string, number>;
    byKind: Record<ExpenseKind, number>;
  };
};

export async function listLogBookOverview(
  supabase: SupabaseClient<Database>,
  options: {
    month?: string | null;
    status?: LogBookStatus | "all" | null;
    personId?: string | null;
    jobId?: string | null;
    search?: string | null;
  } = {}
): Promise<LogBookOverview> {
  const { month, startDate, endDate } = parseMonthRange(options.month);

  let entryQuery = supabase
    .from("log_book_entries")
    .select(`
      id,
      assignment_id,
      job_id,
      person_id,
      work_date,
      end_date,
      status,
      notes,
      created_at,
      updated_at,
      job:jobs!log_book_entries_job_id_fkey(
        id,
        job_no,
        site,
        scope,
        customer_id,
        customer:customers!jobs_customer_id_fkey(id, name)
      ),
      person:people!log_book_entries_person_id_fkey(id, full_name)
    `)
    .is("deleted_at", null)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (options.month) {
    entryQuery = entryQuery.gte("work_date", startDate).lte("work_date", endDate);
  }

  if (options.status && options.status !== "all") {
    entryQuery = entryQuery.eq("status", options.status);
  }

  if (options.personId) {
    entryQuery = entryQuery.eq("person_id", options.personId);
  }

  if (options.jobId) {
    entryQuery = entryQuery.eq("job_id", options.jobId);
  }

  const { data: rawEntries, error: entryError } = await entryQuery;
  if (entryError) {
    throw new Error("Failed to load log book entries: " + entryError.message);
  }

  // Fetch all non-deleted job expenses so per-job and monthly totals are accurate
  let expenseQuery = supabase
    .from("job_expenses")
    .select(`
      id,
      job_id,
      log_book_id,
      person_id,
      expense_date,
      kind,
      amount,
      note,
      created_at,
      person:people!job_expenses_person_id_fkey(id, full_name)
    `)
    .is("deleted_at", null)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (options.jobId) {
    expenseQuery = expenseQuery.eq("job_id", options.jobId);
  }

  const { data: rawExpenses, error: expError } = await expenseQuery;
  if (expError) {
    throw new Error("Failed to load job expenses: " + expError.message);
  }

  type RawExpenseRow = {
    id: string;
    job_id: string;
    log_book_id: string | null;
    person_id: string | null;
    expense_date: string;
    kind: ExpenseKind;
    amount: number;
    note: string | null;
    created_at: string;
    person: { id: string; full_name: string } | null;
  };

  const allExpenses: LogBookExpenseItem[] = (
    (rawExpenses as unknown as RawExpenseRow[]) ?? []
  ).map((r) => ({
    id: r.id,
    job_id: r.job_id,
    log_book_id: r.log_book_id,
    person_id: r.person_id,
    person_name: r.person?.full_name ?? null,
    expense_date: r.expense_date,
    kind: r.kind,
    amount: Number(r.amount) || 0,
    note: r.note,
    created_at: r.created_at,
  }));

  const calcTotals = computeExpenseTotals(allExpenses, month);

  type RawEntryRow = {
    id: string;
    assignment_id: string | null;
    job_id: string;
    person_id: string | null;
    work_date: string;
    end_date: string | null;
    status: LogBookStatus;
    notes: string | null;
    job: {
      id: string;
      job_no: string;
      site: string | null;
      scope: string | null;
      customer_id: string | null;
      customer: { id: string; name: string } | null;
    } | null;
    person: { id: string; full_name: string } | null;
  };

  const q = options.search?.trim().toLowerCase() ?? "";

  const entries: LogBookEntryWithDetails[] = [];
  for (const row of (rawEntries as unknown as RawEntryRow[]) ?? []) {
    const jobNo = row.job?.job_no ?? "Job";
    const customerName = row.job?.customer?.name ?? "Customer";
    const site = row.job?.site ?? null;
    const scope = row.job?.scope ?? null;
    const techName = row.person?.full_name ?? null;

    if (q) {
      const hay = [jobNo, customerName, site, scope, techName, row.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }

    const entryExpenses = allExpenses.filter(
      (e) => e.log_book_id === row.id || (!e.log_book_id && e.job_id === row.job_id)
    );

    entries.push({
      id: row.id,
      assignment_id: row.assignment_id,
      job_id: row.job_id,
      job_no: jobNo,
      customer_id: row.job?.customer_id ?? null,
      customer_name: customerName,
      site,
      scope,
      person_id: row.person_id,
      technician_name: techName,
      work_date: row.work_date,
      end_date: row.end_date,
      status: row.status,
      notes: row.notes,
      job_expense_total: calcTotals.byJob[row.job_id] ?? 0,
      entry_expenses: entryExpenses,
    });
  }

  const displayedExpenses = options.month
    ? allExpenses.filter((e) => e.expense_date >= startDate && e.expense_date <= endDate)
    : allExpenses;

  const scheduledCount = entries.filter((e) => e.status === "scheduled").length;
  const completedCount = entries.filter((e) => e.status === "completed").length;
  const cancelledCount = entries.filter((e) => e.status === "cancelled").length;

  return {
    month,
    startDate,
    endDate,
    entries,
    expenses: displayedExpenses,
    totals: {
      totalEntries: entries.length,
      scheduledCount,
      completedCount,
      cancelledCount,
      monthlyExpenseTotal: calcTotals.monthlyTotal,
      totalAllExpenses: calcTotals.totalAll,
      byJob: calcTotals.byJob,
      byKind: calcTotals.byKind,
    },
  };
}

export async function createJobExpense(
  supabase: SupabaseClient<Database>,
  input: CreateJobExpenseInput,
  createdByUserId?: string | null
) {
  const { data, error } = await supabase
    .from("job_expenses")
    .insert({
      job_id: input.job_id,
      log_book_id: input.log_book_id ?? null,
      person_id: input.person_id ?? null,
      expense_date: input.expense_date,
      kind: input.kind,
      amount: input.amount,
      note: input.note ?? null,
      created_by: createdByUserId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error("Failed to add job expense: " + error.message);
  }
  return data;
}

export async function deleteJobExpense(
  supabase: SupabaseClient<Database>,
  expenseId: string
) {
  const { error } = await supabase
    .from("job_expenses")
    .delete()
    .eq("id", expenseId);

  if (error) {
    throw new Error("Failed to delete job expense: " + error.message);
  }
  return { success: true };
}

export async function updateLogBookEntry(
  supabase: SupabaseClient<Database>,
  entryId: string,
  input: UpdateLogBookEntryInput
) {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.status !== undefined) patch.status = input.status;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.work_date !== undefined) patch.work_date = input.work_date;
  if (input.end_date !== undefined) patch.end_date = input.end_date;

  const { data, error } = await supabase
    .from("log_book_entries")
    .update(patch)
    .eq("id", entryId)
    .select("*")
    .single();

  if (error) {
    throw new Error("Failed to update log book entry: " + error.message);
  }
  return data;
}
