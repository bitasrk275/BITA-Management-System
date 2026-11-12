import { Constants, type Enums } from "../../db/types";
import { parsePoValue } from "../po/schema";

export interface JobInput {
  customer_id: string;
  enquiry_id: string | null;
  quotation_id: string | null;
  site: string | null;
  scope: string | null;
  test_methods: Enums<"test_method">[];
  po_number: string | null;
  po_date: string | null;
  po_value: number | null;
  status?: Enums<"job_status">;
}

function readStr(
  raw: FormData | Record<string, unknown>,
  key: string,
): string | null {
  const val = raw instanceof FormData ? raw.get(key) : raw[key];
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseJobInput(
  raw: FormData | Record<string, unknown>,
): { ok: true; value: JobInput } | { ok: false; error: string } {
  const customerId = readStr(raw, "customer_id");
  if (!customerId) {
    return { ok: false, error: "Customer is required." };
  }

  const validMethods = Constants.public.Enums.test_method as readonly string[];
  let rawMethods: unknown[] = [];
  if (raw instanceof FormData) {
    rawMethods = raw.getAll("test_methods");
  } else if (Array.isArray(raw.test_methods)) {
    rawMethods = raw.test_methods;
  } else if (typeof raw.test_methods === "string" && raw.test_methods.trim()) {
    rawMethods = raw.test_methods.split(",").map((s) => s.trim());
  }

  const testMethods = rawMethods
    .map(String)
    .filter((m): m is Enums<"test_method"> => validMethods.includes(m));

  const poValRes = parsePoValue(raw, "po_value");
  if (!poValRes.ok) {
    return { ok: false, error: poValRes.error };
  }

  const statusRaw = readStr(raw, "status");
  const validStatuses = Constants.public.Enums.job_status as readonly string[];
  const status: Enums<"job_status"> | undefined =
    statusRaw && validStatuses.includes(statusRaw)
      ? (statusRaw as Enums<"job_status">)
      : undefined;

  return {
    ok: true,
    value: {
      customer_id: customerId,
      enquiry_id: readStr(raw, "enquiry_id"),
      quotation_id: readStr(raw, "quotation_id"),
      site: readStr(raw, "site"),
      scope: readStr(raw, "scope"),
      test_methods: testMethods,
      po_number: readStr(raw, "po_number"),
      po_date: readStr(raw, "po_date"),
      po_value: poValRes.value,
      ...(status ? { status } : {}),
    },
  };
}
