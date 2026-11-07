import type { ReportReadings } from "../../lib/reports/fields";

export type ReportLetterhead = {
  name: string;
  addressLines: readonly string[];
  contactLines?: readonly string[];
  logoUrl?: string;
};

export type ReportApproval = { approved: false } | {
  approved: true;
  approvedAt: string;
  signatoryName: string;
  signatoryQualification?: string;
  signatureUrl?: string;
  sealUrl?: string;
};

export type ReportDocument = {
  reportNumber: string;
  reportDate: string;
  letterhead: ReportLetterhead;
  readings: ReportReadings;
  approval: ReportApproval;
  footerNotes?: readonly string[];
  attachments?: ReadonlyArray<{
    kind: string;
    caption?: string | null;
    storagePath: string;
  }>;
};
