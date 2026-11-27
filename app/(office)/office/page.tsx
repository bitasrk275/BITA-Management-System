import { redirect } from "next/navigation";
import { ButtonLink, EmptyRow, List, ListRow, Mono, PageHeader, SectionTitle, StatusDot } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { longDateIST, shortDate, todayIST, weekday } from "@/lib/dates";
import { homeFor } from "@/lib/roles";

export const metadata = { title: "Today – BITA" };

// Office home: enquiries to handle, jobs waiting for a PO, and this week's schedule. No approvals here.
export default async function OfficeHome() {
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "office" || r === "management")) redirect(homeFor(person?.roles));

  const today = todayIST();
  const [enquiries, noPo, week, unassigned] = await Promise.all([
    supabase
      .from("enquiries")
      .select("id, subject, source, from_address, received_at, customer_id, customers(name)")
      .in("status", ["new", "linked"])
      .order("received_at", { ascending: false })
      .limit(20),
    supabase.from("jobs").select("id, job_no, scope, customers(name)").is("po_number", null).neq("status", "closed").order("created_at").limit(20),
    supabase
      .from("assignments")
      .select("id, work_date, people(full_name), jobs(id, job_no, test_methods, customers(name))")
      .gte("work_date", today)
      .lte("work_date", todayIST(6))
      .order("work_date"),
    supabase.from("jobs").select("id, job_no, scope, customers(name), assignments(id)").in("status", ["enquiry_received", "awaiting_approval", "scheduled"]),
  ]);

  const needTechnician = (unassigned.data ?? []).filter((j) => j.assignments.length === 0);
  const sourceLabel = (s: string) => (s === "whatsapp" ? "WhatsApp" : s === "email" ? "Email" : "Phone");

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={`${longDateIST()} · ${enquiries.data?.length ?? 0} enquiries · ${needTechnician.length} jobs without a technician · ${noPo.data?.length ?? 0} waiting for a PO`}
        action={<ButtonLink href="/enquiries/new">New enquiry</ButtonLink>}
      />
      <div className="grid gap-7 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-7">
          <section>
            <SectionTitle link={{ href: "/enquiries", label: "All enquiries" }}>Enquiries to handle</SectionTitle>
            <List>
              {(enquiries.data ?? []).map((e) => (
                <ListRow
                  key={e.id}
                  tone="info"
                  title={e.subject ?? "(no subject)"}
                  detail={[sourceLabel(e.source), e.customers?.name ?? e.from_address ?? "sender unknown", shortDate(e.received_at.slice(0, 10))].join(" · ")}
                  action={
                    e.customer_id ? (
                      <ButtonLink href={`/jobs/new?enquiry=${e.id}`} size="sm">
                        Create job
                      </ButtonLink>
                    ) : (
                      <ButtonLink href={`/enquiries/${e.id}`} variant="secondary" size="sm">
                        Link customer
                      </ButtonLink>
                    )
                  }
                />
              ))}
              {enquiries.data?.length === 0 && <EmptyRow>No enquiries waiting.</EmptyRow>}
            </List>
          </section>

          <section>
            <SectionTitle>Jobs waiting for a PO</SectionTitle>
            <List>
              {(noPo.data ?? []).map((j) => (
                <ListRow
                  key={j.id}
                  tone="wait"
                  title={<Mono>{j.job_no}</Mono>}
                  detail={[j.customers?.name, j.scope].filter(Boolean).join(" · ")}
                  action={
                    <ButtonLink href={`/jobs/${j.id}`} variant="secondary" size="sm">
                      Add PO
                    </ButtonLink>
                  }
                />
              ))}
              {noPo.data?.length === 0 && <EmptyRow>Every open job has its PO.</EmptyRow>}
            </List>
          </section>
        </div>

        <section className="min-w-0">
          <SectionTitle link={{ href: "/jobs", label: "All jobs" }}>This week</SectionTitle>
          <List>
            {(week.data ?? []).map((a) => (
              <ListRow
                key={a.id}
                lead={<span className="w-9 font-mono text-[14px] text-ink-3">{weekday(a.work_date)}</span>}
                title={`${a.people?.full_name ?? "?"} · ${a.jobs?.customers?.name ?? ""}`}
                detail={[a.jobs?.test_methods.join(", "), a.jobs?.job_no].filter(Boolean).join(" · ")}
                action={a.work_date === today ? <span className="text-[13px] text-ink-2">Today</span> : undefined}
              />
            ))}
            {needTechnician.map((j) => (
              <ListRow
                key={j.id}
                lead={<StatusDot tone="wait" />}
                title="Not assigned"
                detail={[j.customers?.name, j.job_no].filter(Boolean).join(" · ")}
                action={
                  <ButtonLink href={`/jobs/${j.id}`} size="sm">
                    Assign
                  </ButtonLink>
                }
              />
            ))}
            {(week.data?.length ?? 0) + needTechnician.length === 0 && <EmptyRow>Nothing scheduled this week.</EmptyRow>}
          </List>
        </section>
      </div>
    </>
  );
}
