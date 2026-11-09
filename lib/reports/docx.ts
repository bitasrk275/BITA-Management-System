import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  reportMethod,
  type ReadingValue,
  type ReportMethod,
  type ReportMethodInput,
  type ReportReadings,
} from "./fields";
import { REPORT_LAYOUTS } from "../../templates/reports/layouts";
import type { ReportDocument } from "../../templates/reports/types";

function formatValue(reading: ReadingValue | undefined): string {
  return reading === null || reading === undefined || String(reading).trim() === ""
    ? "—"
    : String(reading);
}

function formatDate(reading: ReadingValue | undefined): string {
  if (typeof reading !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(reading)) {
    return formatValue(reading);
  }
  return `${reading.slice(8)}.${reading.slice(5, 7)}.${reading.slice(0, 4)}`;
}

function formatEquipment(readings: ReportReadings): string {
  const base = `${formatValue(readings.equipment)}\nS.No. ${formatValue(readings.equipment_serial)}`;
  if (readings.equipment_calibration && String(readings.equipment_calibration).trim()) {
    return `${base}\n${String(readings.equipment_calibration).trim()}`;
  }
  return base;
}

function resolveHeaderComponentId(readings: ReportReadings): string | null {
  if (readings.component_header_id && String(readings.component_header_id).trim()) {
    return String(readings.component_header_id).trim();
  }
  const items = readings.items ?? [];
  if (items.length === 1 && items[0]?.identification_no && String(items[0].identification_no).trim()) {
    const firstLine = String(items[0].identification_no).trim().split(/\r?\n|,/)[0]?.trim();
    if (firstLine) return firstLine;
  }
  return null;
}

export type ReportDocxDetailPair = {
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
};

export type ReportDocxTechnicianRow = {
  name: string;
  qualification: string;
  certificateNo: string;
  issuedOn: string;
  validUntil: string;
};

export type ReportDocxItemRow = {
  description: string;
  quantity: string;
  observations: string;
};

export type ReportDocxSpec = {
  method: ReportMethod;
  title: string;
  columns: readonly number[];
  isDraft: boolean;
  header: {
    companyName: string;
    addressLines: readonly string[];
    contactLines: readonly string[];
    reportNumber: string;
    componentHeaderId?: string | null;
    reportDateFormatted: string;
    columnSpans: readonly number[];
  };
  clientRows: ReadonlyArray<readonly [string, string]>;
  detailPairs: readonly ReportDocxDetailPair[];
  dptDetails: {
    itemsUsedLines: readonly string[];
    standardFollowed: string;
    dwellAndDevelopingTime: string;
  } | null;
  technicianSection: {
    label: string;
    headers: readonly string[];
    columnSpans: readonly number[];
    rows: readonly ReportDocxTechnicianRow[];
  };
  itemSection: {
    headers: readonly string[];
    columnSpans: readonly number[];
    rows: readonly ReportDocxItemRow[];
  };
  signoff: {
    forLine: string;
    signatoryName: string;
    signatoryQualification?: string;
    approvedAt: string;
  } | null;
  footerNotes: readonly string[];
};

/**
 * Builds the deterministic BITA Word (.docx) report structure matching `templates/reports/report.tsx`
 * and `templates/reports/layouts.ts` in field order, grid column widths (twips), and cell spans.
 */
