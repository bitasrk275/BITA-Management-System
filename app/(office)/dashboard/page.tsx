import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Avatar,
  ButtonLink,
  EmptyRow,
  List,
  ListRow,
  Mono,
  PageHeader,
  SectionTitle,
  Stats,
  Status,
  type Tone,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { daysBetween, greeting, longDateIST, shortDate, todayIST } from "@/lib/dates";
import { listInvoicePendingReports } from "@/lib/modules/invoices/service";
import { homeFor } from "@/lib/roles";
import type { Enums } from "@/lib/db/types";
import {
  classifyEquipmentAlert,
  classifyQualificationAlert,
  isJobReadyToClose,
} from "../jobs/closure";
import { formatINR } from "../jobs/labels";

export const metadata = { title: "Home – BITA" };

// Management home (R39 plus "everything controllable from here").
export default async function ManagementHome() {
  const { supabase, person } = await requireStaff();
  if (!person?.roles.includes("management")) redirect(homeFor(person?.roles));

  const today = todayIST();
  const weekAhead = todayIST(7);
  const monthAhead = todayIST(30);

  const [
    jobs,
    reviewReports,
    pendingReports,
    invoices,
    draftQuotes,
    newEnquiries,
    onSite,
    leave,
    qualificationsAlert,
    equipmentAlert,
    recentEdits,
    invoicePendingReports,
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, job_no, status, scope, customers(name), assignments(work_date, people(full_name)), reports(status, sent_at), invoices(kind, balance)"
      )
      .neq("status", "closed")
      .order("created_at", { ascending: false }),
    supabase
      .from("reports")
      .select("id, report_no, method, jobs(id, customers(name)), inspections(missing_fields)")
      .eq("status", "in_review")
      .order("created_at"),
    supabase.from("reports").select("id", { count: "exact", head: true }).in("status", ["draft", "in_review"]),
    supabase
      .from("invoices")
      .select("id, number, balance, due_date, job_id, jobs(customers(name))")
      .eq("kind", "tax_invoice")
      .in("status", ["issued", "partly_paid"])
      .gt("balance", 0),
    supabase.from("quotations").select("id, ref_no, subject, customers(name)").eq("status", "draft").order("created_at"),
    supabase.from("enquiries").select("id, subject, source, customers(name)").eq("status", "new").order("received_at", { ascending: false }),
    supabase.from("assignments").select("id, people(full_name), jobs(job_no, site, customers(name))").eq("work_date", today),
    supabase.from("technician_messages").select("id, people(full_name)").eq("kind", "leave").gte("received_at", today),
    supabase
      .from("qualification_status")
      .select("id, method, valid_until, is_expired, people(full_name)")
      .lte("valid_until", monthAhead)
      .order("valid_until", { ascending: true }),
    supabase
      .from("equipment")
      .select("id, make, model, serial_no, calibration_due, active")
      .eq("active", true)
      .is("deleted_at", null)
      .lte("calibration_due", monthAhead)
      .order("calibration_due", { ascending: true }),
    supabase
      .from("inspection_edits")
      .select("id, edited_at, diff, old_observations, new_observations, edited_by, job_id, people!inspection_edits_edited_by_fkey(full_name), jobs(job_no, customers(name))")
      .order("edited_at", { ascending: false })
      .limit(5),
    listInvoicePendingReports(supabase).catch(() => []),
  ]);

  const openJobs = jobs.data ?? [];
  const unassigned = openJobs.filter(
    (j) => j.assignments.length === 0 && ["enquiry_received", "awaiting_approval", "scheduled"].includes(j.status)
  );
  const readyToCloseJobs = openJobs.filter((j) =>
    isJobReadyToClose({
      status: j.status,
      reports: j.reports,
      invoices: j.invoices,
    })
  );

  const due = invoices.data ?? [];
  const overdue = due.filter((i) => i.due_date && i.due_date < today);
  // Totals are the balances of issued invoices (drafts are not owed yet; D-017).
  const sum = (rows: typeof due) => rows.reduce((t, i) => t + (i.balance ?? 0), 0);
  const outstanding = sum(due);
  const dueThisWeek = due.filter((i) => i.due_date && i.due_date >= today && i.due_date <= weekAhead);
  const notYetDue = due.filter((i) => !i.due_date || i.due_date > weekAhead);

  const certAlerts = (qualificationsAlert.data ?? [])
    .filter((q): q is typeof q & { id: string; method: Enums<"test_method"> } => !!q.id && !!q.method)
    .map((q) => {
      const alert = classifyQualificationAlert(
        {
          id: q.id,
          method: q.method,
          valid_until: q.valid_until,
          is_expired: q.is_expired,
          people: q.people,
        },
        today
      );
      return alert ? { id: q.id, ...alert } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const calAlerts = (equipmentAlert.data ?? [])
    .map((eq) => {
      const alert = classifyEquipmentAlert(eq, today);
      return alert ? { id: eq.id, ...alert } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  type Item = { key: string; tone: Tone; title: string; detail: string; href: string; label: string; primary?: boolean };
  const attention: Item[] = [
    ...(reviewReports.data ?? []).map((r) => ({
      key: "r" + r.id,
      tone: "bad" as const,
      title: `Approve ${r.method} report ${r.report_no}`,
      detail: [r.jobs?.customers?.name, r.inspections?.missing_fields.length ? `missing ${r.inspections.missing_fields.join(", ")}` : "all readings in"]
        .filter(Boolean)
        .join(" · "),
      href: `/review/${r.id}`,
      label: "Review",
      primary: true,
    })),
    ...overdue.map((i) => ({
      key: "i" + i.id,
      tone: "bad" as const,
      title: `${formatINR(i.balance)} overdue from ${i.jobs?.customers?.name ?? "customer"}`,
      detail: `${i.number ?? "Invoice"} · ${daysBetween(i.due_date!, today)} days late`,
      href: `/jobs/${i.job_id}`,
      label: "Open",
    })),
    ...certAlerts.map((c) => ({
      key: "cert" + c.id,
      tone: c.tone,
      title: c.title,
      detail: c.detail,
      href: "/registers?tab=qualifications",
      label: "Registers",
    })),
    ...calAlerts.map((eq) => ({
      key: "cal" + eq.id,
      tone: eq.tone,
      title: eq.title,
      detail: eq.detail,
      href: `/equipment/${eq.id}`,
      label: "Equipment",
    })),
    ...(draftQuotes.data ?? []).map((q) => ({
      key: "q" + q.id,
      tone: "wait" as const,
      title: `Approve quotation ${q.ref_no ?? "(draft)"}`,
      detail: [q.customers?.name, q.subject].filter(Boolean).join(" · "),
      href: `/quotations/${q.id}`,
      label: "Review",
    })),
    ...unassigned.map((j) => ({
      key: "j" + j.id,
      tone: "wait" as const,
      title: `Assign a technician to ${j.job_no}`,
      detail: [j.customers?.name, j.scope].filter(Boolean).join(" · "),
      href: `/jobs/${j.id}`,
      label: "Assign",
    })),
    ...readyToCloseJobs.map((j) => ({
      key: "close" + j.id,
      tone: "wait" as const,
      title: `Close completed job ${j.job_no}`,
      detail: [j.customers?.name, "report sent · no balance outstanding"].filter(Boolean).join(" · "),
      href: `/jobs/${j.id}`,
      label: "Close",
    })),
    ...(newEnquiries.data ?? []).map((e) => ({
      key: "e" + e.id,
      tone: "info" as const,
      title: `Answer enquiry: ${e.subject ?? "(no subject)"}`,
      detail: [e.source === "whatsapp" ? "WhatsApp" : e.source === "email" ? "Email" : "Phone", e.customers?.name ?? "customer not linked"].join(" · "),
      href: `/enquiries/${e.id}`,
      label: "Open",
    })),
    ...(recentEdits.data ?? []).map((edit) => {
      const diffObj = (edit.diff ?? {}) as Record<string, { old: unknown; new: unknown }>;
      const fieldNames = Object.keys(diffObj);
      const changesSummary =
        fieldNames.length > 0
          ? fieldNames.slice(0, 3).map((f) => `${f}: ${String(diffObj[f]?.old ?? "—")} → ${String(diffObj[f]?.new ?? "—")}`).join(", ")
          : "updated readings";

      return {
        key: "edit" + edit.id,
        tone: "wait" as const,
        title: `Report edit on ${edit.jobs?.job_no ?? "job"}: ${edit.people?.full_name ?? "Technician"}`,
        detail: [edit.jobs?.customers?.name, changesSummary].filter(Boolean).join(" · "),
        href: `/jobs/${edit.job_id}`,
        label: "View diff",
      };
    }),
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${person.full_name.split(" ")[0]}`}
        subtitle={`${longDateIST()} · ${attention.length === 0 ? "nothing needs you right now" : `${attention.length} ${attention.length === 1 ? "thing needs" : "things need"} you today`}`}
        action={
          <>
            <ButtonLink href="/enquiries/new" variant="secondary">
              New enquiry
            </ButtonLink>
            <ButtonLink href="/jobs/new">New job</ButtonLink>
          </>
        }
      />

      <Stats
        items={[
          { label: "Active jobs", value: openJobs.length, note: `${onSite.data?.length ?? 0} on site today` },
          { label: "Reports pending", value: pendingReports.count ?? 0, note: `${reviewReports.data?.length ?? 0} waiting for approval` },
          {
            label: "Invoices pending",
            value: invoicePendingReports.length,
            note: (
              <Link href="/review?filter=invoice_pending" className="underline hover:text-ink">
                approved reports awaiting billing
              </Link>
            ),
          },
          {
            label: "Outstanding",
            value: formatINR(outstanding),
            note: overdue.length ? <span className="text-bad">{formatINR(sum(overdue))} overdue</span> : "nothing overdue",
          },
        ]}
      />

      <div className="grid gap-7 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-7">
          <section>
            <SectionTitle>Needs your attention</SectionTitle>
            <List>
              {attention.map((a) => (
                <ListRow
                  key={a.key}
                  tone={a.tone}
                  title={a.title}
                  detail={a.detail}
                  action={
                    <ButtonLink href={a.href} variant={a.primary ? "primary" : "secondary"} size="sm">
                      {a.label}
                    </ButtonLink>
                  }
                />
              ))}
              {attention.length === 0 && <EmptyRow>All clear: no reports, payments, quotations or jobs waiting for you.</EmptyRow>}
            </List>
          </section>

          {recentEdits.data && recentEdits.data.length > 0 && (
            <section>
              <SectionTitle>Report edits (technician updated after submit)</SectionTitle>
              <List>
                {recentEdits.data.map((edit) => {
                  const diffObj = (edit.diff ?? {}) as Record<string, { old: unknown; new: unknown }>;
                  const fieldNames = Object.keys(diffObj);
                  const changesDetail = fieldNames.map((f) => (
                    <span key={f} className="block text-xs text-ink-2">
                      <strong>{f}</strong>: {String(diffObj[f]?.old ?? "—")} →{" "}
                      <span className="text-ink">{String(diffObj[f]?.new ?? "—")}</span>
                    </span>
                  ));

                  return (
                    <ListRow
                      key={edit.id}
                      tone="wait"
                      title={
                        <span>
                          <Mono>{edit.jobs?.job_no}</Mono>
                          <span className="ml-2 font-normal text-ink-2">
                            {edit.people?.full_name} ({edit.jobs?.customers?.name})
                          </span>
                        </span>
                      }
                      detail={<div className="space-y-0.5">{changesDetail}</div>}
                      action={
                        <ButtonLink href={`/jobs/${edit.job_id}`} variant="secondary" size="sm">
                          Job details
                        </ButtonLink>
                      }
                    />
                  );
                })}
              </List>
            </section>
          )}

          <section>
            <SectionTitle link={{ href: "/jobs", label: "View all" }}>Open jobs</SectionTitle>
            <List>
              {openJobs.slice(0, 8).map((j) => {
                const ready = isJobReadyToClose({
                  status: j.status,
                  reports: j.reports,
                  invoices: j.invoices,
                });
                const s = ready ? { label: "Ready to close", tone: "ok" as Tone } : jobStage(j.status, j.assignments);
                return (
                  <ListRow
                    key={j.id}
                    title={
                      <a href={`/jobs/${j.id}`} className="hover:underline">
                        <Mono>{j.job_no}</Mono>
                        <span className="ml-3 font-normal text-ink-2">{j.customers?.name}</span>
                      </a>
                    }
                    action={<Status tone={s.tone}>{s.label}</Status>}
                  />
                );
              })}
              {openJobs.length === 0 && <EmptyRow>No open jobs.</EmptyRow>}
            </List>
          </section>
        </div>

        <div className="min-w-0 space-y-7">
          <section>
            <SectionTitle>Money</SectionTitle>
            <div className="rounded-xl border border-line p-4">
              <div className="text-[13px] text-ink-2">Outstanding</div>
              <div className="text-2xl font-semibold tracking-[-0.03em] tabular-nums">{formatINR(outstanding)}</div>
              {outstanding > 0 && (
                <div className="my-3.5 flex h-2 gap-0.5 overflow-hidden rounded">
                  <i className="bg-ink" style={{ flex: sum(notYetDue) }} />
                  <i className="bg-[#a3a3a3]" style={{ flex: sum(dueThisWeek) }} />
                  <i className="bg-bad" style={{ flex: sum(overdue) }} />
                </div>
              )}
              <ul className="text-[13px]">
                {[
                  { label: "Not yet due", amount: sum(notYetDue), cls: "bg-ink" },
                  { label: "Due this week", amount: sum(dueThisWeek), cls: "bg-[#a3a3a3]" },
                  { label: "Overdue", amount: sum(overdue), cls: "bg-bad" },
                ].map((b) => (
                  <li key={b.label} className="flex justify-between border-t border-line-2 py-1.5">
                    <span className="flex items-center gap-2 text-ink-2">
                      <i className={`inline-block h-2 w-2 rounded-sm ${b.cls}`} />
                      {b.label}
                    </span>
                    <b className="font-medium tabular-nums">{formatINR(b.amount)}</b>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-xs text-ink-3">From issued tax invoices.</p>
            </div>
          </section>

          <section>
            <SectionTitle link={{ href: "/office", label: "Schedule" }}>Today on site</SectionTitle>
            <List>
              {(onSite.data ?? []).map((a) => (
                <ListRow
                  key={a.id}
                  lead={<Avatar name={a.people?.full_name ?? "?"} />}
                  title={a.people?.full_name}
                  detail={[a.jobs?.customers?.name, a.jobs?.site, a.jobs?.job_no].filter(Boolean).join(" · ")}
                />
              ))}
              {(leave.data ?? []).map((l) => (
                <ListRow key={l.id} lead={<Avatar name={l.people?.full_name ?? "?"} />} title={l.people?.full_name} detail="On leave today" />
              ))}
              {(onSite.data?.length ?? 0) + (leave.data?.length ?? 0) === 0 && <EmptyRow>Nobody is scheduled on site today.</EmptyRow>}
            </List>
          </section>
        </div>
      </div>
    </>
  );
}

// What a job is waiting for, in plain words with a status colour.
function jobStage(status: Enums<"job_status">, assignments: { work_date: string; people: { full_name: string } | null }[]): { label: string; tone: Tone } {
  const next = [...assignments].sort((a, b) => a.work_date.localeCompare(b.work_date)).at(-1);
  switch (status) {
    case "enquiry_received":
    case "awaiting_approval":
      return next ? { label: `On site ${shortDate(next.work_date)}`, tone: "info" } : { label: "Needs technician", tone: "wait" };
    case "scheduled":
      return next ? { label: `On site ${shortDate(next.work_date)} · ${next.people?.full_name.split(" ").pop() ?? ""}`, tone: "info" } : { label: "Needs technician", tone: "wait" };
    case "inspection_done":
      return { label: "Field data in", tone: "info" };
    case "report_in_review":
      return { label: "Report to approve", tone: "bad" };
    case "report_sent":
      return { label: "Report sent", tone: "ok" };
    case "invoiced":
      return { label: "Invoiced", tone: "ok" };
    default:
      return { label: status, tone: "none" };
  }
}
