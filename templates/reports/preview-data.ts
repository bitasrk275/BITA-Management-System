import type { ReportMethod } from "../../lib/reports/fields";
import type { ReportDocument } from "./types";

/** Invented data only. No original report values, logos, signatures, seals or customer details. */
export function previewDocument(method: ReportMethod): ReportDocument {
  return {
    reportNumber: `SAMPLE/${method}/0001`, reportDate: "2026-11-06",
    letterhead: { name: "BANGALORE INSPECTION & TESTING AGENCY", addressLines: ["Bengaluru, Karnataka"] },
    approval: { approved: false },
    readings: {
      client: "Sample Customer", project: "Sample Project", inspection_site: "Sample site", inspection_date: "2026-11-06",
      equipment: "Sample instrument", equipment_serial: "SAMPLE-001", probes: "Sample probe",
      reference_blocks: "Sample reference block", screen_range: "0–100 mm", sensitivity: "Sample sensitivity",
      scanning_level: "Sample scanning level", couplant: "Sample couplant", surface_condition: "Sample surface condition",
      standard: "Sample standard", acceptance_criteria: "Sample criteria",
      magnetic_medium: "Sample magnetic medium", magnetisation_method: "Sample magnetisation method", current: "Sample current",
      visible_light_intensity: "Sample lux", black_light: "Sample light device", black_light_intensity: "Sample intensity",
      test_block: "Sample block", yoke_lifting_capacity: "Sample capacity",
      component_description: "Sample component", cleaner: "Sample cleaner", cleaner_batch: "SAMPLE-C-001",
      penetrant: "Sample penetrant", penetrant_batch: "SAMPLE-P-001", developer: "Sample developer", developer_batch: "SAMPLE-D-001",
      dwell_time: "10 minutes", developing_time: "7 minutes",
      technicians: [{ name: "Sample Inspector", qualification: `Level II ${method}`, certificate_no: "SAMPLE-CERT-001", issued_on: "2026-01-01", valid_until: "2027-01-01" }],
      items: [{ description: "Sample component\nDrawing: SAMPLE-001\nJob: SAMPLE-001", quantity: 1, observations: "Sample values — layout preview only." }],
    },
    footerNotes: ["SAMPLE — FORMAT PREVIEW ONLY — NOT AN INSPECTION REPORT"],
  };
}