export function buildReportDocxSpec(
  methodInput: ReportMethodInput,
  document: ReportDocument
): ReportDocxSpec {
  const method = reportMethod(methodInput);
  const layout = REPORT_LAYOUTS[method];
  const r = document.readings;
  const rawTechs = r.technicians?.length ? r.technicians : [{}];
  const rawItems = r.items?.length ? r.items : [{}];

  const detailPairs: ReportDocxDetailPair[] =
    method === "UT"
      ? [
          {
            leftLabel: "Equipment Used",
            leftValue: formatEquipment(r),
            rightLabel: "Reference Blocks",
            rightValue:
              r.calibration_method && String(r.calibration_method).trim()
                ? `${formatValue(r.reference_blocks)}\n${String(r.calibration_method).trim()}`
                : formatValue(r.reference_blocks),
          },
          {
            leftLabel: "Probe Used",
            leftValue: formatValue(r.probes),
            rightLabel: "Screen Range",
            rightValue: formatValue(r.screen_range),
          },
          {
            leftLabel: "Sensitivity Level",
            leftValue: formatValue(r.sensitivity),
            rightLabel: "Couplant",
            rightValue: formatValue(r.couplant),
          },
          {
            leftLabel: "Scanning Level",
            leftValue: formatValue(r.scanning_level),
            rightLabel: "Surface condition",
            rightValue: formatValue(r.surface_condition),
          },
          {
            leftLabel: "Standard Followed",
            leftValue: formatValue(r.standard),
            rightLabel: "Acceptance",
            rightValue: formatValue(r.acceptance_criteria),
          },
        ]
      : method === "MPT"
        ? [
            {
              leftLabel: "Items Used",
              leftValue: formatEquipment(r),
              rightLabel: "Medium",
              rightValue: formatValue(r.magnetic_medium),
            },
            {
              leftLabel: "Standard followed",
              leftValue: formatValue(r.standard),
              rightLabel: "Method",
              rightValue: formatValue(r.magnetisation_method),
            },
            {
              leftLabel: "Current Used",
              leftValue: formatValue(r.current),
              rightLabel: "Visible Light Intensity",
              rightValue: formatValue(r.visible_light_intensity),
            },
            {
              leftLabel: "Black Light",
              leftValue: formatValue(r.black_light),
              rightLabel: "Black Light Intensity",
              rightValue: formatValue(r.black_light_intensity),
            },
            {
              leftLabel: "Test Block",
              leftValue: formatValue(r.test_block),
              rightLabel: "Lifting Capacity of yoke",
              rightValue: formatValue(r.yoke_lifting_capacity),
            },
          ]
        : [];

  const dptDetails =
    method === "DPT"
      ? {
          itemsUsedLines: [
            `Cleaner: ${formatValue(r.cleaner)}   Batch No. ${formatValue(r.cleaner_batch)}`,
            `Penetrant: ${formatValue(r.penetrant)}   Batch No. ${formatValue(r.penetrant_batch)}`,
            `Developer: ${formatValue(r.developer)}   Batch No. ${formatValue(r.developer_batch)}`,
          ],
          standardFollowed: formatValue(r.standard),
          dwellAndDevelopingTime: `${formatValue(r.dwell_time)} / ${formatValue(r.developing_time)}`,
        }
      : null;

  const techRows: ReportDocxTechnicianRow[] = rawTechs.map((t) => ({
    name: formatValue(t.name),
    qualification: formatValue(t.qualification),
    certificateNo: formatValue(t.certificate_no),
    issuedOn: formatDate(t.issued_on),
    validUntil: formatDate(t.valid_until),
  }));

  const itemRows: ReportDocxItemRow[] = rawItems.map((item, idx) => {
    const rawDesc = formatValue(item.description);
    const prefixComp =
      method === "DPT" &&
      idx === 0 &&
      r.component_description &&
      !String(item.description ?? "").startsWith(String(r.component_description))
        ? `${formatValue(r.component_description)}\n\n`
        : "";
    const idNo =
      item.identification_no && String(item.identification_no).trim()
        ? `\n${String(item.identification_no).trim()}`
        : "";
    const size =
      item.size && String(item.size).trim()
        ? `\n${String(item.size).trim()}`
        : "";
    const qtyUnit =
      item.qty_unit && String(item.qty_unit).trim()
        ? ` ${String(item.qty_unit).trim()}`
        : "";
    const observations = formatValue(item.observations);
    const result =
      item.result && String(item.result).trim()
        ? `\n\n${String(item.result).trim()}`
        : "";
    return {
      description: `${prefixComp}${rawDesc}${idNo}${size}`,
      quantity: `${formatValue(item.quantity)}${qtyUnit}`,
      observations: `${observations}${result}`,
    };
  });

  return {
    method,
    title: layout.title,
    columns: layout.columns,
    isDraft: document.approval.approved !== true,
    header: {
      companyName: document.letterhead.name,
      addressLines: document.letterhead.addressLines,
      contactLines: document.letterhead.contactLines ?? [],
      reportNumber: document.reportNumber,
      componentHeaderId: resolveHeaderComponentId(r),
      reportDateFormatted: formatDate(document.reportDate),
      columnSpans: layout.header,
    },
    clientRows: [
      ["CLIENT", formatValue(r.client)],
      ["PROJECT", formatValue(r.project)],
      ["INSPECTION SITE/DATE", `${formatValue(r.inspection_site)} / ${formatDate(r.inspection_date)}`],
    ],
    detailPairs,
    dptDetails,
    technicianSection: {
      label: layout.technicianLabel,
      headers: ["Name", "Qualification", "Cert. No.", "Issue Date", "Valid Upto"],
      columnSpans: layout.technicians,
      rows: techRows,
    },
    itemSection: {
      headers: ["Description", "Qty.", "Observations/Remarks"],
      columnSpans: layout.items,
      rows: itemRows,
    },
    signoff:
      document.approval.approved === true
        ? {
            forLine: `For ${document.letterhead.name}`,
            signatoryName: document.approval.signatoryName,
            signatoryQualification: document.approval.signatoryQualification,
            approvedAt: document.approval.approvedAt,
          }
        : null,
    footerNotes: document.footerNotes ?? [],
  };
}

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "222222" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "222222" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "222222" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "222222" },
};

