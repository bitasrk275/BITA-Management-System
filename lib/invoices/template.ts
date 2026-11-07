// Single source of truth for BITA Tax Invoice layout (PDF and Word .docx).
// When BITA's reference invoices arrive, update DEFAULT_BITA_INVOICE_PROFILE and this file only.
// Do NOT invent BITA's bank details or terms — keep clearly marked placeholders until confirmed.

import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  BITA_STATE_CODE,
  BITA_STATE_NAME,
  DEFAULT_SAC_CODE,
  formatPlaceOfSupply,
  resolvePlaceOfSupplyCode,
  roundPaise,
} from "./gst";
import { amountInWordsINR } from "./words";

export interface BitaInvoiceProfile {
  name: string;
  subtitle: string;
  address: string;
  gstin: string;
  stateCode: string;
  stateName: string;
  defaultSac: string;
  bankDetailsPlaceholder: string;
  termsPlaceholder: string;
}

export const DEFAULT_BITA_INVOICE_PROFILE: BitaInvoiceProfile = {
  name: "BANGALORE INSPECTION & TESTING AGENCY",
  subtitle: "Non-Destructive Testing & Inspection Engineers (Estd. 1987)",
  address: "Bengaluru, Karnataka, India — [Office address placeholder pending BITA reference invoice]",
  gstin: "[BITA GSTIN placeholder · State Code 29 (Karnataka)]",
  stateCode: BITA_STATE_CODE,
  stateName: BITA_STATE_NAME,
  defaultSac: DEFAULT_SAC_CODE,
  bankDetailsPlaceholder:
    "[BANK DETAILS PLACEHOLDER — Bank Name, Branch, Account Number & IFSC to be filled from BITA's reference invoice]",
  termsPlaceholder:
    "[TERMS & CONDITIONS PLACEHOLDER — Payment terms & declaration to be filled from BITA's reference invoice]",
};

export interface InvoiceTemplateLine {
  position?: number;
  description: string;
  sac?: string | null;
  qty: number;
  unit?: string | null;
  rate: number;
  amount: number;
}

export interface InvoiceTemplateInput {
  kind?: "tax_invoice" | "proforma";
  status: string;
  invoiceNo?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  jobNo?: string | null;
  reportNo?: string | null;
  quotationRef?: string | null;
  poNumber?: string | null;
  poDate?: string | null;
  customerName: string;
  customerAddress?: string | null;
  customerGstin?: string | null;
  placeOfSupply?: string | null;
  lines: InvoiceTemplateLine[];
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  notes?: string | null;
  profile?: Partial<BitaInvoiceProfile>;
}

export interface InvoiceDocumentSpec {
  title: string;
  isDraft: boolean;
  seller: BitaInvoiceProfile;
  invoiceNoDisplay: string;
  invoiceDateDisplay: string;
  dueDateDisplay: string;
  jobNoDisplay: string;
  reportNoDisplay: string;
  quotationRefDisplay: string;
  poDisplay: string;
  customerName: string;
  customerAddress: string;
  customerGstin: string;
  placeOfSupplyCode: string;
  placeOfSupplyDisplay: string;
  isIntraState: boolean;
  defaultSac: string;
  lines: Array<{
    slNo: number;
    description: string;
    sac: string;
    qty: string;
    unit: string;
    rate: string;
    amount: string;
  }>;
  taxableValueDisplay: string;
  cgstDisplay: string;
  sgstDisplay: string;
  igstDisplay: string;
  roundOffDisplay: string;
  totalDisplay: string;
  amountInWords: string;
  notes: string;
}

