import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import type { Enums } from "@/lib/db/types";
import {
  APP_ROLES,
  isValidUuid,
  parseEmployeeInput,
  parseQualificationInput,
} from "@/lib/modules/employees/schema";
import {
  createEmployee,
  createEmployeeQualification,
  deleteEmployee,
  getEmployeeDetail,
  listEmployees,
  updateEmployee,
} from "@/lib/modules/employees/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const month = url.searchParams.get("month");
  const roleParam = url.searchParams.get("role");
  const role: Enums<"app_role"> | "all" | undefined =
    roleParam === "all"
      ? "all"
      : roleParam && (APP_ROLES as readonly string[]).includes(roleParam)
        ? (roleParam as Enums<"app_role">)
        : undefined;
  const statusParam = url.searchParams.get("status");
  const status: "active" | "inactive" | "all" | undefined =
    statusParam === "active" || statusParam === "inactive" || statusParam === "all"
      ? statusParam
      : undefined;
  const search = url.searchParams.get("q") ?? url.searchParams.get("search");
  const canViewSalaries = auth.person.roles.includes("management");

  try {
    if (id) {
      if (!isValidUuid(id)) return apiError("Invalid employee id", 400);
      const emp = await getEmployeeDetail(auth.supabase, id, {
        month,
        canViewSalaries,
      });
      if (!emp) return apiError("Employee not found", 404);
      return apiSuccess(emp);
    }

    const data = await listEmployees(auth.supabase, {
      month,
      role,
      status,
      search,
      canViewSalaries,
    });
    return apiSuccess(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load employees";
    return apiError(message, 400);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const isManagement = auth.person.roles.includes("management");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  try {
    const action = typeof body.action === "string" ? body.action : "create_employee";

    if (action === "add_qualification") {
      const parsed = parseQualificationInput(body);
      const created = await createEmployeeQualification(auth.supabase, parsed);
      return apiSuccess(created, 201);
    }

    if (action === "update_employee") {
      if (!isManagement) return apiError("Only management can update employee records", 403);
      const id = typeof body.id === "string" ? body.id : "";
      if (!isValidUuid(id)) return apiError("Valid employee id is required", 400);
      const parsed = parseEmployeeInput(body, { includeCompensation: isManagement });
      const updated = await updateEmployee(auth.supabase, id, parsed);
      return apiSuccess(updated);
    }

    if (action === "delete_employee") {
      if (!isManagement) return apiError("Only management can delete employee records", 403);
      const id = typeof body.id === "string" ? body.id : "";
      if (!isValidUuid(id)) return apiError("Valid employee id is required", 400);
      const res = await deleteEmployee(auth.supabase, id);
      return apiSuccess(res);
    }

    if (!isManagement) return apiError("Only management can add employees", 403);
    const parsed = parseEmployeeInput(body, { includeCompensation: isManagement });
    const created = await createEmployee(auth.supabase, parsed);
    return apiSuccess(created, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process employee request";
    return apiError(message, 400);
  }
}
