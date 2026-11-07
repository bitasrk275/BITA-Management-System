import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import type { Tables } from "@/lib/db/types";
import { KINDS, METHODS, ROLES, type Register } from "./fields";

type Person = Tables<"people">;
type Qualification = Tables<"qualifications">;
type Equipment = Tables<"equipment">;
export type RegisterRecord = Person | Qualification | Equipment;

export function RegisterForm({ register, record, people, action, canEdit }: {
  register: Register; record?: RegisterRecord; people: Pick<Person, "id" | "full_name" | "active">[];
  action: (fd: FormData) => Promise<void>; canEdit: boolean;
}) {
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={!canEdit} className="min-w-0 space-y-4">
        {register === "people" ? <PersonFields person={record as Person | undefined} />
          : register === "qualifications" ? <QualificationFields qualification={record as Qualification | undefined} people={people} />
            : <EquipmentFields equipment={record as Equipment | undefined} />}
        {register !== "people" && !record && canEdit && <p className="text-sm text-ink-2">Save the record, then attach its certificate copy.</p>}
        {canEdit && <Button type="submit">{record ? "Save changes" : "Add record"}</Button>}
      </fieldset>
    </form>
  );
}

function PersonFields({ person }: { person?: Person }) {
  return <>
    <Field label="Full name"><Input name="full_name" required maxLength={200} defaultValue={person?.full_name} /></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Initials"><Input name="initials" maxLength={20} defaultValue={person?.initials ?? ""} /></Field>
      <Field label="Position"><Input name="position" defaultValue={person?.position ?? ""} /></Field>
      <Field label="Mobile"><Input name="mobile" type="tel" defaultValue={person?.mobile ?? ""} /></Field>
      <Field label="Email"><Input name="email" type="email" defaultValue={person?.email ?? ""} /></Field>
    </div>
    <fieldset className="space-y-2 rounded-md border border-line p-3">
      <legend className="px-1 text-sm font-medium">Roles</legend>
      {ROLES.map((role) => <Checkbox key={role} name="roles" value={role} label={role.charAt(0).toUpperCase() + role.slice(1)} defaultChecked={person?.roles.includes(role)} />)}
      <p className="text-xs text-ink-3">Roles control access for linked logins. Adding a person does not create or link a login.</p>
    </fieldset>
    <Checkbox name="active" label="Active person" defaultChecked={person?.active ?? true} />
  </>;
}

function QualificationFields({ qualification, people }: { qualification?: Qualification; people: Pick<Person, "id" | "full_name" | "active">[] }) {
  return <>
    <Field label="Person" hint={qualification ? "A qualification stays with its original person." : undefined}>
      {qualification && <input type="hidden" name="person_id" value={qualification.person_id} />}
      <Select name={qualification ? undefined : "person_id"} required disabled={Boolean(qualification)} defaultValue={qualification?.person_id ?? ""}>
        <option value="" disabled>Choose a person</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{!p.active ? " (inactive)" : ""}</option>)}
      </Select>
    </Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Test method"><Select name="method" required defaultValue={qualification?.method ?? ""}>
        <option value="" disabled>Choose a method</option>
        {METHODS.map((m) => <option key={m} value={m}>{m === "MPT" ? "MPT / MT" : m.replaceAll("_", " ")}</option>)}
      </Select></Field>
      <Field label="Level"><Input name="level" required defaultValue={qualification?.level} placeholder="e.g. Level II" /></Field>
      <Field label="Scheme"><Input name="scheme" defaultValue={qualification?.scheme ?? ""} /></Field>
      <Field label="Certifying body"><Input name="certifying_body" defaultValue={qualification?.certifying_body ?? ""} /></Field>
      <Field label="Certificate number"><Input name="certificate_no" defaultValue={qualification?.certificate_no ?? ""} /></Field>
      <Field label="Issued on"><Input name="issued_on" type="date" defaultValue={qualification?.issued_on ?? ""} /></Field>
      <Field label="Valid until"><Input name="valid_until" type="date" defaultValue={qualification?.valid_until ?? ""} /></Field>
    </div>
  </>;
}

function EquipmentFields({ equipment }: { equipment?: Equipment }) {
  return <>
    <Field label="Equipment kind"><Select name="kind" required defaultValue={equipment?.kind ?? ""}>
      <option value="" disabled>Choose a kind</option>
      {Object.entries(KINDS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
    </Select></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Make"><Input name="make" defaultValue={equipment?.make ?? ""} /></Field>
      <Field label="Model"><Input name="model" defaultValue={equipment?.model ?? ""} /></Field>
      <Field label="Serial number"><Input name="serial_no" defaultValue={equipment?.serial_no ?? ""} /></Field>
      <Field label="Calibrated on"><Input name="calibrated_on" type="date" defaultValue={equipment?.calibrated_on ?? ""} /></Field>
      <Field label="Calibration due"><Input name="calibration_due" type="date" defaultValue={equipment?.calibration_due ?? ""} /></Field>
    </div>
    <Field label="Notes"><Textarea name="notes" defaultValue={equipment?.notes ?? ""} /></Field>
    <Checkbox name="active" label="Active equipment" defaultChecked={equipment?.active ?? true} />
  </>;
}
