import type { Enums } from "@/lib/db/types";

export const JOB_STATUS_LABEL: Record<Enums<"job_status">, string> = {
  enquiry_received: "Enquiry received",
  awaiting_approval: "Awaiting approval",
  scheduled: "Scheduled",
  inspection_done: "Inspection done",
  report_in_review: "Report in review",
  report_sent: "Report sent",
  invoiced: "Invoiced",
  closed: "Closed",
};

export const METHOD_LABEL: Record<Enums<"test_method">, string> = {
  UT: "UT",
  MPT: "MPT",
  DPT: "DPT",
  RT: "RT",
  VT: "VT",
  hardness: "Hardness",
  metallography: "Metallography",
  RLA: "RLA",
  certification: "Certification",
  general_inspection: "General inspection",
};

// Shown as Indian rupees (D-017 in-app invoicing).
export function formatINR(n: number | null) {
  if (n === null) return "–";
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
}