function makeParagraphs(
  text: string,
  options?: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; sizeHalfPt?: number }
): Paragraph[] {
  const lines = text.split(/\r?\n/);
  return lines.map(
    (line) =>
      new Paragraph({
        alignment: options?.align ?? AlignmentType.LEFT,
        spacing: { before: 20, after: 20 },
        children: [
          new TextRun({
            text: line,
            bold: options?.bold ?? false,
            size: options?.sizeHalfPt ?? 19,
            font: "Calibri",
          }),
        ],
      })
  );
}

function makeCell(
  text: string,
  options?: {
    columnSpan?: number;
    rowSpan?: number;
    bold?: boolean;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    sizeHalfPt?: number;
  }
): TableCell {
  return new TableCell({
    columnSpan: options?.columnSpan,
    rowSpan: options?.rowSpan,
    verticalAlign: VerticalAlign.CENTER,
    borders: CELL_BORDERS,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: makeParagraphs(text, {
      bold: options?.bold,
      align: options?.align,
      sizeHalfPt: options?.sizeHalfPt,
    }),
  });
}

/**
 * Generates a downloadable Word (.docx) binary file in BITA's exact inspection report layout.
 */
export async function generateReportDocxBytes(
  methodInput: ReportMethodInput,
  document: ReportDocument
): Promise<Uint8Array> {
  const spec = buildReportDocxSpec(methodInput, document);
  const layout = REPORT_LAYOUTS[spec.method];
  const totalCols = spec.columns.length;
  const totalWidthTwips = spec.columns.reduce((sum, w) => sum + w, 0);

  const rows: TableRow[] = [];

  // 1. Letterhead row
  const companyLines = [
    spec.header.companyName,
    ...spec.header.addressLines,
    ...spec.header.contactLines,
  ].join("\n");
  const compIdText = spec.header.componentHeaderId ? `\n${spec.header.componentHeaderId}` : "";
  const reportNoText = `REPORT NO.\n${spec.header.reportNumber}${compIdText}\n\nDATE: ${spec.header.reportDateFormatted}`;

  rows.push(
    new TableRow({
      children: [
        new TableCell({
          columnSpan: spec.header.columnSpans[0],
          borders: CELL_BORDERS,
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [
            new Paragraph({
              spacing: { before: 20, after: 20 },
              children: [
                new TextRun({
                  text: spec.header.companyName,
                  bold: true,
                  size: 22,
                  font: "Calibri",
                }),
              ],
            }),
            ...spec.header.addressLines.map(
              (line) =>
                new Paragraph({
                  spacing: { before: 10, after: 10 },
                  children: [new TextRun({ text: line, size: 18, font: "Calibri" })],
                })
            ),
            ...spec.header.contactLines.map(
              (line) =>
                new Paragraph({
                  spacing: { before: 10, after: 10 },
                  children: [new TextRun({ text: line, size: 18, font: "Calibri" })],
                })
            ),
          ],
        }),
        makeCell("BITA", {
          columnSpan: spec.header.columnSpans[1],
          bold: true,
          align: AlignmentType.CENTER,
        }),
        makeCell(reportNoText, {
          columnSpan: spec.header.columnSpans[2],
          bold: true,
        }),
      ],
    })
  );

  // 2. Report title row
  rows.push(
    new TableRow({
      children: [
        makeCell(spec.title, {
          columnSpan: totalCols,
          bold: true,
          align: AlignmentType.CENTER,
          sizeHalfPt: 22,
        }),
      ],
    })
  );

  // 3. Client / Project / Site & Date rows
  for (const [label, val] of spec.clientRows) {
    rows.push(
      new TableRow({
        children: [
          makeCell(label, { columnSpan: layout.client[0], bold: true }),
          makeCell(val, { columnSpan: layout.client[1] }),
        ],
      })
    );
  }

  // 4. Method-specific details (UT / MPT pairs, or DPT chemical & standard rows)
  for (const pair of spec.detailPairs) {
    rows.push(
      new TableRow({
        children: [
          makeCell(pair.leftLabel, { columnSpan: layout.detail[0], bold: true }),
          makeCell(pair.leftValue, { columnSpan: layout.detail[1] }),
          makeCell(pair.rightLabel, { columnSpan: layout.detail[2], bold: true }),
          makeCell(pair.rightValue, { columnSpan: layout.detail[3] }),
        ],
      })
    );
  }

  if (spec.dptDetails) {
    rows.push(
      new TableRow({
        children: [
          makeCell("Items Used", { columnSpan: 1, bold: true }),
          makeCell(spec.dptDetails.itemsUsedLines.join("\n"), { columnSpan: 11 }),
        ],
      }),
      new TableRow({
        children: [
          makeCell("Standard followed", { columnSpan: 1, bold: true }),
          makeCell(spec.dptDetails.standardFollowed, { columnSpan: 6 }),
          makeCell("Dwell/Developing time", { columnSpan: 3, bold: true }),
          makeCell(spec.dptDetails.dwellAndDevelopingTime, { columnSpan: 2 }),
        ],
      })
    );
  }

  // 5. Technician qualification section
  rows.push(
    new TableRow({
      children: [
        makeCell(spec.technicianSection.label, {
          columnSpan: spec.technicianSection.columnSpans[0],
          rowSpan: spec.technicianSection.rows.length + 1,
          bold: true,
        }),
        ...spec.technicianSection.headers.map((headerLabel, idx) =>
          makeCell(headerLabel, {
            columnSpan: spec.technicianSection.columnSpans[idx + 1],
            bold: true,
          })
        ),
      ],
    })
  );

  for (const tech of spec.technicianSection.rows) {
    const cells = [
      tech.name,
      tech.qualification,
      tech.certificateNo,
      tech.issuedOn,
      tech.validUntil,
    ];
    rows.push(
      new TableRow({
        children: cells.map((cellText, idx) =>
          makeCell(cellText, {
            columnSpan: spec.technicianSection.columnSpans[idx + 1],
          })
        ),
      })
    );
  }

  // 6. Inspected items heading & body
  rows.push(
    new TableRow({
      children: spec.itemSection.headers.map((headerLabel, idx) =>
        makeCell(headerLabel, {
          columnSpan: spec.itemSection.columnSpans[idx],
          bold: true,
        })
      ),
    })
  );

  for (const item of spec.itemSection.rows) {
    rows.push(
      new TableRow({
        children: [
          makeCell(item.description, { columnSpan: spec.itemSection.columnSpans[0] }),
          makeCell(item.quantity, {
            columnSpan: spec.itemSection.columnSpans[1],
            align: AlignmentType.CENTER,
          }),
          makeCell(item.observations, { columnSpan: spec.itemSection.columnSpans[2] }),
        ],
      })
    );
  }

  const sectionChildren: (Paragraph | Table)[] = [];

  if (spec.isDraft) {
    sectionChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: "DRAFT — NOT APPROVED FOR ISSUE",
            bold: true,
            size: 20,
            font: "Calibri",
          }),
        ],
      })
    );
  }

  sectionChildren.push(
    new Table({
      width: { size: totalWidthTwips, type: WidthType.DXA },
      columnWidths: [...spec.columns],
      rows,
    })
  );

  if (spec.signoff) {
    sectionChildren.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 240, after: 60 },
        children: [
          new TextRun({
            text: spec.signoff.forLine,
            size: 20,
            font: "Calibri",
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 120, after: 40 },
        children: [
          new TextRun({
            text: spec.signoff.signatoryName,
            bold: true,
            size: 20,
            font: "Calibri",
          }),
        ],
      })
    );
    if (spec.signoff.signatoryQualification) {
      sectionChildren.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 20, after: 40 },
          children: [
            new TextRun({
              text: spec.signoff.signatoryQualification,
              size: 18,
              font: "Calibri",
            }),
          ],
        })
      );
    }
  }

  if (document.attachments && document.attachments.length > 0) {
    sectionChildren.push(
      new Paragraph({
        spacing: { before: 140, after: 60 },
        children: [
          new TextRun({
            text: "ATTACHED PHOTOS & DRAWINGS",
            bold: true,
            size: 20,
            font: "Calibri",
          }),
        ],
      })
    );

    for (let i = 0; i < document.attachments.length; i++) {
      const att = document.attachments[i];
      const captionText = att.caption ? ` — ${att.caption}` : "";
      sectionChildren.push(
        new Paragraph({
          spacing: { before: 30, after: 30 },
          children: [
            new TextRun({
              text: `${i + 1}. [${att.kind.replace("_", " ").toUpperCase()}] ${att.storagePath}${captionText}`,
              size: 18,
              font: "Calibri",
            }),
          ],
        })
      );
    }
  }

  for (const note of spec.footerNotes) {
    sectionChildren.push(
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [new TextRun({ text: note, size: 18, font: "Calibri" })],
      })
    );
  }

  // Prevent unused variable warning on companyLines
  void companyLines;

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: sectionChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
