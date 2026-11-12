import type { SupabaseClient } from "@supabase/supabase-js";
import { METHOD_LABEL } from "../../../app/(office)/jobs/labels";
import type { Database, Enums, Json } from "../../db/types";
import { csvEscapeCell } from "../../invoices/gst-export";
import { parseFinanceMonth, parseFinancialYearRange } from "../finance/schema";

export interface JobRegisterRow {
  job_id: string;
  job_no: string;
  customer_id: string;
  date_of_testing: string;
  person_who_tested: string;
  customer: string;
  report_numbers: string;
  component_serial_no: string;
  details_of_testing: string;
  invoice_generated: "Yes" | "No";
  invoice_numbers: string;
  remarks: string;
}

export interface JobRegisterFilterOptions {
  fy?: string | null;
  month?: string | null;
  customerId?: string | null;
}

export const JOB_REGISTER_COLUMNS: ReadonlyArray<{
  key: keyof JobRegisterRow;
  header: string;
}> = [
  { key: "date_of_testing", header: "Date of Testing" },
  { key: "person_who_tested", header: "Person Who Tested" },
  { key: "customer", header: "Customer" },
  { key: "report_numbers", header: "Report Number(s)" },
  { key: "component_serial_no", header: "Component / Serial Number" },
  { key: "details_of_testing", header: "Details of Testing" },
  { key: "invoice_generated", header: "Invoice Generated (Yes/No)" },
  { key: "invoice_numbers", header: "Invoice Number(s)" },
  { key: "remarks", header: "Remarks" },
];

export interface RawJobRegisterSource {
  id: string;
  job_no: string;
  customer_id: string;
  customer_name: string;
  site: string | null;
  scope: string | null;
  status: string;
  test_methods: Enums<"test_method">[];
  po_number: string | null;
  created_at: string;
  assignments: Array<{
    work_date: string;
    person_name: string | null;
  }>;
  inspections: Array<{
    readings: Json | null;
    submitted_by_name: string | null;
    submitted_at: string | null;
  }>;
  reports: Array<{
    id: string;
    report_no: string;
    report_date: string;
    method: Enums<"test_method">;
    content: Json | null;
  }>;
  invoices: Array<{
    invoice_no: string;
    status: string;
    kind: string;
  }>;
}

function extractReadingsObject(raw: Json | null | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  if (obj.readings && typeof obj.readings === "object" && !Array.isArray(obj.readings)) {
    return obj.readings as Record<string, unknown>;
  }
  return obj;
}

function extractComponentAndSerial(job: RawJobRegisterSource): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const addPart = (val: unknown) => {
    if (typeof val !== "string") return;
    const trimmed = val.trim();
    if (!trimmed) return;
    const key = trimmed.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      parts.push(trimmed);
    }
  };

  for (const r of job.reports) {
    const readings = extractReadingsObject(r.content);
    addPart(readings.component);
    addPart(readings.component_header_id);
    if (Array.isArray(readings.items)) {
      for (const item of readings.items) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const rec = item as Record<string, unknown>;
          const desc = typeof rec.description === "string" ? rec.description.trim() : "";
          const idNo =
            typeof rec.identification_no === "string"
              ? rec.identification_no.trim()
              : "";
          if (desc && idNo) {
            addPart(`${desc} (${idNo})`);
          } else {
            addPart(desc || idNo);
          }
        }
      }
    }
  }

  if (parts.length === 0) {
    for (const insp of job.inspections) {
      const readings = extractReadingsObject(insp.readings);
      addPart(readings.component);
      addPart(readings.component_header_id);
      if (Array.isArray(readings.items)) {
        for (const item of readings.items) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const rec = item as Record<string, unknown>;
            const desc =
              typeof rec.description === "string" ? rec.description.trim() : "";
            const idNo =
              typeof rec.identification_no === "string"
                ? rec.identification_no.trim()
                : "";
            if (desc && idNo) {
              addPart(`${desc} (${idNo})`);
            } else {
              addPart(desc || idNo);
            }
          }
        }
      }
    }
  }

  if (parts.length === 0 && job.scope) {
    addPart(job.scope);
  }

  return parts.join("; ") || "—";
}

