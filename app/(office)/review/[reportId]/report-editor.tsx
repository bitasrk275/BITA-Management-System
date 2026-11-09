"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  SecondaryButton,
  SectionTitle,
  Select,
  Status,
  Textarea,
} from "@/components/ui";
import {
  fieldsForMethod,
  REPEATING_GROUPS,
  type FieldDefinition,
  type ItemReadings,
  type ReportMethod,
  type ReportReadings,
  type TechnicianReadings,
} from "@/lib/reports/fields";

type ExtendedFieldDefinition = FieldDefinition & {
  options?: readonly string[];
  readOnly?: boolean;
  fixed?: boolean;
};

function ScalarFieldControl({
  definition,
  initialValue,
  disabled,
}: {
  definition: ExtendedFieldDefinition;
  initialValue: string;
  disabled: boolean;
}) {
  const options = definition.options;
  const isFixed = Boolean(definition.readOnly || definition.fixed);
  const initialInOptions =
    options && initialValue !== "" ? options.includes(initialValue) : true;

  const [selectedOption, setSelectedOption] = useState<string>(() => {
    if (!options || options.length === 0) return initialValue;
    if (!initialValue) return "";
    return initialInOptions ? initialValue : "__OTHER__";
  });
  const [otherValue, setOtherValue] = useState<string>(() =>
    options && initialValue && !initialInOptions ? initialValue : ""
  );

  const labelText = `${definition.label}${definition.required ? " *" : ""}`;

  if (options && options.length > 0) {
    return (
      <Field label={labelText} hint={isFixed ? "Fixed constant value" : "Choose a value or Others"}>
        <div className="space-y-2">
          <Select
            name={`reading_${definition.key}`}
            value={selectedOption}
            onChange={(e) => setSelectedOption(e.target.value)}
            disabled={disabled || isFixed}
          >
            <option value="">Select {definition.label.toLowerCase()}…</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
            <option value="__OTHER__">Others (type custom value)</option>
          </Select>
          {selectedOption === "__OTHER__" && (
            <Input
              name={`reading_${definition.key}__other`}
              value={otherValue}
              onChange={(e) => setOtherValue(e.target.value)}
              placeholder={`Enter custom ${definition.label.toLowerCase()}…`}
              disabled={disabled || isFixed}
            />
          )}
        </div>
      </Field>
    );
  }

  if (definition.input === "textarea") {
    return (
      <Field label={labelText} hint={isFixed ? "Fixed constant value" : undefined}>
        <Textarea
          name={`reading_${definition.key}`}
          defaultValue={initialValue}
          readOnly={isFixed}
          disabled={disabled}
        />
      </Field>
    );
  }

  return (
    <Field label={labelText} hint={isFixed ? "Fixed constant value" : undefined}>
      <Input
        name={`reading_${definition.key}`}
        type={definition.input === "number" ? "number" : definition.input === "date" ? "date" : "text"}
        step={definition.input === "number" ? "any" : undefined}
        defaultValue={initialValue}
        readOnly={isFixed}
        disabled={disabled}
      />
    </Field>
  );
}

