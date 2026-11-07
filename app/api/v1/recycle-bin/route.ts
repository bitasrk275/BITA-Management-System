import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import {
  isSoftDeleteTable,
  listRecycleBin,
  restoreRecord,
  softDeleteRecord,
} from "@/lib/modules/recycle-bin/service";

export async function GET(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const tableParam = url.searchParams.get("table");
  if (tableParam && !isSoftDeleteTable(tableParam)) {
    return apiError(`Unsupported table filter: ${tableParam}`, 400);
  }

  const { data, error } = await listRecycleBin(auth.supabase, {
    table: tableParam && isSoftDeleteTable(tableParam) ? tableParam : undefined,
  });
  if (error) return apiError(error, 400);

  return apiSuccess(data);
}

export async function POST(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  let body: { action?: string; table?: string; id?: string };
  try {
    body = (await request.json()) as { action?: string; table?: string; id?: string };
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  if (!isSoftDeleteTable(body.table)) {
    return apiError("Valid soft-delete table is required.", 400);
  }
  if (!body.id || typeof body.id !== "string") {
    return apiError("Record id is required.", 400);
  }

  const action = body.action ?? "restore";
  if (action === "delete") {
    const res = await softDeleteRecord(auth.supabase, body.table, body.id);
    if (!res.ok) {
      const status = res.error.toLowerCase().includes("only management") ? 403 : 400;
      return apiError(res.error, status);
    }
    return apiSuccess({ table: body.table, id: body.id, deleted: true });
  }

  if (action === "restore") {
    const res = await restoreRecord(auth.supabase, body.table, body.id);
    if (!res.ok) {
      const status = res.error.toLowerCase().includes("only management") ? 403 : 400;
      return apiError(res.error, status);
    }
    return apiSuccess({ table: body.table, id: body.id, restored: true });
  }

  return apiError(`Unsupported action: ${action}`, 400);
}
