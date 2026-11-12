export interface ApproveReportInput {
  signatory_id: string | null;
  calibration_override_note: string | null;
}

export interface ReturnReportInput {
  note: string;
}

function readStr(
  raw: FormData | Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!raw) return null;
  const val = raw instanceof FormData ? raw.get(key) : raw[key];
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseApproveReportInput(
  raw?: FormData | Record<string, unknown> | null,
): ApproveReportInput {
  return {
    signatory_id: readStr(raw, "signatory_id"),
    calibration_override_note: readStr(raw, "calibration_override_note"),
  };
}

export function parseReturnReportInput(
  raw: FormData | Record<string, unknown> | null | undefined,
): { ok: true; value: ReturnReportInput } | { ok: false; error: string } {
  const note = readStr(raw, "note");
  if (!note) {
    return {
      ok: false,
      error: "Enter a clear note explaining what the technician needs to correct.",
    };
  }
  return { ok: true, value: { note } };
}