function extractTestingPersons(job: RawJobRegisterSource): string {
  const names: string[] = [];
  const seen = new Set<string>();
  const addName = (raw: string | null | undefined) => {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return;
    const key = trimmed.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(trimmed);
    }
  };

  for (const a of job.assignments) {
    addName(a.person_name);
  }
  for (const insp of job.inspections) {
    addName(insp.submitted_by_name);
    const readings = extractReadingsObject(insp.readings);
    if (Array.isArray(readings.technicians)) {
      for (const t of readings.technicians) {
        if (t && typeof t === "object" && !Array.isArray(t)) {
          addName((t as Record<string, unknown>).name as string | undefined);
        }
      }
    }
  }

  return names.join(", ") || "—";
}

export function buildJobRegisterRows(
  sources: readonly RawJobRegisterSource[],
  filters?: JobRegisterFilterOptions,
): JobRegisterRow[] {
  let startDate: string | null = null;
  let endDate: string | null = null;

  if (filters?.month && filters.month.trim()) {
    const m = parseFinanceMonth(filters.month);
    startDate = m.startDate;
    endDate = m.endDate;
  } else if (filters?.fy && filters.fy.trim() && filters.fy !== "all") {
    const fyRange = parseFinancialYearRange(filters.fy);
    startDate = fyRange.startDate;
    endDate = fyRange.endDate;
  }

  const customerFilter = (filters?.customerId ?? "").trim();

  const rows: JobRegisterRow[] = [];

  for (const job of sources) {
    if (customerFilter && job.customer_id !== customerFilter) {
      continue;
    }

    const workDates = job.assignments
      .map((a) => a.work_date)
      .filter(Boolean)
      .sort();
    const reportDates = job.reports
      .map((r) => r.report_date)
      .filter(Boolean)
      .sort();
    const fallbackDate = (job.created_at ?? "").slice(0, 10);

    const testingDate = workDates[0] ?? reportDates[0] ?? fallbackDate;

    if (startDate && endDate && testingDate) {
      if (testingDate < startDate || testingDate > endDate) {
        continue;
      }
    }

    const reportNos = Array.from(
      new Set(job.reports.map((r) => r.report_no).filter(Boolean)),
    );

    const methodLabels = job.test_methods.map((m) => METHOD_LABEL[m] ?? m);
    const detailsParts = [
      methodLabels.length > 0 ? methodLabels.join(", ") : null,
      job.scope,
      job.site ? `Site: ${job.site}` : null,
    ].filter(Boolean);

    const activeInvoices = job.invoices.filter(
      (inv) => inv.status !== "cancelled" && inv.status !== "draft",
    );
    const invoiceNos = Array.from(
      new Set(activeInvoices.map((inv) => inv.invoice_no).filter(Boolean)),
    );

    const remarksParts = [
      job.job_no,
      job.po_number ? `PO: ${job.po_number}` : null,
      `Status: ${job.status.replace(/_/g, " ")}`,
    ].filter(Boolean);

    rows.push({
      job_id: job.id,
      job_no: job.job_no,
      customer_id: job.customer_id,
      date_of_testing: testingDate || "—",
      person_who_tested: extractTestingPersons(job),
      customer: job.customer_name,
      report_numbers: reportNos.join(", ") || "—",
      component_serial_no: extractComponentAndSerial(job),
      details_of_testing: detailsParts.join(" · ") || "—",
      invoice_generated: invoiceNos.length > 0 ? "Yes" : "No",
      invoice_numbers: invoiceNos.join(", ") || "—",
      remarks: remarksParts.join(" | "),
    });
  }

  rows.sort((a, b) => b.date_of_testing.localeCompare(a.date_of_testing));
  return rows;
}

export function jobRegisterToCsv(rows: readonly JobRegisterRow[]): string {
  const headerLine = JOB_REGISTER_COLUMNS.map((c) => csvEscapeCell(c.header)).join(",");
  const dataLines = rows.map((row) =>
    JOB_REGISTER_COLUMNS.map((c) => csvEscapeCell(row[c.key])).join(","),
  );
  return `\uFEFF${[headerLine, ...dataLines].join("\r\n")}\r\n`;
}

