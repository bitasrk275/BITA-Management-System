// Single source of truth for BITA's Monthly / Date-Range CA GST Export (GSTR-1 layout, T36).
// Keeps column definitions in one place so they can be adjusted in one edit once BITA's CA confirms their exact sheet.
// Rules:
// - Includes only 'issued', 'partly_paid', 'paid', and 'cancelled' tax invoices (never 'draft').
// - 'cancelled' invoices are listed with status = 'cancelled' and zero amounts (0.00).
// - B2B rows: Customer GSTIN, Customer Name, Invoice No, Invoice Date, Place of Supply, SAC, Status, Taxable Value, CGST, SGST, IGST, Total.
// - B2C rows: Same columns without Customer GSTIN.

import { DEFAULT_SAC_CODE, formatPlaceOfSupply, roundPaise } from "./gst";

export const INCLUDED_GST_STATUSES = ["issued", "partly_paid", "paid", "cancelled"] as const;
export type IncludedGstStatus = (typeof INCLUDED_GST_STATUSES)[number];

export interface GstExportInvoiceInput {
  id?: string;
  kind?: "tax_invoice" | "proforma" | string | null;
  status: string;
  invoice_no?: string | null;
  number?: string | null;
  invoice_date?: string | null;
  place_of_supply?: string | null;
  taxable_value?: number | string | null;
  cgst?: number | string | null;
  sgst?: number | string | null;
  igst?: number | string | null;
  round_off?: number | string | null;
  total?: number | string | null;
  customer_name?: string | null;
  customer_gstin?: string | null;
  customer_address?: string | null;
  sac?: string | null;
  lines?: ReadonlyArray<{ sac?: string | null }> | null;
}

export interface GstExportRow {
  category: "B2B" | "B2C";
  customer_gstin: string;
  customer_name: string;
  invoice_no: string;
  invoice_date: string;
  place_of_supply: string;
  sac: string;
  status: IncludedGstStatus;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  round_off: number;
  total: number;
}

export interface GstExportTotals {
  count: number;
  cancelled_count: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface GstExportReport {
  from_date: string;
  to_date: string;
  b2b: GstExportRow[];
  b2c: GstExportRow[];
  b2b_totals: GstExportTotals;
  b2c_totals: GstExportTotals;
  grand_totals: GstExportTotals;
}

export interface GstColumnDef<R> {
  key: string;
  header: string;
  value: (row: R) => string | number;
}

function formatAmount(n: number): string {
  return roundPaise(n).toFixed(2);
}

// Single source of truth for B2B and B2C column layouts.
export const B2B_GST_COLUMNS: ReadonlyArray<GstColumnDef<GstExportRow>> = [
  { key: "customer_gstin", header: "Customer GSTIN", value: (r) => r.customer_gstin },
  { key: "customer_name", header: "Customer Name", value: (r) => r.customer_name },
  { key: "invoice_no", header: "Invoice No", value: (r) => r.invoice_no },
  { key: "invoice_date", header: "Invoice Date", value: (r) => r.invoice_date },
  { key: "place_of_supply", header: "Place of Supply", value: (r) => r.place_of_supply },
  { key: "sac", header: "SAC", value: (r) => r.sac },
  { key: "status", header: "Status", value: (r) => r.status },
  { key: "taxable_value", header: "Taxable Value", value: (r) => formatAmount(r.taxable_value) },
  { key: "cgst", header: "CGST", value: (r) => formatAmount(r.cgst) },
  { key: "sgst", header: "SGST", value: (r) => formatAmount(r.sgst) },
  { key: "igst", header: "IGST", value: (r) => formatAmount(r.igst) },
  { key: "total", header: "Total", value: (r) => formatAmount(r.total) },
];

export const B2C_GST_COLUMNS: ReadonlyArray<GstColumnDef<GstExportRow>> = B2B_GST_COLUMNS.filter(
  (col) => col.key !== "customer_gstin",
);

/**
 * Resolves a month ('YYYY-MM') or explicit date range ('from', 'to') into { fromDate, toDate, month }.
 */
export function resolveGstExportPeriod(
  params: { month?: string | null; from?: string | null; to?: string | null },
  defaultToday = "2026-11-07",
): { fromDate: string; toDate: string; month: string } {
  const defaultMonth = /^\d{4}-\d{2}/.exec(defaultToday)?.[0] ?? "2026-11";
  const rawFrom = params.from?.trim() ?? "";
  const rawTo = params.to?.trim() ?? "";
  const rawMonth = params.month?.trim() ?? "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawFrom) && /^\d{4}-\d{2}-\d{2}$/.test(rawTo)) {
    const [fromDate, toDate] = rawFrom <= rawTo ? [rawFrom, rawTo] : [rawTo, rawFrom];
    return {
      fromDate,
      toDate,
      month: fromDate.slice(0, 7),
    };
  }