export function formatRupeeNumber(value: number | string | null | undefined): string {
  const num = roundPaise(Number(value) || 0);
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  return `${sign}Rs. ${abs.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function buildInvoiceDocumentSpec(input: InvoiceTemplateInput): InvoiceDocumentSpec {
  const seller: BitaInvoiceProfile = {
    ...DEFAULT_BITA_INVOICE_PROFILE,
    ...(input.profile ?? {}),
  };

  const isDraft = input.status === "draft" || (!input.invoiceNo && input.status !== "issued" && input.status !== "paid" && input.status !== "partly_paid");
  const title =
    input.kind === "proforma"
      ? isDraft
        ? "DRAFT PROFORMA INVOICE"
        : "PROFORMA INVOICE"
      : isDraft
        ? "DRAFT TAX INVOICE"
        : "TAX INVOICE";

  const placeCode = resolvePlaceOfSupplyCode({
    placeOfSupply: input.placeOfSupply,
    gstin: input.customerGstin,
    billingAddress: input.customerAddress,
  });
  const isIntraState = placeCode === BITA_STATE_CODE;

  const formattedLines = (input.lines.length > 0
    ? input.lines
    : [{ description: "NDT Inspection Services", sac: seller.defaultSac, qty: 1, unit: "job", rate: 0, amount: 0 }]
  ).map((line, index) => {
    const sac = (line.sac ?? seller.defaultSac ?? "").trim();
    const qtyNum = Number(line.qty) || 0;
    const qtyStr = Number.isInteger(qtyNum) ? String(qtyNum) : qtyNum.toFixed(3).replace(/\.?0+$/, "");
    return {
      slNo: index + 1,
      description: line.description.trim() || `Item ${index + 1}`,
      sac: sac || "—",
      qty: qtyStr,
      unit: line.unit?.trim() || "nos",
      rate: formatRupeeNumber(line.rate),
      amount: formatRupeeNumber(line.amount),
    };
  });

  const roundOffNum = roundPaise(input.roundOff);
  const roundOffPrefix = roundOffNum > 0 ? "+" : "";

  return {
    title,
    isDraft,
    seller,
    invoiceNoDisplay: input.invoiceNo?.trim() || "DRAFT (Unissued)",
    invoiceDateDisplay: input.invoiceDate?.trim() || "—",
    dueDateDisplay: input.dueDate?.trim() || "—",
    jobNoDisplay: input.jobNo?.trim() || "—",
    reportNoDisplay: input.reportNo?.trim() || "—",
    quotationRefDisplay: input.quotationRef?.trim() || "—",
    poDisplay: [input.poNumber?.trim(), input.poDate?.trim() ? `dt. ${input.poDate.trim()}` : null]
      .filter(Boolean)
      .join(" ") || "—",
    customerName: input.customerName.trim() || "—",
    customerAddress: input.customerAddress?.trim() || "—",
    customerGstin: input.customerGstin?.trim() || "Unregistered / Not provided",
    placeOfSupplyCode: placeCode,
    placeOfSupplyDisplay: formatPlaceOfSupply(placeCode),
    isIntraState,
    defaultSac: seller.defaultSac || "—",
    lines: formattedLines,
    taxableValueDisplay: formatRupeeNumber(input.taxableValue),
    cgstDisplay: formatRupeeNumber(input.cgst),
    sgstDisplay: formatRupeeNumber(input.sgst),
    igstDisplay: formatRupeeNumber(input.igst),
    roundOffDisplay: `${roundOffPrefix}${formatRupeeNumber(roundOffNum)}`,
    totalDisplay: formatRupeeNumber(input.total),
    amountInWords: amountInWordsINR(input.total),
    notes: input.notes?.trim() || "",
  };
}

function pdfEscape(text: string): string {
  return text
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Generates a clean, self-contained PDF 1.4 document for a BITA Tax Invoice.
 */
export function generateInvoicePdfBytes(input: InvoiceTemplateInput): Uint8Array {
  const spec = buildInvoiceDocumentSpec(input);
  const lines: string[] = [];

  lines.push("==========================================================================================");
  lines.push(`  ${spec.seller.name}`);
  lines.push(`  ${spec.seller.subtitle}`);
  lines.push(`  ${spec.seller.address}`);
  lines.push(`  Supplier GSTIN: ${spec.seller.gstin}   |   State: ${spec.seller.stateCode} - ${spec.seller.stateName}`);
  lines.push("==========================================================================================");
  lines.push(`  ${spec.title}`);
  if (spec.isDraft) {
    lines.push("  [DRAFT PREVIEW - INVOICE NUMBER ASSIGNED ON ISSUE]");
  }
  lines.push("------------------------------------------------------------------------------------------");
  lines.push(`  Invoice No.     : ${spec.invoiceNoDisplay.padEnd(28)} Invoice Date    : ${spec.invoiceDateDisplay}`);
  lines.push(`  Due Date        : ${spec.dueDateDisplay.padEnd(28)} Job ID          : ${spec.jobNoDisplay}`);
  lines.push(`  Report No.      : ${spec.reportNoDisplay.padEnd(28)} Quotation Ref   : ${spec.quotationRefDisplay}`);
  lines.push(`  Customer PO     : ${spec.poDisplay.padEnd(28)} Place of Supply : ${spec.placeOfSupplyDisplay}`);
  lines.push("------------------------------------------------------------------------------------------");
  lines.push("  BILL TO (CUSTOMER):");
  lines.push(`  Name            : ${spec.customerName}`);
  lines.push(`  Billing Address : ${spec.customerAddress}`);
  lines.push(`  Customer GSTIN  : ${spec.customerGstin}`);
  lines.push("------------------------------------------------------------------------------------------");
  lines.push("  Sl  Description                                      SAC       Qty   Unit        Rate          Amount");
  lines.push("------------------------------------------------------------------------------------------");

  for (const item of spec.lines) {
    const sl = String(item.slNo).padEnd(3);
    const desc = item.description.slice(0, 46).padEnd(47);
    const sac = item.sac.slice(0, 8).padEnd(9);
    const qty = item.qty.slice(0, 5).padStart(5);
    const unit = item.unit.slice(0, 8).padEnd(8);
    const rate = item.rate.padStart(12);
    const amt = item.amount.padStart(14);
    lines.push(`  ${sl} ${desc} ${sac} ${qty} ${unit} ${rate} ${amt}`);
    if (item.description.length > 46) {
      lines.push(`      ${item.description.slice(46, 110)}`);
    }
  }

  lines.push("------------------------------------------------------------------------------------------");
  lines.push(`  Taxable Value                                                      : ${spec.taxableValueDisplay.padStart(18)}`);
  if (spec.isIntraState) {
    lines.push(`  CGST @ 9% (Intra-state Karnataka)                                  : ${spec.cgstDisplay.padStart(18)}`);
    lines.push(`  SGST @ 9% (Intra-state Karnataka)                                  : ${spec.sgstDisplay.padStart(18)}`);
  } else {
    lines.push(`  IGST @ 18% (Inter-state Supply)                                    : ${spec.igstDisplay.padStart(18)}`);
  }
  lines.push(`  Round-off                                                          : ${spec.roundOffDisplay.padStart(18)}`);
  lines.push("------------------------------------------------------------------------------------------");
  lines.push(`  GRAND TOTAL (INR)                                                  : ${spec.totalDisplay.padStart(18)}`);
  lines.push(`  Amount in Words : ${spec.amountInWords}`);
  lines.push("------------------------------------------------------------------------------------------");
  if (spec.notes) {
    lines.push(`  Notes           : ${spec.notes}`);
  }
  lines.push(`  Bank Details    : ${spec.seller.bankDetailsPlaceholder}`);
  lines.push(`  Terms           : ${spec.seller.termsPlaceholder}`);
  lines.push("------------------------------------------------------------------------------------------");
  lines.push(`  For ${spec.seller.name}`);
  lines.push("  Authorised Signatory");
  lines.push("==========================================================================================");

  const streamLines: string[] = ["BT", "/F1 8.5 Tf", "28 808 Td", "12 TL"];
  for (const rawLine of lines.slice(0, 62)) {
    const clipped = rawLine.length > 104 ? `${rawLine.slice(0, 101)}...` : rawLine;
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

const BORDER_LINE = {
  style: BorderStyle.SINGLE,
  size: 6,
  color: "222222",
};

const CELL_BORDERS = {
  top: BORDER_LINE,
  bottom: BORDER_LINE,
  left: BORDER_LINE,
  right: BORDER_LINE,
};

function makeCell(
  text: string,
  options: {
    widthTwips: number;
    bold?: boolean;
    shaded?: boolean;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    colSpan?: number;
  },
): TableCell {
  return new TableCell({
    width: { size: options.widthTwips, type: WidthType.DXA },
    columnSpan: options.colSpan,
    verticalAlign: VerticalAlign.CENTER,
    borders: CELL_BORDERS,
    shading: options.shaded ? { type: ShadingType.CLEAR, color: "auto", fill: "F3F4F6" } : undefined,
    margins: { top: 80, bottom: 80, left: 110, right: 110 },
    children: [
      new Paragraph({
        alignment: options.align ?? AlignmentType.LEFT,
        children: [
          new TextRun({
            text,
            bold: options.bold,
            font: "Arial",
            size: 18, // 9pt
          }),
        ],
      }),
    ],
  });
}

/**
 * Generates a Word (.docx) BITA Tax Invoice using docx@9.13.0 from the shared InvoiceDocumentSpec.
 */
export async function generateInvoiceDocxBytes(input: InvoiceTemplateInput): Promise<Uint8Array> {
  const spec = buildInvoiceDocumentSpec(input);

  // Page content width = 10466 twips
  const metaRows: TableRow[] = [
    new TableRow({
      children: [
        makeCell("Invoice No.", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.invoiceNoDisplay, { widthTwips: 3233, bold: true }),
        makeCell("Invoice Date", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.invoiceDateDisplay, { widthTwips: 3233 }),
      ],
    }),
    new TableRow({
      children: [
        makeCell("Due Date", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.dueDateDisplay, { widthTwips: 3233 }),
        makeCell("Job ID", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.jobNoDisplay, { widthTwips: 3233 }),
      ],
    }),
    new TableRow({
      children: [
        makeCell("Report No.", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.reportNoDisplay, { widthTwips: 3233 }),
        makeCell("Quotation Ref", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.quotationRefDisplay, { widthTwips: 3233 }),
      ],
    }),
    new TableRow({
      children: [
        makeCell("Customer PO", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.poDisplay, { widthTwips: 3233 }),
        makeCell("Place of Supply", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.placeOfSupplyDisplay, { widthTwips: 3233, bold: true }),
      ],
    }),
    new TableRow({
      children: [
        makeCell("Bill To (Customer)", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(`${spec.customerName}\n${spec.customerAddress}`, { widthTwips: 8466, colSpan: 3 }),
      ],
    }),
    new TableRow({
      children: [
        makeCell("Customer GSTIN", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.customerGstin, { widthTwips: 8466, colSpan: 3, bold: true }),
      ],
    }),
  ];

  // Line items table: 6 columns summing to 10466 twips
  // Sl (666), Description (4100), SAC (1200), Qty & Unit (1300), Rate (1600), Amount (1600)
  const itemRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell("Sl.", { widthTwips: 666, bold: true, shaded: true, align: AlignmentType.CENTER }),
        makeCell("Description of Services", { widthTwips: 4100, bold: true, shaded: true }),
        makeCell("SAC", { widthTwips: 1200, bold: true, shaded: true, align: AlignmentType.CENTER }),
        makeCell("Qty / Unit", { widthTwips: 1300, bold: true, shaded: true, align: AlignmentType.RIGHT }),
        makeCell("Rate", { widthTwips: 1600, bold: true, shaded: true, align: AlignmentType.RIGHT }),
        makeCell("Amount", { widthTwips: 1600, bold: true, shaded: true, align: AlignmentType.RIGHT }),
      ],
    }),
    ...spec.lines.map(
      (line) =>
        new TableRow({
          children: [
            makeCell(String(line.slNo), { widthTwips: 666, align: AlignmentType.CENTER }),
            makeCell(line.description, { widthTwips: 4100 }),
            makeCell(line.sac, { widthTwips: 1200, align: AlignmentType.CENTER }),
            makeCell(`${line.qty} ${line.unit}`, { widthTwips: 1300, align: AlignmentType.RIGHT }),
            makeCell(line.rate, { widthTwips: 1600, align: AlignmentType.RIGHT }),
            makeCell(line.amount, { widthTwips: 1600, align: AlignmentType.RIGHT, bold: true }),
          ],
        }),
    ),
    new TableRow({
      children: [
        makeCell("Taxable Value", { widthTwips: 8866, colSpan: 5, bold: true, align: AlignmentType.RIGHT }),
        makeCell(spec.taxableValueDisplay, { widthTwips: 1600, bold: true, align: AlignmentType.RIGHT }),
      ],
    }),
  ];

  if (spec.isIntraState) {
    itemRows.push(
      new TableRow({
        children: [
          makeCell("CGST @ 9% (Intra-state Karnataka)", { widthTwips: 8866, colSpan: 5, align: AlignmentType.RIGHT }),
          makeCell(spec.cgstDisplay, { widthTwips: 1600, align: AlignmentType.RIGHT }),
        ],
      }),
      new TableRow({
        children: [
          makeCell("SGST @ 9% (Intra-state Karnataka)", { widthTwips: 8866, colSpan: 5, align: AlignmentType.RIGHT }),
          makeCell(spec.sgstDisplay, { widthTwips: 1600, align: AlignmentType.RIGHT }),
        ],
      }),
    );
  } else {
    itemRows.push(
      new TableRow({
        children: [
          makeCell("IGST @ 18% (Inter-state Supply)", { widthTwips: 8866, colSpan: 5, align: AlignmentType.RIGHT }),
          makeCell(spec.igstDisplay, { widthTwips: 1600, align: AlignmentType.RIGHT }),
        ],
      }),
    );
  }

  itemRows.push(
    new TableRow({
      children: [
        makeCell("Round-off", { widthTwips: 8866, colSpan: 5, align: AlignmentType.RIGHT }),
        makeCell(spec.roundOffDisplay, { widthTwips: 1600, align: AlignmentType.RIGHT }),
      ],
    }),
    new TableRow({
      children: [
        makeCell("Total Invoice Amount (INR)", {
          widthTwips: 8866,
          colSpan: 5,
          bold: true,
          shaded: true,
          align: AlignmentType.RIGHT,
        }),
        makeCell(spec.totalDisplay, {
          widthTwips: 1600,
          bold: true,
          shaded: true,
          align: AlignmentType.RIGHT,
        }),
      ],
    }),
    new TableRow({
      children: [
        makeCell(`Amount in Words: ${spec.amountInWords}`, {
          widthTwips: 10466,
          colSpan: 6,
          bold: true,
        }),
      ],
    }),
  );

  const footerRows: TableRow[] = [];
  if (spec.notes) {
    footerRows.push(
      new TableRow({
        children: [
          makeCell("Notes", { widthTwips: 2000, bold: true, shaded: true }),
          makeCell(spec.notes, { widthTwips: 8466 }),
        ],
      }),
    );
  }
  footerRows.push(
    new TableRow({
      children: [
        makeCell("Bank Details", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.seller.bankDetailsPlaceholder, { widthTwips: 8466 }),
      ],
    }),
    new TableRow({
      children: [
        makeCell("Terms & Conditions", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(spec.seller.termsPlaceholder, { widthTwips: 8466 }),
      ],
    }),
    new TableRow({
      children: [
        makeCell("Signatory", { widthTwips: 2000, bold: true, shaded: true }),
        makeCell(`For ${spec.seller.name}\n\nAuthorised Signatory`, { widthTwips: 8466, bold: true }),
      ],
    }),
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: spec.seller.name, bold: true, font: "Arial", size: 28 }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: spec.seller.subtitle, font: "Arial", size: 18 }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: spec.seller.address, font: "Arial", size: 16 }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 140 },
            children: [
              new TextRun({
                text: `GSTIN: ${spec.seller.gstin}  |  State: ${spec.seller.stateCode} - ${spec.seller.stateName}`,
                bold: true,
                font: "Arial",
                size: 18,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [
              new TextRun({ text: spec.title, bold: true, font: "Arial", size: 24 }),
            ],
          }),
          new Table({
            width: { size: 10466, type: WidthType.DXA },
            columnWidths: [2000, 3233, 2000, 3233],
            layout: TableLayoutType.FIXED,
            rows: metaRows,
          }),
          new Paragraph({ text: "", spacing: { after: 140 } }),
          new Table({
            width: { size: 10466, type: WidthType.DXA },
            columnWidths: [666, 4100, 1200, 1300, 1600, 1600],
            layout: TableLayoutType.FIXED,
            rows: itemRows,
          }),
          new Paragraph({ text: "", spacing: { after: 140 } }),
          new Table({
            width: { size: 10466, type: WidthType.DXA },
            columnWidths: [2000, 8466],
            layout: TableLayoutType.FIXED,
            rows: footerRows,
          }),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
