import type { Enums, Json, Tables } from "../db/types";
import {
  fieldsForMethod,
  missingFields,
  REPEATING_GROUPS,
  type FieldDefinition,
  type ItemReadings,
  type ReportMethod,
  type ReportReadings,
  type TechnicianReadings,
} from "./fields";
import type { ReportApproval, ReportLetterhead } from "../../templates/reports/types";

export type InspectionRow = Tables<"inspections">;
export type ReportRow = Tables<"reports">;

export const DEFAULT_DEV_LETTERHEAD: ReportLetterhead = {
  name: "EXAMPLE INSPECTION & TESTING AGENCY (DEV PREVIEW)",
  addressLines: [
    "Plot 00, Fake Industrial Area, Peenya Stage II, Bengaluru – 560 058",
  ],
  contactLines: [
    "Tel: +91 80 0000 0000 · Email: reports@example-inspection.test",
  ],
};

export function supportedMethod(method: string): method is ReportMethod {
  return method === "UT" || method === "MPT" || method === "DPT";
}

export function validUuid(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.trim());
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Extracts ReportReadings from either:
 * 1. Snapshot object `{ version: 1, readings: { ... } }` or `{ readings: { ... } }`
 * 2. Direct readings object `{ client: ..., technicians: [...], items: [...] }` (e.g. demo seed)
 * 3. Fallback `inspection.readings` when `report.content` is empty `{}`.
 */
export function extractReadings(
  content: Json | null | undefined,
  fallbackInspectionReadings?: Json | null
): ReportReadings {
  const obj = asObject(content);
  if (obj) {
    const nested = asObject(obj.readings);
    if (nested && Object.keys(nested).length > 0) {
      return nested as unknown as ReportReadings;
    }
    const keys = Object.keys(obj).filter(
      (k) => !["version", "sourceHash", "submittedAt", "observations", "readings"].includes(k)
    );
    if (keys.length > 0) {
      return obj as unknown as ReportReadings;
    }
  }
  const fallback = asObject(fallbackInspectionReadings);
  if (fallback) {
    return fallback as unknown as ReportReadings;
  }
  return {};
}

export type BookedJobEquipmentItem = {
  id: string;
  make: string | null;
  model: string | null;
  serial_no: string | null;
  calibration_due: string | null;
  work_date: string;
  is_expired_on_work_date: boolean;
};

/**
 * Prefills `equipment` and `equipment_serial` on `ReportReadings` from the job's booked equipment
 * when those fields are currently blank.
 */
export function prefillReadingsFromBookedEquipment(
  readings: ReportReadings,
  bookedEquipment: ReadonlyArray<{
    make: string | null;
    model: string | null;
    serial_no: string | null;
  }>
): ReportReadings {
  if (bookedEquipment.length === 0) return readings;

  const first = bookedEquipment[0]!;
  const label = [first.make, first.model].filter(Boolean).join(" ").trim();
  const serials = bookedEquipment
    .map((e) => e.serial_no)
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(", ");

  const curEq = readings.equipment;
  const curSerial = readings.equipment_serial;
  const hasEq = typeof curEq === "string" && curEq.trim().length > 0;
  const hasSerial = typeof curSerial === "string" && curSerial.trim().length > 0;

  if (hasEq && hasSerial) return readings;

  return {
    ...readings,
    ...(!hasEq && label ? { equipment: label } : {}),
    ...(!hasSerial && serials ? { equipment_serial: serials } : {}),
  };
}

export function buildReportContent(
  readings: ReportReadings,
  observations?: string | null,
  submittedAt?: string | null
): Json {
  return {
    ...(readings as Record<string, unknown>),
    ...(observations ? { observations } : {}),
    ...(submittedAt ? { submittedAt } : {}),
  } as unknown as Json;
}