  const targetMonth = /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : defaultMonth;
  const [yearStr, monthStr] = targetMonth.split("-");
  const year = Number(yearStr);
  const monthIdx = Number(monthStr); // 1..12
  const lastDay = new Date(Date.UTC(year, monthIdx, 0)).getUTCDate();
  const fromDate = `${targetMonth}-01`;
  const toDate = `${targetMonth}-${String(lastDay).padStart(2, "0")}`;

  return { fromDate, toDate, month: targetMonth };
}

function resolveSacForInvoice(inv: GstExportInvoiceInput): string {
  if (typeof inv.sac === "string" && inv.sac.trim()) {
    return inv.sac.trim();
  }
  if (Array.isArray(inv.lines) && inv.lines.length > 0) {
    const unique = Array.from(
      new Set(
        inv.lines
          .map((l) => (typeof l?.sac === "string" ? l.sac.trim() : ""))
          .filter(Boolean),
      ),
    );
    if (unique.length > 0) return unique.join(", ");
  }
  return DEFAULT_SAC_CODE;
}

function summarizeRows(rows: ReadonlyArray<GstExportRow>): GstExportTotals {
  let count = 0;
  let cancelledCount = 0;
  let taxable = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let total = 0;

  for (const r of rows) {
    count += 1;
    if (r.status === "cancelled") {
      cancelledCount += 1;
      continue;
    }
    taxable = roundPaise(taxable + r.taxable_value);
    cgst = roundPaise(cgst + r.cgst);
    sgst = roundPaise(sgst + r.sgst);
    igst = roundPaise(igst + r.igst);
    total = roundPaise(total + r.total);
  }

  return {
    count,
    cancelled_count: cancelledCount,
    taxable_value: taxable,
    cgst,
    sgst,
    igst,
    total,
  };
}

/**
 * Builds the GSTR-1 B2B and B2C export rows and summary totals for the given date range.
 */
