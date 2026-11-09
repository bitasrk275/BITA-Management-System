import type { ReactNode } from "react";
import { reportMethod, type ReadingValue, type ReportMethodInput, type ReportReadings } from "../../lib/reports/fields";
import { REPORT_LAYOUTS } from "./layouts";
import type { ReportDocument } from "./types";

function value(reading: ReadingValue | undefined): string {
  return reading === null || reading === undefined || String(reading).trim() === "" ? "—" : String(reading);
}

function date(reading: ReadingValue | undefined): string {
  if (typeof reading !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(reading)) return value(reading);
  return `${reading.slice(8)}.${reading.slice(5, 7)}.${reading.slice(0, 4)}`;
}

function equipment(readings: ReportReadings) {
  return (
    <>
      {value(readings.equipment)}
      <br />
      S.No. {value(readings.equipment_serial)}
      {readings.equipment_calibration && String(readings.equipment_calibration).trim() ? (
        <>
          <br />
          <span className="text-[10px]">{String(readings.equipment_calibration).trim()}</span>
        </>
      ) : null}
    </>
  );
}

function referenceBlocksCell(readings: ReportReadings) {
  const blocks = value(readings.reference_blocks);
  const calMethod =
    readings.calibration_method && String(readings.calibration_method).trim()
      ? String(readings.calibration_method).trim()
      : null;
  if (!calMethod) return blocks;
  return (
    <>
      {blocks}
      <br />
      {calMethod}
    </>
  );
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

// Native images retain their specified size in print and work with private, short-lived URLs.
function PrintImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

/** A pure paper renderer. The caller must supply approval from a trusted server-side report record,
 * never a form flag or query parameter. This component does not grant report approval or send files.
 */
export function ReportTemplate({ method: input, document }: { method: ReportMethodInput; document: ReportDocument }) {
  const method = reportMethod(input);
  const layout = REPORT_LAYOUTS[method];
  const columns = layout.columns.length;
  const total = layout.columns.reduce((sum: number, width) => sum + width, 0);
  const r = document.readings;
  const technicians = r.technicians?.length ? r.technicians : [{}];
  const items = r.items?.length ? r.items : [{}];
  const pairs: [string, ReactNode, string, ReactNode][] = method === "UT" ? [
    ["Equipment Used", equipment(r), "Reference Blocks", referenceBlocksCell(r)],
    ["Probe Used", value(r.probes), "Screen Range", value(r.screen_range)],
    ["Sensitivity Level", value(r.sensitivity), "Couplant", value(r.couplant)],
    ["Scanning Level", value(r.scanning_level), "Surface condition", value(r.surface_condition)],
    ["Standard Followed", value(r.standard), "Acceptance", value(r.acceptance_criteria)],
  ] : method === "MPT" ? [
    ["Items Used", equipment(r), "Medium", value(r.magnetic_medium)],
    ["Standard followed", value(r.standard), "Method", value(r.magnetisation_method)],
    ["Current Used", value(r.current), "Visible Light Intensity", value(r.visible_light_intensity)],
    ["Black Light", value(r.black_light), "Black Light Intensity", value(r.black_light_intensity)],
    ["Test Block", value(r.test_block), "Lifting Capacity of yoke", value(r.yoke_lifting_capacity)],
  ] : [];

  return <article className={`bita-report bita-report-${method.toLowerCase()}`} aria-label={layout.title} data-method={method}>
    {document.approval.approved !== true && <p className="report-draft">DRAFT — NOT APPROVED FOR ISSUE</p>}
    <table className="report-table">
      <colgroup>{layout.columns.map((width, index) => <col key={index} style={{ width: `${100 * width / total}%` }} />)}</colgroup>
      <thead>
        <tr className="report-letterhead">
          <td colSpan={layout.header[0]} rowSpan={method === "MPT" ? 2 : undefined}>
            <strong className="report-company">{document.letterhead.name}</strong>
            {document.letterhead.addressLines.map((line, index) => <div key={index}>{line}</div>)}
            {document.letterhead.contactLines?.map((line, index) => <div key={index}>{line}</div>)}
          </td>
          <td colSpan={layout.header[1]} rowSpan={method === "MPT" ? 2 : undefined} className="report-logo-cell">
            {document.letterhead.logoUrl && <PrintImage src={document.letterhead.logoUrl} alt="Company logo" className="report-logo" />}
          </td>
          <td colSpan={layout.header[2]} className="report-number">
            REPORT NO.<br />
            <strong>{document.reportNumber}</strong>
            {resolveHeaderComponentId(r) ? (
              <>
                <br />
                <span>{resolveHeaderComponentId(r)}</span>
              </>
            ) : null}
            <br />
            DATE: {date(document.reportDate)}
          </td>
        </tr>
        {method === "MPT" && <tr className="report-mt-header-gap"><td colSpan={layout.header[2]} /></tr>}
        <tr><th colSpan={columns} className="report-title">{layout.title}</th></tr>
      </thead>
      <tbody>
        {[["CLIENT", value(r.client)], ["PROJECT", value(r.project)], ["INSPECTION SITE/DATE", `${value(r.inspection_site)} / ${date(r.inspection_date)}`]].map(([label, reading]) => <tr key={label} className="report-client-row"><th scope="row" colSpan={layout.client[0]}>{label}</th><td colSpan={layout.client[1]}>{reading}</td></tr>)}
        {pairs.map(([left, leftValue, right, rightValue]) => <tr key={left} className="report-detail-row">
          <th scope="row" colSpan={layout.detail[0]}>{left}</th><td colSpan={layout.detail[1]}>{leftValue}</td>
          <th scope="row" colSpan={layout.detail[2]}>{right}</th><td colSpan={layout.detail[3]}>{rightValue}</td>
        </tr>)}
        {method === "DPT" && <>
          <tr className="report-detail-row"><th scope="row">Items Used</th><td colSpan={11}>
            {[ ["Cleaner", r.cleaner, r.cleaner_batch], ["Penetrant", r.penetrant, r.penetrant_batch], ["Developer", r.developer, r.developer_batch] ].map(([label, chemical, batch]) => <div key={label}> {label}: {value(chemical)} &nbsp; Batch No. {value(batch)}</div>)}
          </td></tr>
          <tr className="report-detail-row"><th scope="row">Standard followed</th><td colSpan={6}>{value(r.standard)}</td><th scope="row" colSpan={3}>Dwell/Developing time</th><td colSpan={2}>{value(r.dwell_time)} / {value(r.developing_time)}</td></tr>
        </>}
      </tbody>
      <tbody className="report-technicians">
        <tr><th rowSpan={technicians.length + 1} colSpan={layout.technicians[0]}>{layout.technicianLabel}</th>
          {["Name", "Qualification", "Cert. No.", "Issue Date", "Valid Upto"].map((label, index) => <th scope="col" key={label} colSpan={layout.technicians[index + 1]}>{label}</th>)}
        </tr>
        {technicians.map((technician, index) => <tr key={index}>
          {[value(technician.name), value(technician.qualification), value(technician.certificate_no), date(technician.issued_on), date(technician.valid_until)].map((reading, cell) => <td key={cell} colSpan={layout.technicians[cell + 1]}>{reading}</td>)}
        </tr>)}
      </tbody>
      <tbody><tr className="report-item-heading"><th scope="col" colSpan={layout.items[0]}>Description</th><th scope="col" colSpan={layout.items[1]}>Qty.</th><th scope="col" colSpan={layout.items[2]}>Observations/Remarks</th></tr></tbody>
      <tbody className="report-item-body">
        {items.map((item, index) => <tr key={index} className="report-item-row">
          <td colSpan={layout.items[0]}>
            {method === "DPT" && index === 0 && r.component_description && !String(item.description ?? "").startsWith(String(r.component_description)) && <>{value(r.component_description)}<br /><br /></>}
            <div>{value(item.description)}</div>
            {item.identification_no && String(item.identification_no).trim() ? (
              <div style={{ marginTop: "6px", whiteSpace: "pre-line" }}>
                {String(item.identification_no).trim()}
              </div>
            ) : null}
            {item.size && String(item.size).trim() ? (
              <div style={{ marginTop: "4px" }}>{String(item.size).trim()}</div>
            ) : null}
          </td>
          <td colSpan={layout.items[1]} className="report-quantity">
            {value(item.quantity)}
            {item.qty_unit && String(item.qty_unit).trim() ? ` ${String(item.qty_unit).trim()}` : ""}
          </td>
          <td colSpan={layout.items[2]}>
            <div style={{ whiteSpace: "pre-line" }}>{value(item.observations)}</div>
            {item.result && String(item.result).trim() ? (
              <div style={{ marginTop: "8px", fontWeight: 600 }}>{String(item.result).trim()}</div>
            ) : null}
          </td>
        </tr>)}
      </tbody>
    </table>
    {document.approval.approved === true && <section className="report-signoff" aria-label="Approved signature and seal">
      <p>For {document.letterhead.name}</p>
      <div className="report-signature-images">
        {document.approval.signatureUrl && <PrintImage src={document.approval.signatureUrl} alt="Approved signatory signature" className="report-signature" />}
        {document.approval.sealUrl && <PrintImage src={document.approval.sealUrl} alt="Approved company seal" className="report-seal" />}
      </div>
      <strong>{document.approval.signatoryName}</strong>
      {document.approval.signatoryQualification && <p>{document.approval.signatoryQualification}</p>}
    </section>}
    {document.footerNotes?.length ? <footer className="report-footer">{document.footerNotes.map((note, index) => <p key={index}>{note}</p>)}</footer> : null}
  </article>;
}

export function UTReport({ document }: { document: ReportDocument }) { return <ReportTemplate method="UT" document={document} />; }
export function MTReport({ document }: { document: ReportDocument }) { return <ReportTemplate method="MPT" document={document} />; }
export function DPTReport({ document }: { document: ReportDocument }) { return <ReportTemplate method="DPT" document={document} />; }