export function ReportEditor({
  method,
  reportDate,
  readings,
  isApproved,
  defaultOpen = false,
  action,
}: {
  method: ReportMethod;
  reportDate: string;
  readings: ReportReadings;
  isApproved: boolean;
  defaultOpen?: boolean;
  action: (fd: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const scalarDefinitions = fieldsForMethod(method) as readonly ExtendedFieldDefinition[];
  const techGroup = REPEATING_GROUPS[0];
  const itemGroup = REPEATING_GROUPS[1];

  const [techRows, setTechRows] = useState<TechnicianReadings[]>(() => {
    const existing = readings.technicians;
    return existing && existing.length > 0 ? [...existing] : [{}];
  });

  const [itemRows, setItemRows] = useState<ItemReadings[]>(() => {
    const existing = readings.items;
    return existing && existing.length > 0 ? [...existing] : [{}];
  });

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionTitle>Edit report readings, observations &amp; items (T33)</SectionTitle>
          <p className="text-[13px] text-ink-2">
            Every saved change updates <span className="font-mono text-xs">reports.content</span> and is recorded in the
            correction history log automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isApproved && <Badge>Frozen (approved)</Badge>}
          <SecondaryButton type="button" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide editor" : "Edit report"}
          </SecondaryButton>
        </div>
      </div>

      {isApproved && (
        <Status tone="wait">
          This report is approved and frozen in the database. To edit readings or observations, use{" "}
          <strong>Return to technician</strong> above first.
        </Status>
      )}

      {open && (
        <form action={action} className="space-y-6 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Report date *">
              <Input
                name="report_date"
                type="date"
                required
                defaultValue={reportDate}
                disabled={isApproved}
              />
            </Field>
            {scalarDefinitions.map((def) => {
              const rawVal = readings[def.key as keyof ReportReadings];
              const strVal =
                rawVal === null || rawVal === undefined ? "" : String(rawVal);
              return (
                <ScalarFieldControl
                  key={def.key}
                  definition={def}
                  initialValue={strVal}
                  disabled={isApproved}
                />
              );
            })}
          </div>

          {/* Technician qualification rows */}
          <div className="space-y-3 border-t border-line-2 pt-4">
            <div className="flex items-center justify-between">
              <SectionTitle>{techGroup.label}</SectionTitle>
              {!isApproved && (
                <SecondaryButton
                  type="button"
                  onClick={() => setTechRows((prev) => [...prev, {}])}
                >
                  + Add technician row
                </SecondaryButton>
              )}
            </div>
            <input type="hidden" name="technicians_count" value={techRows.length} />

            {techRows.map((row, idx) => (
              <div
                key={idx}
                className="space-y-3 rounded-md border border-line-2 bg-surface-2 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-2">
                    Technician #{idx + 1}
                  </span>
                  {!isApproved && techRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setTechRows((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="text-xs text-ink-3 underline hover:text-ink"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {techGroup.fields.map((f) => {
                    const val = row[f.key];
                    return (
                      <Field
                        key={f.key}
                        label={`${f.label}${f.required ? " *" : ""}`}
                      >
                        <Input
                          name={`technicians.${idx}.${f.key}`}
                          type={f.input === "date" ? "date" : "text"}
                          defaultValue={val === null || val === undefined ? "" : String(val)}
                          disabled={isApproved}
                        />
                      </Field>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Inspected items & observations rows */}
          <div className="space-y-3 border-t border-line-2 pt-4">
            <div className="flex items-center justify-between">
              <SectionTitle>{itemGroup.label}</SectionTitle>
              {!isApproved && (
                <SecondaryButton
                  type="button"
                  onClick={() => setItemRows((prev) => [...prev, {}])}
                >
                  + Add item row
                </SecondaryButton>
              )}
            </div>
            <input type="hidden" name="items_count" value={itemRows.length} />

            {itemRows.map((row, idx) => (
              <div
                key={idx}
                className="space-y-3 rounded-md border border-line-2 bg-surface-2 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-2">
                    Inspected item #{idx + 1}
                  </span>
                  {!isApproved && itemRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setItemRows((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="text-xs text-ink-3 underline hover:text-ink"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem]">
                  <Field label="Component description (#22) *">
                    <Input
                      name={`items.${idx}.description`}
                      list={`item_desc_list_${idx}`}
                      defaultValue={
                        row.description === null || row.description === undefined
                          ? ""
                          : String(row.description)
                      }
                      placeholder="e.g. Proof Machined Shaft Forging"
                      disabled={isApproved}
                    />
                    <datalist id={`item_desc_list_${idx}`}>
                      <option value="Proof Machined Shaft Forging" />
                      <option value="Shaft forging" />
                      <option value="Rotor forging" />
                      <option value="Casting" />
                      <option value="Weld joint" />
                      <option value="Plate" />
                    </datalist>
                  </Field>
                  <Field label="Qty. (#25) *">
                    <Input
                      name={`items.${idx}.quantity`}
                      type="number"
                      step="any"
                      defaultValue={
                        row.quantity === null || row.quantity === undefined
                          ? ""
                          : String(row.quantity)
                      }
                      disabled={isApproved}
                    />
                  </Field>
                  <Field label="Unit">
                    <Select
                      name={`items.${idx}.qty_unit`}
                      defaultValue={
                        row.qty_unit === null || row.qty_unit === undefined
                          ? "No."
                          : String(row.qty_unit)
                      }
                      disabled={isApproved}
                    >
                      <option value="No.">No.</option>
                      <option value="Nos.">Nos.</option>
                      <option value="Sets">Sets</option>
                    </Select>
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Identification numbers (#23 — SR No. / H No. / Mat Code)">
                    <Textarea
                      name={`items.${idx}.identification_no`}
                      defaultValue={
                        row.identification_no === null || row.identification_no === undefined
                          ? ""
                          : String(row.identification_no)
                      }
                      placeholder={"SR No: 258\nH No: P 15747\nMat Code: 18756140"}
                      disabled={isApproved}
                    />
                  </Field>
                  <div className="space-y-3">
                    <Field label="Size (#24 — Ø / thickness × length mm)">
                      <Input
                        name={`items.${idx}.size`}
                        defaultValue={
                          row.size === null || row.size === undefined
                            ? ""
                            : String(row.size)
                        }
                        placeholder="e.g. Ø 265 X 3500 Lg."
                        disabled={isApproved}
                      />
                    </Field>
                    <Field label="Result (#27)">
                      <Select
                        name={`items.${idx}.result`}
                        defaultValue={
                          row.result === null || row.result === undefined
                            ? "Accepted"
                            : String(row.result)
                        }
                        disabled={isApproved}
                      >
                        <option value="">—</option>
                        <option value="Accepted">Accepted</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Accepted with remarks">Accepted with remarks</option>
                      </Select>
                    </Field>
                  </div>
                </div>
                <Field label="Observations / remarks (#26) *">
                  <Textarea
                    name={`items.${idx}.observations`}
                    defaultValue={
                      row.observations === null || row.observations === undefined
                        ? ""
                        : String(row.observations)
                    }
                    placeholder="e.g. Forging scanned with normal probe all round and no significant indications observed."
                    disabled={isApproved}
                  />
                </Field>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-line pt-3">
            <Button type="submit" disabled={isApproved}>
              Save report changes
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