function xmlEscapeSafeCell(value: string | number): string {
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str) && !/^-?\d+(\.\d+)?$/.test(str)) {
    str = `'${str}`;
  }
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function jobRegisterToExcelXml(rows: readonly JobRegisterRow[]): string {
  const headerXml = `<Row>${JOB_REGISTER_COLUMNS.map(
    (c) => `<Cell><Data ss:Type="String">${xmlEscapeSafeCell(c.header)}</Data></Cell>`,
  ).join("")}</Row>`;

  const bodyXml = rows
    .map((row) => {
      const cells = JOB_REGISTER_COLUMNS.map(
        (c) =>
          `<Cell><Data ss:Type="String">${xmlEscapeSafeCell(row[c.key])}</Data></Cell>`,
      ).join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<?mso-application progid="Excel.Sheet"?>`,
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`,
    `<Worksheet ss:Name="Jobs Register"><Table>${headerXml}${bodyXml}</Table></Worksheet>`,
    `</Workbook>`,
  ].join("\n");
}

export async function loadJobRegisterRows(
  supabase: SupabaseClient<Database>,
  filters?: JobRegisterFilterOptions,
): Promise<{ data: JobRegisterRow[]; error: string | null }> {
  const [jobsRes, invReportsRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        `
        id,
        job_no,
        customer_id,
        site,
        scope,
        status,
        test_methods,
        po_number,
        created_at,
        customers(id, name),
        assignments(work_date, people!assignments_person_id_fkey(full_name)),
        inspections(readings, submitted_at, people!inspections_submitted_by_fkey(full_name)),
        reports(id, report_no, report_date, method, content),
        invoices(id, invoice_no, number, status, kind)
      `,
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("invoice_reports")
      .select("report_id, invoices(id, invoice_no, number, status, kind)"),
  ]);

  if (jobsRes.error) {
    return { data: [], error: jobsRes.error.message };
  }

  const invoicesByReportId = new Map<
    string,
    Array<{ invoice_no: string; status: string; kind: string }>
  >();
  for (const ir of invReportsRes.data ?? []) {
    const inv = ir.invoices as unknown as {
      id: string;
      invoice_no: string | null;
      number: string | null;
      status: string;
      kind: string;
    } | null;
    if (!inv) continue;
    const invNo = inv.invoice_no ?? inv.number ?? inv.id.slice(0, 8);
    const list = invoicesByReportId.get(ir.report_id) ?? [];
    list.push({ invoice_no: invNo, status: inv.status, kind: inv.kind });
    invoicesByReportId.set(ir.report_id, list);
  }

  const sources: RawJobRegisterSource[] = (jobsRes.data ?? []).map((row) => {
    const cust = row.customers as unknown as { id: string; name: string } | null;
    const rawAssignments =
      (row.assignments as unknown as Array<{
        work_date: string;
        people?: { full_name?: string | null } | null;
      }>) ?? [];
    const rawInspections =
      (row.inspections as unknown as Array<{
        readings: Json | null;
        submitted_at: string | null;
        people?: { full_name?: string | null } | null;
      }>) ?? [];
    const rawReports =
      (row.reports as unknown as Array<{
        id: string;
        report_no: string;
        report_date: string;
        method: Enums<"test_method">;
        content: Json | null;
      }>) ?? [];
    const rawInvoices =
      (row.invoices as unknown as Array<{
        id: string;
        invoice_no: string | null;
        number: string | null;
        status: string;
        kind: string;
      }>) ?? [];

    const combinedInvoices: Array<{
      invoice_no: string;
      status: string;
      kind: string;
    }> = rawInvoices.map((inv) => ({
      invoice_no: inv.invoice_no ?? inv.number ?? inv.id.slice(0, 8),
      status: inv.status,
      kind: inv.kind,
    }));

    for (const r of rawReports) {
      const linked = invoicesByReportId.get(r.id) ?? [];
      for (const l of linked) {
        combinedInvoices.push(l);
      }
    }

    return {
      id: row.id,
      job_no: row.job_no,
      customer_id: row.customer_id,
      customer_name: cust?.name ?? "Unknown Customer",
      site: row.site,
      scope: row.scope,
      status: row.status,
      test_methods: row.test_methods ?? [],
      po_number: row.po_number,
      created_at: row.created_at,
      assignments: rawAssignments.map((a) => ({
        work_date: a.work_date,
        person_name: a.people?.full_name ?? null,
      })),
      inspections: rawInspections.map((i) => ({
        readings: i.readings,
        submitted_by_name: i.people?.full_name ?? null,
        submitted_at: i.submitted_at,
      })),
      reports: rawReports,
      invoices: combinedInvoices,
    };
  });

  return {
    data: buildJobRegisterRows(sources, filters),
    error: null,
  };
}
