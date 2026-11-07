import Link from "next/link";
import { Badge, Button, ButtonLink, Card, ErrorNote, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { calibrationStatus, displayDate, isRegister, KINDS, REGISTERS, TITLES } from "./fields";
import { StatusBadge } from "./status-badge";

export const metadata = { title: "Registers – BITA" };

export default async function RegistersPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; error?: string }>;
}) {
  const { tab, q = "", status = "", error: formError } = await searchParams;
  const register = tab && isRegister(tab) ? tab : "qualifications";
  const { supabase, person } = await requireStaff();
  const [peopleResult, qualificationsResult, equipmentResult] = await Promise.all([
    supabase.from("people").select("*").order("full_name"),
    supabase.from("qualification_status").select("*").order("valid_until", { nullsFirst: false }),
    supabase.from("equipment").select("*").order("calibration_due", { nullsFirst: false }),
  ]);
  const error = peopleResult.error ?? qualificationsResult.error ?? equipmentResult.error;
  const people = peopleResult.data ?? [];
  const qualifications = qualificationsResult.data ?? [];
  const equipment = equipmentResult.data ?? [];
  const names = new Map(people.map((p) => [p.id, p.full_name]));
  const term = q.trim().toLocaleLowerCase();
  const matches = (...values: (string | null | undefined)[]) => values.filter(Boolean).join(" ").toLocaleLowerCase().includes(term);
  const counts = { people: people.length, qualifications: qualifications.length, equipment: equipment.length };
  const canEdit = person?.roles.includes("management") ?? false;

  return <>
    <PageHeader title="Registers" action={canEdit ? <ButtonLink href={`/registers/${register}/new`}>Add {register === "people" ? "person" : register === "qualifications" ? "qualification" : "equipment"}</ButtonLink> : undefined} />
    <p className="mb-4 text-sm text-ink-2">People, qualifications and equipment. {canEdit ? "Management can add and update records." : "Only management can change these records."}</p>
    <ErrorNote message={formError ?? error?.message} />
    <nav aria-label="Registers" className="mb-4 flex flex-wrap gap-2">
      {REGISTERS.map((r) => <Link key={r} href={`/registers?tab=${r}`} aria-current={register === r ? "page" : undefined}
        className={`rounded-lg border px-3 py-1.5 text-[13.5px] font-medium ${register === r ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>
        {TITLES[r]} ({counts[r]})
      </Link>)}
    </nav>
    {!error && <p className="mb-4 text-sm text-ink-2">
      {qualifications.filter((item) => item.is_expired).length} expired qualifications · {equipment.filter((item) => item.active && calibrationStatus(item.calibration_due) === "Overdue").length} active equipment overdue · {equipment.filter((item) => item.active && calibrationStatus(item.calibration_due) === "Due within 30 days").length} active equipment due within 30 days
    </p>}
    {register === "equipment" && (
      <Card className="mb-4 border-neutral-300 bg-neutral-50 p-4 text-xs text-neutral-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong>Equipment register v2 is now live!</strong> Manage equipment categories, calibration certificates, site locations, and delivery challans.
        </div>
        <ButtonLink href="/equipment" size="sm">
          Open Equipment register →
        </ButtonLink>
      </Card>
    )}
    <form className="mb-4 grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
      <input type="hidden" name="tab" value={register} />
      <Field label="Search register"><Input name="q" defaultValue={q} placeholder={register === "qualifications" ? "Person, method, level or certificate" : register === "equipment" ? "Kind, make, model or serial number" : "Name, initials, mobile or role"} /></Field>
      <Field label="Status"><Select name="status" defaultValue={status}>
        <option value="">All records</option>
        {register === "qualifications" ? <><option value="expired">Expired</option><option value="in_date">In date</option><option value="unknown">Expiry not recorded</option></>
          : <><option value="active">Active</option><option value="inactive">Inactive</option>{register === "equipment" && <><option value="overdue">Overdue</option><option value="due">Due within 30 days</option><option value="unknown">Due date not recorded</option></>}</>}
      </Select></Field>
      <Button type="submit">Search</Button>
    </form>
    {!error && <ul className="space-y-3">
      {register === "people" && people.filter((p) => matches(p.full_name, p.initials, p.position, p.mobile, ...p.roles) && (status === "active" ? p.active : status === "inactive" ? !p.active : true)).map((p) => <li key={p.id}>
        <Card><Link href={`/registers/people/${p.id}`} className="block break-words">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold underline decoration-line underline-offset-4">{p.full_name}</span>{p.initials && <Badge>{p.initials}</Badge>}{!p.active && <Badge>Inactive</Badge>}</div>
          <p className="mt-2 text-sm text-ink-2">{[p.position, p.mobile, p.email].filter(Boolean).join(" · ") || "Contact details not recorded"}</p>
          <p className="mt-1 text-sm">Roles: {p.roles.join(", ") || "None"}</p>
        </Link></Card>
      </li>)}
      {register === "qualifications" && qualifications.filter((item) => matches(names.get(item.person_id ?? ""), item.method, item.level, item.scheme, item.certifying_body, item.certificate_no) && (status === "expired" ? item.is_expired : status === "in_date" ? item.valid_until && !item.is_expired : status === "unknown" ? !item.valid_until : true)).map((item) => item.id && <li key={item.id}>
        <Card><Link href={`/registers/qualifications/${item.id}`} className="block break-words">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold underline decoration-line underline-offset-4">{names.get(item.person_id ?? "") ?? "Person unavailable"} · {item.method} · {item.level}</span><StatusBadge label={item.is_expired ? "Expired" : item.valid_until ? "In date" : "Expiry not recorded"} /></div>
          <p className="mt-2 text-sm text-ink-2">{[item.scheme, item.certifying_body, item.certificate_no].filter(Boolean).join(" · ") || "Certificate details not recorded"}</p>
          <p className="mt-1 text-sm">Issued: {displayDate(item.issued_on)} · Valid until: {displayDate(item.valid_until)}</p>
          <p className="mt-1 text-xs text-ink-3">{item.certificate_path ? "Certificate copy available" : "No certificate copy"}</p>
        </Link></Card>
      </li>)}
      {register === "equipment" && equipment.filter((item) => matches(item.kind ? KINDS[item.kind] : "Equipment", item.make, item.model, item.serial_no) && (status === "active" ? item.active : status === "inactive" ? !item.active : status === "overdue" ? calibrationStatus(item.calibration_due) === "Overdue" : status === "due" ? calibrationStatus(item.calibration_due) === "Due within 30 days" : status === "unknown" ? !item.calibration_due : true)).map((item) => <li key={item.id}>
        <Card><Link href={`/equipment/${item.id}`} className="block break-words">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold underline decoration-line underline-offset-4">{(item.kind && KINDS[item.kind]) || "Equipment"} · {[item.make, item.model].filter(Boolean).join(" ") || "Make / model not recorded"}</span><StatusBadge label={calibrationStatus(item.calibration_due)} />{!item.active && <Badge>Inactive</Badge>}</div>
          <p className="mt-2 text-sm text-ink-2">Serial: {item.serial_no || "Not recorded"}</p>
          <p className="mt-1 text-sm">Calibrated: {displayDate(item.calibrated_on)} · Due: {displayDate(item.calibration_due)}</p>
          <p className="mt-1 text-xs text-ink-3">{item.certificate_path ? "Certificate copy available" : "No certificate copy"}</p>
        </Link></Card>
      </li>)}
      <li className="hidden first:block rounded-lg border border-line bg-white p-6 text-sm text-ink-3">No matching records. {canEdit ? "Add a record or change the search." : "Ask management to add records, or change the search."}</li>
    </ul>}
  </>;
}

