import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import {
  type LogBookStatus,
  isLogBookStatus,
  isValidUuid,
  parseJobExpenseInput,
  parseUpdateLogBookEntryInput,
} from "@/lib/modules/log-book/schema";
import {
  createJobExpense,
  deleteJobExpense,
  listLogBookOverview,
  updateLogBookEntry,
} from "@/lib/modules/log-book/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const statusParam = url.searchParams.get("status");
  const status: LogBookStatus | "all" | undefined =
    statusParam === "all"
      ? "all"
      : isLogBookStatus(statusParam)
        ? statusParam
        : undefined;
  const personId = url.searchParams.get("person_id") ?? url.searchParams.get("technician_id");
  const jobId = url.searchParams.get("job_id");
  const search = url.searchParams.get("q") ?? url.searchParams.get("search");

  try {
    const data = await listLogBookOverview(auth.supabase, {
      month,
      status,
      personId,
      jobId,
      search,
    });
    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load log book";
    return apiError(message, 400);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  try {
    const action = typeof body.action === "string" ? body.action : "add_expense";

    if (action === "update_entry") {
      const entryId = typeof body.entry_id === "string" ? body.entry_id : "";
      if (!isValidUuid(entryId)) return apiError("Valid entry_id is required", 400);
      const parsed = parseUpdateLogBookEntryInput(body);
      const updated = await updateLogBookEntry(auth.supabase, entryId, parsed);
      return apiSuccess(updated);
    }

    if (action === "delete_expense") {
      const expenseId = typeof body.expense_id === "string" ? body.expense_id : "";
      if (!isValidUuid(expenseId)) return apiError("Valid expense_id is required", 400);
      const res = await deleteJobExpense(auth.supabase, expenseId);
      return apiSuccess(res);
    }

    const parsed = parseJobExpenseInput(body);
    const created = await createJobExpense(auth.supabase, parsed, auth.user.id);
    return apiSuccess(created, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process log book request";
    return apiError(message, 400);
  }
}
