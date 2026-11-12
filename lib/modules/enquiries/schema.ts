import { Constants, type Enums } from "../../db/types";

export interface EnquiryInput {
  source: Enums<"enquiry_source">;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  body: string | null;
  customer_id: string | null;
  status?: Enums<"enquiry_status">;
  received_at?: string;
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

export function parseEnquiryInput(
  raw: FormData | Record<string, unknown>,
): { ok: true; value: EnquiryInput } | { ok: false; error: string } {
  const sourceRaw = readStr(raw, "source") ?? "phone";
  const validSources = Constants.public.Enums.enquiry_source as readonly string[];
  const source: Enums<"enquiry_source"> = validSources.includes(sourceRaw)
    ? (sourceRaw as Enums<"enquiry_source">)
    : "phone";

  const customerId = readStr(raw, "customer_id");
  const statusRaw = readStr(raw, "status");
  const validStatuses = Constants.public.Enums.enquiry_status as readonly string[];
  const status: Enums<"enquiry_status"> =
    statusRaw && validStatuses.includes(statusRaw)
      ? (statusRaw as Enums<"enquiry_status">)
      : customerId
        ? "linked"
        : "new";

  const receivedRaw = readStr(raw, "received_at");
  let receivedAt: string | undefined;
  if (receivedRaw) {
    const parsedDate = new Date(receivedRaw);
    if (!Number.isNaN(parsedDate.getTime())) {
      receivedAt = parsedDate.toISOString();
    }
  }

  return {
    ok: true,
    value: {
      source,
      from_name: readStr(raw, "from_name"),
      from_address: readStr(raw, "from_address"),
      subject: readStr(raw, "subject"),
      body: readStr(raw, "body"),
      customer_id: customerId,
      status,
      ...(receivedAt ? { received_at: receivedAt } : {}),
    },
  };
}
