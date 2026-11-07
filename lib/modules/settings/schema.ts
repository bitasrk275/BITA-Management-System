import type { Enums, Json } from "../../db/types";

export const PERMISSION_ACTIONS = [
  "delete",
  "view_salaries",
  "approve_reports",
  "issue_invoices",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type PermissionsMatrix = Record<PermissionAction, Enums<"app_role">[]>;

export const DEFAULT_PERMISSIONS_MATRIX: PermissionsMatrix = {
  delete: ["management"],
  view_salaries: ["management"],
  approve_reports: ["reviewer", "management"],
  issue_invoices: ["management", "office"],
};

export type SettingsOptionInput = {
  list_key: string;
  value: string;
  position: number;
  active: boolean;
};

export function parseSettingsOptionInput(
  raw: Record<string, unknown>,
): { ok: true; value: SettingsOptionInput } | { ok: false; error: string } {
  const listKey = typeof raw.list_key === "string" ? raw.list_key.trim().toLowerCase() : "";
  const value = typeof raw.value === "string" ? raw.value.trim() : "";
  const positionRaw = raw.position !== undefined && raw.position !== "" ? Number(raw.position) : 0;
  const active =
    raw.active === undefined
      ? true
      : raw.active === true || raw.active === "true" || raw.active === "on" || raw.active === "1";

  if (!listKey || !/^[a-z0-9_]+$/.test(listKey)) {
    return { ok: false, error: "List key is required (lowercase letters, digits, and underscores)." };
  }
  if (!value) {
    return { ok: false, error: "Option value is required." };
  }
  if (!Number.isFinite(positionRaw) || positionRaw < 0) {
    return { ok: false, error: "Position must be a non-negative number." };
  }

  return {
    ok: true,
    value: {
      list_key: listKey,
      value,
      position: Math.trunc(positionRaw),
      active,
    },
  };
}

export function normalizePermissionsMatrix(value: Json | undefined | null): PermissionsMatrix {
  const validRoles: readonly Enums<"app_role">[] = ["management", "office", "reviewer", "technician"];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_PERMISSIONS_MATRIX };
  }

  const record = value as Record<string, Json | undefined>;
  const result: PermissionsMatrix = {
    delete: [...DEFAULT_PERMISSIONS_MATRIX.delete],
    view_salaries: [...DEFAULT_PERMISSIONS_MATRIX.view_salaries],
    approve_reports: [...DEFAULT_PERMISSIONS_MATRIX.approve_reports],
    issue_invoices: [...DEFAULT_PERMISSIONS_MATRIX.issue_invoices],
  };

  for (const action of PERMISSION_ACTIONS) {
    const rawList = record[action];
    if (Array.isArray(rawList)) {
      const roles = rawList.filter(
        (r): r is Enums<"app_role"> => typeof r === "string" && (validRoles as readonly string[]).includes(r),
      );
      result[action] = roles;
    }
  }

  return result;
}
