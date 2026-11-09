export type TestMethod = "UT" | "MPT" | "DPT" | "RT" | "VT";

export type EquipmentItem = {
  id: string;
  kind: string;
  model: string | null;
  serialNo: string | null;
  calibrationDue: string | null;
};

export type InspectionStatus = {
  id: string;
  method: TestMethod;
  status: "draft" | "submitted" | "approved";
  isApproved?: boolean;
  missingFields: string[];
  observations: string | null;
  readings: Record<string, unknown>;
  submittedAt: string | null;
};

export type JobAssignment = {
  id: string;
  jobId: string;
  jobNo: string;
  customerName: string;
  site: string | null;
  scope: string | null;
  testMethods: TestMethod[];
  workDate: string;
  endDate?: string | null;
  notes: string | null;
  acknowledgedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  equipment: EquipmentItem[];
  inspection: InspectionStatus | null;
};

export type FieldDefinition = {
  key: string;
  label: string;
  required: boolean;
  input: "text" | "date" | "number" | "textarea";
};

export type RepeatingGroupDefinition = {
  key: string;
  label: string;
  minimumRows: number;
  fields: readonly FieldDefinition[];
};

export type ReportTemplate = {
  method: string;
  fields: FieldDefinition[];
  repeatingGroups: RepeatingGroupDefinition[];
};

export type ProblemKind =
  | "delay"
  | "leave"
  | "equipment_problem"
  | "site_issue"
  | "other";
