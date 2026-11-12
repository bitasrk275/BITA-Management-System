"use client";

import { useState } from "react";
import { Badge, Button, Checkbox, ErrorNote, Field, Input, Select, Textarea } from "@/components/ui";
import type { Enums } from "@/lib/db/types";
import { METHOD_LABEL } from "../../labels";
import {
  type EquipmentRecord,
  evaluateTechnicianForJob,
  formatEquipmentLabel,
  isCalibrationOverdue,
  type QualificationRecord,
} from "./warnings";

export type TechnicianOption = {
  id: string;
  full_name: string;
  mobile: string | null;
  position: string | null;
};

export function AssignForm({
  action,
  jobMethods,
  technicians,
  qualifications,
  equipmentList,
  defaultWorkDate,
  referenceDateIST,
}: {
  action: (fd: FormData) => void;
  jobMethods: Enums<"test_method">[];
  technicians: TechnicianOption[];
  qualifications: QualificationRecord[];
  equipmentList: EquipmentRecord[];
  defaultWorkDate: string;
  referenceDateIST: string;
}) {
  const [selectedPersonId, setSelectedPersonId] = useState<string>(technicians[0]?.id ?? "");
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);

  const personQualifications = qualifications.filter((q) => q.person_id === selectedPersonId);
  const evaluation = evaluateTechnicianForJob(jobMethods, personQualifications);

  const overdueSelectedEquipment = equipmentList.filter(
    (eq) => selectedEquipmentIds.includes(eq.id) && isCalibrationOverdue(eq.calibration_due, referenceDateIST),
  );

  function toggleEquipment(id: string, checked: boolean) {
    setSelectedEquipmentIds((prev) => (checked ? [...prev, id] : prev.filter((item) => item !== id)));
  }

  return (
    <form action={action} className="space-y-4">
      <Field label="Technician *">
        <Select
          name="person_id"
          required
          value={selectedPersonId}
          onChange={(e) => setSelectedPersonId(e.target.value)}
        >
          {technicians.length === 0 && <option value="">No active technicians found</option>}
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}
              {t.position ? ` (${t.position})` : ""}
              {t.mobile ? ` · ${t.mobile}` : ""}
            </option>
          ))}
        </Select>
      </Field>

      {selectedPersonId && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Qualification check for job test methods</p>
          {jobMethods.length === 0 ? (
            <p className="text-xs">No test methods set on this job yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {evaluation.checks.map((c) => (
                <Badge key={c.method}>{c.summary}</Badge>
              ))}
            </div>
          )}

          {evaluation.warnings.map((w) => (
            <ErrorNote key={w} message={`Warning: ${w}`} />
          ))}

          {personQualifications.length > 0 && (
            <p className="text-xs">
              All certificates on file:{" "}
              {personQualifications
                .map(
                  (q) =>
                    `${METHOD_LABEL[q.method]} ${q.level}${
                      q.is_expired ? " (Expired)" : q.valid_until ? ` (valid until ${q.valid_until})` : ""
                    }`,
                )
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      <Field label="Work date *">
        <Input type="date" name="work_date" required defaultValue={defaultWorkDate} />
      </Field>

      <div>
        <span className="text-sm font-medium">Equipment</span>
        {equipmentList.length === 0 ? (
          <p className="mt-1 text-xs">No active equipment in register.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {equipmentList.map((eq) => {
              const overdue = isCalibrationOverdue(eq.calibration_due, referenceDateIST);
              const dueText = eq.calibration_due
                ? overdue
                  ? `Calibration overdue (due ${eq.calibration_due})`
                  : `Calibrated until ${eq.calibration_due}`
                : "No calibration due date";
              return (
                <Checkbox
                  key={eq.id}
                  name="equipment_ids"
                  value={eq.id}
                  checked={selectedEquipmentIds.includes(eq.id)}
                  onChange={(e) => toggleEquipment(eq.id, e.target.checked)}
                  label={`${formatEquipmentLabel(eq)} — ${dueText}`}
                />
              );
            })}
          </div>
        )}
        {overdueSelectedEquipment.map((eq) => (
          <div key={eq.id} className="mt-2">
            <ErrorNote
              message={`Equipment warning: ${formatEquipmentLabel(eq)} calibration is overdue (due ${eq.calibration_due}).`}
            />
          </div>
        ))}
      </div>

      <Field label="Assignment notes" hint="Site instructions, reporting time or special safety notes.">
        <Textarea name="notes" />
      </Field>

      <Button type="submit" disabled={technicians.length === 0}>
        Assign technician
      </Button>
    </form>
  );
}