export function checkReportReadiness(
  method: Enums<"test_method">,
  inspection: Pick<InspectionRow, "submitted_at" | "missing_fields" | "readings"> | null,
  readings: ReportReadings,
  customFields?: readonly FieldDefinition[],
): { missing: string[]; blockers: string[]; ready: boolean } {
  const computedMissing = customFields
    ? missingFields(method, readings, customFields)
    : supportedMethod(method)
      ? missingFields(method, readings)
      : [];
  const dbMissing = inspection?.missing_fields ?? [];
  const missing = [...new Set([...dbMissing, ...computedMissing])];

  const blockers: string[] = [];
  if (inspection && !inspection.submitted_at) {
    blockers.push("Technician field data has not been submitted yet.");
  }
  if (missing.length > 0) {
    blockers.push(`Mandatory readings missing (${missing.length}): ${missing.join(", ")}`);
  }

  return {
    missing,
    blockers,
    ready: blockers.length === 0,
  };
}

export function reportPdfStoragePath(jobId: string, reportNo: string): string {
  const trimmed = reportNo.trim();
  if (!validUuid(jobId) || !trimmed) {
    throw new Error("A valid job ID and BITA report number are required.");
  }
  const safeName = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  if (!safeName || safeName === "." || safeName === "..") {
    throw new Error("Enter a report number containing letters or digits.");
  }
  return `reports/${jobId}/${safeName}.pdf`;
}