export function buildGstExportReport(
  invoices: ReadonlyArray<GstExportInvoiceInput>,
  options: { fromDate?: string; toDate?: string } = {},
): GstExportReport {
  const fromDate = options.fromDate?.trim() || "0000-01-01";
  const toDate = options.toDate?.trim() || "9999-12-31";

  const b2b: GstExportRow[] = [];
  const b2c: GstExportRow[] = [];

  const sorted = [...invoices].sort((a, b) => {
    const dateA = a.invoice_date ?? "";
    const dateB = b.invoice_date ?? "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const noA = a.invoice_no ?? a.number ?? "";
    const noB = b.invoice_no ?? b.number ?? "";
    return noA.localeCompare(noB);
  });

  for (const inv of sorted) {
    if (inv.kind && inv.kind !== "tax_invoice") continue;

    const status = inv.status as IncludedGstStatus;
    if (!INCLUDED_GST_STATUSES.includes(status)) {
      // Skip 'draft' or any unknown status
      continue;
    }

    const invoiceNo = (inv.invoice_no ?? inv.number ?? "").trim();
    // A draft that was cancelled before ever getting an invoice_no is not a numbered GST invoice
    if (!invoiceNo && status === "cancelled") {
      continue;
    }

    const invDate = (inv.invoice_date ?? "").trim();
    if (invDate) {
      if (invDate < fromDate || invDate > toDate) continue;
    } else if (options.fromDate || options.toDate) {
      continue;
    }

    const isCancelled = status === "cancelled";
    const gstin = (inv.customer_gstin ?? "").trim().toUpperCase();
    const isB2B = gstin.length > 0;

    const placeDisplay = formatPlaceOfSupply(
      inv.place_of_supply ?? (gstin ? gstin.slice(0, 2) : inv.customer_address),
    );

    const row: GstExportRow = {
      category: isB2B ? "B2B" : "B2C",
      customer_gstin: gstin,
      customer_name: (inv.customer_name ?? "Customer").trim() || "Customer",
      invoice_no: invoiceNo || "CANCELLED",
      invoice_date: invDate,
      place_of_supply: placeDisplay,
      sac: resolveSacForInvoice(inv),
      status,
      taxable_value: isCancelled ? 0 : roundPaise(Number(inv.taxable_value) || 0),
      cgst: isCancelled ? 0 : roundPaise(Number(inv.cgst) || 0),
      sgst: isCancelled ? 0 : roundPaise(Number(inv.sgst) || 0),
      igst: isCancelled ? 0 : roundPaise(Number(inv.igst) || 0),
      round_off: isCancelled ? 0 : roundPaise(Number(inv.round_off) || 0),
      total: isCancelled ? 0 : roundPaise(Number(inv.total) || 0),
    };

    if (isB2B) {
      b2b.push(row);
    } else {
      b2c.push(row);
    }
  }

  const b2bTotals = summarizeRows(b2b);
  const b2cTotals = summarizeRows(b2c);
  const grandTotals = summarizeRows([...b2b, ...b2c]);

  return {
    from_date: fromDate,
    to_date: toDate,
    b2b,
    b2c,
    b2b_totals: b2bTotals,
    b2c_totals: b2cTotals,
    grand_totals: grandTotals,
  };
}

export function csvEscapeCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  // Spreadsheet formula injection: a text cell such as a customer name starting with = + - @ would run as a
  // formula when the CA opens the file. Prefix it with an apostrophe; plain numbers are left as they are.
  if (/^[=+\-@\t\r]/.test(str) && !/^-?\d+(\.\d+)?$/.test(str)) {
    return csvEscapeCell(`'${str}`);
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function serializeTableToCsv(
  rows: ReadonlyArray<GstExportRow>,
  columns: ReadonlyArray<GstColumnDef<GstExportRow>>,
  totals: GstExportTotals,
): string[] {
  const lines: string[] = [];
  lines.push(columns.map((c) => csvEscapeCell(c.header)).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscapeCell(c.value(row))).join(","));
  }
  const totalCells = columns.map((c, idx) => {
    if (idx === 0) return "TOTAL";
    if (c.key === "taxable_value") return formatAmount(totals.taxable_value);
    if (c.key === "cgst") return formatAmount(totals.cgst);
    if (c.key === "sgst") return formatAmount(totals.sgst);
    if (c.key === "igst") return formatAmount(totals.igst);
    if (c.key === "total") return formatAmount(totals.total);
    return "";
  });
  lines.push(totalCells.map(csvEscapeCell).join(","));
  return lines;
}

/**
 * Serializes only the B2B section to CSV (with UTF-8 BOM for Excel).
 */
export function toB2bCsv(report: GstExportReport): string {
  return `\uFEFF${serializeTableToCsv(report.b2b, B2B_GST_COLUMNS, report.b2b_totals).join("\r\n")}\r\n`;
}

/**
 * Serializes only the B2C section to CSV (with UTF-8 BOM for Excel).
 */
export function toB2cCsv(report: GstExportReport): string {
  return `\uFEFF${serializeTableToCsv(report.b2c, B2C_GST_COLUMNS, report.b2c_totals).join("\r\n")}\r\n`;
}

/**
 * Serializes the complete GSTR-1 CA export (both B2B and B2C sections + summary) to CSV.
 */
