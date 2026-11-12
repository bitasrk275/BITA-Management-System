import { notFound, redirect } from "next/navigation";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyRow,
  List,
  ListRow,
  Mono,
  PageHeader,
  SectionTitle,
  Stats,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { diffAuditRow, validUuid } from "@/lib/reports/review";
import { homeFor } from "@/lib/roles";
import { METHOD_LABEL } from "../../../jobs/labels";

export const metadata = { title: "Correction history – BITA" };

function formatISTDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// T9: Correction history view from audit_log (R28, X3).
export default async function ReportHistoryPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  if (!validUuid(reportId)) notFound();

  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "reviewer" || r === "office")) {
    redirect(homeFor(person?.roles));
  }

  const { data: report } = await supabase
    .from("reports")
    .select("id, report_no, method, status, job_id, inspection_id, jobs(job_no, customers(name))")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) notFound();

  const recordIds = [
    report.id,
    ...(report.inspection_id ? [report.inspection_id] : []),
    report.job_id,
  ];

  const [auditRes, peopleRes] = await Promise.all([
    supabase
      .from("audit_log")
      .select("*")
      .in("record_id", recordIds)
      .order("changed_at", { ascending: false })
      .limit(100),
    supabase.from("people").select("id, user_id, full_name, roles"),
  ]);

  const audits = auditRes.data ?? [];
  const people = peopleRes.data ?? [];

  const personById = new Map(people.map((p) => [p.id, p.full_name]));
  const personByUserId = new Map(
    people.filter((p) => p.user_id).map((p) => [p.user_id!, p.full_name])
  );

  function actorName(entry: (typeof audits)[number]): string {
    if (entry.changed_by_person && personById.has(entry.changed_by_person)) {
      return personById.get(entry.changed_by_person)!;
    }
    if (entry.changed_by_user && personByUserId.has(entry.changed_by_user)) {
      return personByUserId.get(entry.changed_by_user)!;
    }
    if (entry.changed_by_user) return `User ${entry.changed_by_user.slice(0, 8)}`;
    return "System / database trigger";
  }

  const updateEntries = audits.filter((a) => a.action === "update");
  const reportEntries = audits.filter((a) => a.table_name === "reports");
  const inspectionEntries = audits.filter((a) => a.table_name === "inspections");

  return (
    <>
      <PageHeader
        title={`Correction history · ${report.report_no}`}
        subtitle={`${report.jobs?.job_no ?? "Job"} · ${METHOD_LABEL[report.method]} · ${
          report.jobs?.customers?.name ?? "Customer"
        } · Audit trail of every field and report change`}
        action={
          <>
            <ButtonLink href={`/review/${report.id}`} variant="secondary" size="sm">
              Back to report review
            </ButtonLink>
            <ButtonLink href="/review" variant="secondary" size="sm">
              Review queue
            </ButtonLink>
          </>
        }
      />

      {!person.roles.includes("management") && audits.length === 0 && (
        <Card className="mb-6">
          <Status tone="info">
            Full audit log rows are visible to Management (Row Level Security policy on <Mono>audit_log</Mono>).
          </Status>
        </Card>
      )}

      <Stats
        items={[
          {
            label: "Total audit entries",
            value: audits.length,
            note: "Across report, field data & job",
          },
          {
            label: "Corrections / updates",
            value: updateEntries.length,
            note: "Old value -> new value recorded",
          },
          {
            label: "Field vs report events",
            value: `${inspectionEntries.length} / ${reportEntries.length}`,
            note: "Inspections / Reports table",
          },
        ]}
      />

      <section className="space-y-4">
        <SectionTitle>Chronological audit log (newest first)</SectionTitle>
        <List>
          {audits.map((entry) => {
            const diffs = diffAuditRow(
              entry.old_row,
              entry.new_row,
              entry.changed_fields ?? []
            );
            const isCorrection = entry.action === "update";
            const tableLabel =
              entry.table_name === "inspections"
                ? "Field inspection"
                : entry.table_name === "reports"
                  ? "Report"
                  : entry.table_name === "jobs"
                    ? "Job"
                    : entry.table_name;

            return (
              <ListRow
                key={entry.id}
                tone={isCorrection ? "wait" : "ok"}
                title={
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{tableLabel}</span>
                    <Badge>{entry.action}</Badge>
                    <span className="text-[13px] font-normal text-ink-2">
                      by <strong className="font-medium text-ink">{actorName(entry)}</strong>
                    </span>
                    <span className="text-xs font-normal text-ink-3">
                      · {formatISTDateTime(entry.changed_at)} IST
                    </span>
                  </div>
                }
                detail={
                  <div className="mt-2 space-y-1.5">
                    {diffs.length > 0 ? (
                      <div className="space-y-1">
                        {diffs.map((d) => (
                          <div
                            key={d.field}
                            className="flex flex-wrap items-baseline gap-1.5 text-[12.5px]"
                          >
                            <Mono>{d.field}</Mono>
                            <span className="text-ink-3">:</span>
                            {entry.action !== "insert" && (
                              <>
                                <span className="line-through text-ink-3 break-all">
                                  {d.before.length > 100
                                    ? `${d.before.slice(0, 97)}...`
                                    : d.before}
                                </span>
                                <span className="text-ink-3">→</span>
                              </>
                            )}
                            <span className="font-medium text-ink break-all">
                              {d.after.length > 120 ? `${d.after.slice(0, 117)}...` : d.after}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span>
                        Record {entry.action} (<Mono>{entry.record_id.slice(0, 8)}</Mono>)
                      </span>
                    )}
                  </div>
                }
                action={
                  entry.management_notified_at ? (
                    <Status tone="ok">Notified</Status>
                  ) : isCorrection ? (
                    <Status tone="wait">Correction logged</Status>
                  ) : (
                    <Status tone="none">Initial</Status>
                  )
                }
              />
            );
          })}
          {audits.length === 0 && (
            <EmptyRow>
              No audit entries recorded yet for this report or its field inspection. Every insert or edit to field readings and reports is logged automatically by the database trigger.
            </EmptyRow>
          )}
        </List>
      </section>
    </>
  );
}