export function parseRecipients(raw: string): string[] {
  const emails = [
    ...new Set(
      raw
        .split(/[,;\n]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (
    emails.length === 0 ||
    emails.some((email) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
  ) {
    throw new Error("Enter at least one valid recipient email address (comma-separated).");
  }
  return emails;
}

export function friendlyReportError(message: string): string {
  if (message.includes("reports_report_no_key") || message.includes("duplicate key")) {
    return "That BITA report number is already in use. Please enter a unique report number.";
  }
  if (message.includes("not been submitted")) {
    return "Field data for this report has not been submitted yet. Ask the technician to submit their readings first.";
  }
  if (message.includes("Mandatory readings missing")) {
    return message;
  }
  if (message.includes("Only a technical reviewer can approve")) {
    return "Only an active technical reviewer can approve a report (AGENTS.md rule 6).";
  }
  if (message.includes("must be approved before")) {
    return "This report must receive technical reviewer approval before it can be marked as sent.";
  }
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return "Your role does not have permission for this report action.";
  }
  return message;
}

export function fakeSignatureSvgDataUrl(name: string): string {
  const safe = name.replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="64" viewBox="0 0 200 64"><rect width="200" height="64" fill="#ffffff" stroke="#d4d4d4" stroke-dasharray="3,3"/><path d="M16 44 C 42 18, 65 48, 92 26 C 115 12, 138 42, 182 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round"/><text x="16" y="57" font-family="monospace" font-size="9" fill="#555555">SIGNED: ${safe.slice(0, 22)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function fakeSealSvgDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="42" fill="none" stroke="#111111" stroke-width="2"/><circle cx="48" cy="48" r="36" fill="none" stroke="#111111" stroke-width="1" stroke-dasharray="2,2"/><text x="48" y="42" text-anchor="middle" font-family="serif" font-size="9" font-weight="bold" fill="#111111">FAKE DEV SEAL</text><text x="48" y="54" text-anchor="middle" font-family="serif" font-size="8" fill="#111111">APPROVED</text><text x="48" y="65" text-anchor="middle" font-family="monospace" font-size="7" fill="#555555">NDT DIVISION</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function pdfEscape(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Generates a self-contained A4 PDF 1.4 binary document for a report.
 * Signature and seal are included only when approval.approved === true (R27).
 */
export function generateReportPdfBytes(input: {
  reportNo: string;
  reportDate: string;
  method: Enums<"test_method">;
  jobNo: string;
  customerName: string;
  readings: ReportReadings;
  letterhead?: ReportLetterhead;
  approval: ReportApproval;
  customFields?: readonly FieldDefinition[];
  attachments?: ReadonlyArray<{
    kind: string;
    caption?: string | null;
    storagePath: string;
  }>;
}): Uint8Array {
  const lh = input.letterhead ?? DEFAULT_DEV_LETTERHEAD;
  const r = input.readings;
  const lines: string[] = [];

  if (!input.approval.approved) {
    lines.push("DRAFT — NOT APPROVED FOR ISSUE (SIGNATURE & SEAL WITHHELD)");
    lines.push("--------------------------------------------------------------------------------");
  }
  lines.push(lh.name);
  for (const addr of lh.addressLines) lines.push(addr);
  if (lh.contactLines) {
    for (const c of lh.contactLines) lines.push(c);
  }
  lines.push("--------------------------------------------------------------------------------");
  lines.push(`REPORT NO: ${input.reportNo}    DATE: ${input.reportDate}    METHOD: ${input.method}`);
  const headerItems = (r.items ?? []) as readonly ItemReadings[];
  const headerComponentId =
    r.component_header_id && String(r.component_header_id).trim()
      ? String(r.component_header_id).trim()
      : headerItems.length === 1 &&
          headerItems[0]?.identification_no &&
          String(headerItems[0].identification_no).trim()
        ? String(headerItems[0].identification_no)
            .trim()
            .split(/\r?\n|,/)[0]
            ?.trim() ?? null
        : null;
  if (headerComponentId) {
    lines.push(`COMPONENT ID: ${headerComponentId}`);
  }
  lines.push(`JOB ID:    ${input.jobNo}    CUSTOMER: ${input.customerName}`);
  lines.push("--------------------------------------------------------------------------------");

  const fieldList =
    input.customFields ??
    (supportedMethod(input.method) ? fieldsForMethod(input.method) : null);

  if (fieldList && fieldList.length > 0) {
    for (const f of fieldList) {
      const val = (r as Record<string, unknown>)[f.key];
      const str = val === null || val === undefined || String(val).trim() === "" ? "-" : String(val);
      lines.push(`${f.label.padEnd(28, " ")}: ${str}`);
    }
  } else {
    for (const [k, v] of Object.entries(r)) {
      if (k === "technicians" || k === "items") continue;
      lines.push(`${k.padEnd(28, " ")}: ${String(v ?? "-")}`);
    }
  }

  lines.push("--------------------------------------------------------------------------------");
  lines.push("TESTING CARRIED OUT BY (QUALIFICATIONS):");
  const techs = (r.technicians ?? []) as readonly TechnicianReadings[];
  if (techs.length === 0) {
    lines.push("  (None listed)");
  } else {
    techs.forEach((t, idx) => {
      lines.push(
        `  ${idx + 1}. ${t.name ?? "-"} | ${t.qualification ?? "-"} | Cert: ${t.certificate_no ?? "-"} | Valid: ${t.issued_on ?? "-"} to ${t.valid_until ?? "-"}`
      );
    });
  }

  lines.push("--------------------------------------------------------------------------------");
  lines.push("INSPECTED ITEMS & OBSERVATIONS:");
  const items = (r.items ?? []) as readonly ItemReadings[];
  if (items.length === 0) {
    lines.push("  (None listed)");
  } else {
    items.forEach((item, idx) => {
      const qtyStr = `${item.quantity ?? "-"}${item.qty_unit ? ` ${item.qty_unit}` : ""}`;
      lines.push(
        `  Item ${idx + 1} (Qty: ${qtyStr}): ${String(item.description ?? "-").replace(/\s+/g, " ")}`
      );
      if (item.identification_no && String(item.identification_no).trim()) {
        lines.push(`    Identification: ${String(item.identification_no).trim().replace(/\s+/g, " ")}`);
      }
      if (item.size && String(item.size).trim()) {
        lines.push(`    Size: ${String(item.size).trim().replace(/\s+/g, " ")}`);
      }
      lines.push(`    Observations: ${String(item.observations ?? "-").replace(/\s+/g, " ")}`);
      if (item.result && String(item.result).trim()) {
        lines.push(`    Result: ${String(item.result).trim().replace(/\s+/g, " ")}`);
      }
    });
  }

  if (input.attachments && input.attachments.length > 0) {
    lines.push("--------------------------------------------------------------------------------");
    lines.push("ATTACHED INSPECTION PHOTOS & DRAWINGS:");
    input.attachments.forEach((att, idx) => {
      const cap = att.caption ? ` (${att.caption})` : "";
      lines.push(`  ${idx + 1}. [${att.kind.toUpperCase()}] ${att.storagePath}${cap}`);
    });
  }

  lines.push("--------------------------------------------------------------------------------");
  if (input.approval.approved) {
    lines.push("TECHNICAL APPROVAL & SIGN-OFF (R26 / R27):");
    lines.push(`  For ${lh.name}`);
    lines.push(`  Approved Signatory : ${input.approval.signatoryName}`);
    if (input.approval.signatoryQualification) {
      lines.push(`  Designation        : ${input.approval.signatoryQualification}`);
    }
    lines.push(`  Approved At (UTC)  : ${input.approval.approvedAt}`);
    lines.push("  Stamp / Seal       : [SIGNED & SEALED AFTER TECHNICAL APPROVAL]");
  } else {
    lines.push("STATUS: DRAFT — AWAITING TECHNICAL REVIEWER APPROVAL");
  }

  const streamLines: string[] = ["BT", "/F1 9 Tf", "36 806 Td", "12 TL"];
  for (const rawLine of lines.slice(0, 62)) {
    const clipped = rawLine.length > 96 ? `${rawLine.slice(0, 93)}...` : rawLine;
    streamLines.push(`(${pdfEscape(clipped)}) Tj T*`);
  }
  streamLines.push("ET");
  const contentStream = streamLines.join("\n");

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "utf8"));
}

export function generateSignedReportPdfBytes(input: {
  reportNo: string;
  reportDate: string;
  method: Enums<"test_method">;
  jobNo: string;
  customerName: string;
  readings: ReportReadings;
  letterhead?: ReportLetterhead;
  approval: Extract<ReportApproval, { approved: true }>;
  customFields?: readonly FieldDefinition[];
}): Uint8Array {
  return generateReportPdfBytes(input);
}

/**
 * Parses admin edits from the `/review/[reportId]` Edit report form into a clean `ReportReadings` object,
 * driven dynamically by `customFields` or `fieldsForMethod(method)` and `REPEATING_GROUPS`.
 */
export function parseEditedReportReadings(
  method: Enums<"test_method">,
  fd: FormData,
  baseReadings: ReportReadings = {},
  customFields?: readonly FieldDefinition[],
): ReportReadings {
  const result: Record<string, unknown> = { ...(baseReadings as Record<string, unknown>) };

  const scalarDefs =
    customFields ?? (supportedMethod(method) ? fieldsForMethod(method) : []);
  if (scalarDefs.length > 0) {
    for (const def of scalarDefs) {
      const rawVal = fd.get(`reading_${def.key}`);
      const otherVal = fd.get(`reading_${def.key}__other`);
      const chosenRaw =
        typeof rawVal === "string" && rawVal === "__OTHER__" && typeof otherVal === "string"
          ? otherVal
          : rawVal;

      if (typeof chosenRaw !== "string") continue;
      const trimmed = chosenRaw.trim();
      if (!trimmed) {
        result[def.key] = null;
      } else if (def.input === "number") {
        const parsed = Number(trimmed);
        result[def.key] = Number.isFinite(parsed) ? parsed : trimmed;
      } else {
        result[def.key] = trimmed;
      }
    }
  }

  for (const group of REPEATING_GROUPS) {
    const countRaw = fd.get(`${group.key}_count`);
    const count = typeof countRaw === "string" ? Math.max(0, Math.min(100, Number(countRaw) || 0)) : 0;
    const rows: Record<string, string | number | null>[] = [];

    for (let i = 0; i < count; i += 1) {
      const row: Record<string, string | number | null> = {};
      let hasAnyValue = false;
      for (const fieldDef of group.fields) {
        const rawCell = fd.get(`${group.key}.${i}.${fieldDef.key}`);
        const otherCell = fd.get(`${group.key}.${i}.${fieldDef.key}__other`);
        const cellRaw =
          typeof rawCell === "string" && rawCell === "__OTHER__" && typeof otherCell === "string"
            ? otherCell
            : rawCell;
        if (typeof cellRaw !== "string") {
          continue;
        }
        const trimmed = cellRaw.trim();
        if (!trimmed) {
          row[fieldDef.key] = null;
        } else if (fieldDef.input === "number") {
          const parsed = Number(trimmed);
          row[fieldDef.key] = Number.isFinite(parsed) ? parsed : trimmed;
          hasAnyValue = true;
        } else {
          row[fieldDef.key] = trimmed;
          hasAnyValue = true;
        }
      }
      if (hasAnyValue) {
        rows.push(row);
      }
    }

    result[group.key] = rows;
  }

  return result as unknown as ReportReadings;
}

export type AuditFieldDiff = {
  field: string;
  before: string;
  after: string;
};

function formatAuditValue(val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  return JSON.stringify(val);
}

/**
 * Computes human-readable field changes for T9 (`/review/[reportId]/history`).
 * Expands nested `readings` and `content` JSON keys so reviewers see individual reading edits.
 */
export function diffAuditRow(
  oldRow: Json | null,
  newRow: Json | null,
  changedFields: readonly string[]
): AuditFieldDiff[] {
  const oldObj = asObject(oldRow) ?? {};
  const newObj = asObject(newRow) ?? {};
  const diffs: AuditFieldDiff[] = [];

  const fieldsToInspect =
    changedFields.length > 0
      ? changedFields
      : [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])].filter(
          (k) => !["id", "created_at", "job_id", "inspection_id", "assignment_id"].includes(k)
        );

  for (const field of fieldsToInspect) {
    if (field === "readings" || field === "content") {
      const oldNested = asObject(oldObj[field]) ?? {};
      const newNested = asObject(newObj[field]) ?? {};
      const subKeys = [...new Set([...Object.keys(oldNested), ...Object.keys(newNested)])].sort();
      let addedSubDiff = false;
      for (const subKey of subKeys) {
        const beforeStr = formatAuditValue(oldNested[subKey]);
        const afterStr = formatAuditValue(newNested[subKey]);
        if (beforeStr !== afterStr) {
          diffs.push({
            field: `${field}.${subKey}`,
            before: beforeStr,
            after: afterStr,
          });
          addedSubDiff = true;
        }
      }
      if (!addedSubDiff) {
        const beforeStr = formatAuditValue(oldObj[field]);
        const afterStr = formatAuditValue(newObj[field]);
        if (beforeStr !== afterStr) {
          diffs.push({ field, before: beforeStr, after: afterStr });
        }
      }
      continue;
    }

    const beforeStr = formatAuditValue(oldObj[field]);
    const afterStr = formatAuditValue(newObj[field]);
    if (beforeStr !== afterStr) {
      diffs.push({ field, before: beforeStr, after: afterStr });
    }
  }

  return diffs;
}

export function fieldLabelFor(method: Enums<"test_method">, key: string): string {
  if (!supportedMethod(method)) return key;
  const scalar = fieldsForMethod(method).find((f) => f.key === key);
  if (scalar) return scalar.label;
  const parts = key.split(".");
  if (parts.length === 3) {
    const group = REPEATING_GROUPS.find((g) => g.key === parts[0]);
    const sub = group?.fields.find((f) => f.key === parts[2]);
    if (group && sub) {
      const rowNum = Number(parts[1]) + 1;
      return `${group.key === "items" ? "Item" : "Technician"} ${rowNum} · ${sub.label}`;
    }
  }
  return key;
}