export function toCombinedGstCsv(report: GstExportReport): string {
  const lines: string[] = [
    `BITA GSTR-1 Sales Export (${report.from_date} to ${report.to_date})`,
    "",
    "SECTION 1: B2B INVOICES (Registered Customers with GSTIN)",
    ...serializeTableToCsv(report.b2b, B2B_GST_COLUMNS, report.b2b_totals),
    "",
    "SECTION 2: B2C INVOICES (Unregistered Customers without GSTIN)",
    ...serializeTableToCsv(report.b2c, B2C_GST_COLUMNS, report.b2c_totals),
    "",
    "SECTION 3: GRAND SUMMARY",
    "Category,Invoices Count,Cancelled Count,Taxable Value,CGST,SGST,IGST,Total",
    [
      "B2B",
      report.b2b_totals.count,
      report.b2b_totals.cancelled_count,
      formatAmount(report.b2b_totals.taxable_value),
      formatAmount(report.b2b_totals.cgst),
      formatAmount(report.b2b_totals.sgst),
      formatAmount(report.b2b_totals.igst),
      formatAmount(report.b2b_totals.total),
    ]
      .map(csvEscapeCell)
      .join(","),
    [
      "B2C",
      report.b2c_totals.count,
      report.b2c_totals.cancelled_count,
      formatAmount(report.b2c_totals.taxable_value),
      formatAmount(report.b2c_totals.cgst),
      formatAmount(report.b2c_totals.sgst),
      formatAmount(report.b2c_totals.igst),
      formatAmount(report.b2c_totals.total),
    ]
      .map(csvEscapeCell)
      .join(","),
    [
      "GRAND TOTAL",
      report.grand_totals.count,
      report.grand_totals.cancelled_count,
      formatAmount(report.grand_totals.taxable_value),
      formatAmount(report.grand_totals.cgst),
      formatAmount(report.grand_totals.sgst),
      formatAmount(report.grand_totals.igst),
      formatAmount(report.grand_totals.total),
    ]
      .map(csvEscapeCell)
      .join(","),
  ];

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function xmlEscape(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildWorksheetXml(
  name: string,
  rows: ReadonlyArray<GstExportRow>,
  columns: ReadonlyArray<GstColumnDef<GstExportRow>>,
  totals: GstExportTotals,
): string {
  const numericKeys = new Set(["taxable_value", "cgst", "sgst", "igst", "total"]);
  const headerXml = `<Row>${columns
    .map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c.header)}</Data></Cell>`)
    .join("")}</Row>`;

  const bodyXml = rows
    .map((r) => {
      const cells = columns
        .map((c) => {
          const val = c.value(r);
          const type = numericKeys.has(c.key) ? "Number" : "String";
          return `<Cell><Data ss:Type="${type}">${xmlEscape(val)}</Data></Cell>`;
        })
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  const totalCells = columns
    .map((c, idx) => {
      if (idx === 0) return `<Cell><Data ss:Type="String">TOTAL</Data></Cell>`;
      if (c.key === "taxable_value")
        return `<Cell><Data ss:Type="Number">${formatAmount(totals.taxable_value)}</Data></Cell>`;
      if (c.key === "cgst")
        return `<Cell><Data ss:Type="Number">${formatAmount(totals.cgst)}</Data></Cell>`;
      if (c.key === "sgst")
        return `<Cell><Data ss:Type="Number">${formatAmount(totals.sgst)}</Data></Cell>`;
      if (c.key === "igst")
        return `<Cell><Data ss:Type="Number">${formatAmount(totals.igst)}</Data></Cell>`;
      if (c.key === "total")
        return `<Cell><Data ss:Type="Number">${formatAmount(totals.total)}</Data></Cell>`;
      return `<Cell><Data ss:Type="String"></Data></Cell>`;
    })
    .join("");

  return `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${headerXml}${bodyXml}<Row>${totalCells}</Row></Table></Worksheet>`;
}

/**
 * Generates a multi-sheet Excel 2003 XML Workbook (.xls) with B2B and B2C worksheets,
 * requiring zero external npm packages.
 */
export function toGstExcelXml(report: GstExportReport): string {
  const b2bSheet = buildWorksheetXml("B2B Invoices", report.b2b, B2B_GST_COLUMNS, report.b2b_totals);
  const b2cSheet = buildWorksheetXml("B2C Invoices", report.b2c, B2C_GST_COLUMNS, report.b2c_totals);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<?mso-application progid="Excel.Sheet"?>`,
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`,
    b2bSheet,
    b2cSheet,
    `</Workbook>`,
  ].join("\n");
}
