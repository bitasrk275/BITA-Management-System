import Link from "next/link";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyRow,
  ErrorNote,
  Field,
  Input,
  List,
  ListRow,
  Mono,
  PageHeader,
  SavedNote,
  SecondaryButton,
  SectionTitle,
  Select,
  Stats,
  Status,
  type Tone,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { shortDate } from "@/lib/dates";
import {
  EXPENSE_KIND_LABELS,
  EXPENSE_KINDS,
  type LogBookStatus,
  currentMonthIST,
  isLogBookStatus,
  todayIST,
} from "@/lib/modules/log-book/schema";
import { listLogBookOverview } from "@/lib/modules/log-book/service";
import { formatINR } from "../jobs/labels";
import {
  addJobExpenseAction,
  deleteJobExpenseAction,
  updateLogBookEntryAction,
} from "./actions";

export const metadata = { title: "Log book – BITA" };
export const dynamic = "force-dynamic";

export default async function LogBookPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    status?: string;
    person_id?: string;
    job_id?: string;
    q?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { supabase, person } = await requireStaff();
  const params = await searchParams;

  const selectedMonth =
    params.month === "all" ? null : params.month || currentMonthIST();
  const selectedStatus: LogBookStatus | "all" = isLogBookStatus(params.status)
    ? params.status
    : "all";
  const selectedPersonId = params.person_id || undefined;
  const selectedJobId = params.job_id || undefined;
  const searchTerm = params.q || undefined;

  const [overview, jobsRes, peopleRes] = await Promise.all([
    listLogBookOverview(supabase, {
      month: selectedMonth,
      status: selectedStatus,
      personId: selectedPersonId,
      jobId: selectedJobId,
      search: searchTerm,
    }),
    supabase
      .from("jobs")
      .select("id, job_no, site, customer:customers!jobs_customer_id_fkey(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("people")
      .select("id, full_name, roles, active")
      .is("deleted_at", null)
      .eq("active", true)
      .order("full_name"),
  ]);

  const jobs = jobsRes.data ?? [];
  const staffAndTechs = peopleRes.data ?? [];
  const canWrite =
    person?.roles.some((r) => r === "management" || r === "office") ?? false;

  const statusTone = (st: LogBookStatus): Tone =>
    st === "completed" ? "ok" : st === "cancelled" ? "bad" : "info";

  const statusLabel: Record<LogBookStatus, string> = {
    scheduled: "Scheduled",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Log book & field expenses"
        subtitle="Automatically synced from the schedule calendar. Track site visits, completion status, and travel or site expenses per job."
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/calendar" variant="secondary">
              Open Calendar
            </ButtonLink>
            <ButtonLink href="/jobs" variant="secondary">
              Jobs
            </ButtonLink>
          </div>
        }
      />

      <ErrorNote message={params.error} />
      {params.saved && <SavedNote />}

      <Stats
        items={[
          {
            label: "Scheduled entries",
            value: overview.totals.scheduledCount,
            note: `${overview.totals.totalEntries} total in view`,
          },
          {
            label: "Completed visits",
            value: overview.totals.completedCount,
            note:
              overview.totals.cancelledCount > 0
                ? `${overview.totals.cancelledCount} cancelled`
                : "No cancelled visits",
          },
          {
            label: `Month expenses (${overview.month})`,
            value: formatINR(overview.totals.monthlyExpenseTotal),
            note: `Travel: ${formatINR(overview.totals.byKind.travel)}`,
          },
          {
            label: "All-time expenses",
            value: formatINR(overview.totals.totalAllExpenses),
            note: `Across ${Object.keys(overview.totals.byJob).length} job(s)`,
          },
        ]}
      />

      {/* Filter Bar */}
      <Card className="p-4">
        <form method="GET" action="/log-book" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Month (YYYY-MM)">
            <Input
              type="month"
              name="month"
              defaultValue={selectedMonth ?? ""}
            />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={selectedStatus}>
              <option value="all">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
          <Field label="Technician">
            <Select name="person_id" defaultValue={selectedPersonId ?? ""}>
              <option value="">All technicians</option>
              {staffAndTechs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search job / customer / site">
            <Input
              name="q"
              defaultValue={searchTerm ?? ""}
              placeholder="Job no, customer, site..."
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">Filter</Button>
            <ButtonLink href="/log-book?month=all" variant="secondary">
              All dates
            </ButtonLink>
          </div>
        </form>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.65fr_1fr]">
        {/* Left: Log Book Entries synced from Calendar */}
        <div className="space-y-4">
          <SectionTitle>
            Log book entries ({overview.entries.length})
          </SectionTitle>
          <List>
            {overview.entries.length === 0 ? (
              <EmptyRow>
                No log book entries match the selected filters. Assigning a job on the{" "}
                <Link href="/calendar" className="underline text-ink font-medium">
                  Calendar
                </Link>{" "}
                automatically creates a log book row.
              </EmptyRow>
            ) : (
              overview.entries.map((entry) => {
                const dateLabel =
                  entry.end_date && entry.end_date !== entry.work_date
                    ? `${shortDate(entry.work_date)} → ${shortDate(entry.end_date)}`
                    : shortDate(entry.work_date);

                return (
                  <ListRow
                    key={entry.id}
                    tone={statusTone(entry.status)}
                    title={
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/jobs/${entry.job_id}`}
                          className="font-semibold text-ink hover:underline"
                        >
                          <Mono>{entry.job_no}</Mono>
                        </Link>
                        <span className="font-medium text-ink">{entry.customer_name}</span>
                        <Status tone={statusTone(entry.status)}>
                          {statusLabel[entry.status]}
                        </Status>
                        {entry.job_expense_total > 0 && (
                          <Badge>Job expenses: {formatINR(entry.job_expense_total)}</Badge>
                        )}
                      </div>
                    }
                    detail={
                      <div className="mt-1 space-y-1 text-xs text-ink-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>
                            <strong className="text-ink">Date:</strong> {dateLabel}
                          </span>
                          <span>
                            <strong className="text-ink">Technician:</strong>{" "}
                            {entry.technician_name ?? "Unassigned"}
                          </span>
                          {entry.site && (
                            <span>
                              <strong className="text-ink">Site:</strong> {entry.site}
                            </span>
                          )}
                        </div>
                        {entry.notes && (
                          <div className="text-ink-3">Note: {entry.notes}</div>
                        )}
                        {entry.entry_expenses.length > 0 && (
                          <div className="pt-1 text-[11.5px] text-ink-2">
                            Expenses:{" "}
                            {entry.entry_expenses
                              .map(
                                (ex) =>
                                  `${EXPENSE_KIND_LABELS[ex.kind]} ${formatINR(ex.amount)}${
                                    ex.note ? ` (${ex.note})` : ""
                                  }`
                              )
                              .join(" · ")}
                          </div>
                        )}
                      </div>
                    }
                    action={
                      canWrite ? (
                        <details className="relative">
                          <summary className="cursor-pointer list-none rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink hover:bg-side">
                            Update
                          </summary>
                          <div className="absolute right-0 z-20 mt-1.5 w-64 rounded-xl border border-line bg-white p-3 shadow-lg">
                            <form
                              action={updateLogBookEntryAction.bind(null, entry.id)}
                              className="space-y-2.5"
                            >
                              <Field label="Status">
                                <Select name="status" defaultValue={entry.status}>
                                  <option value="scheduled">Scheduled</option>
                                  <option value="completed">Completed</option>
                                  <option value="cancelled">Cancelled</option>
                                </Select>
                              </Field>
                              <Field label="Notes">
                                <Input
                                  name="notes"
                                  defaultValue={entry.notes ?? ""}
                                  placeholder="Visit remarks..."
                                />
                              </Field>
                              <Button type="submit">Save</Button>
                            </form>
                          </div>
                        </details>
                      ) : undefined
                    }
                  />
                );
              })
            )}
          </List>
        </div>

        {/* Right: Record Travel & Other Expenses + Expense Register */}
        <div className="space-y-6">
          {canWrite && (
            <Card className="space-y-4">
              <SectionTitle>Record travel & job expense</SectionTitle>
              <form action={addJobExpenseAction} className="space-y-3">
                <Field label="Job *">
                  <Select name="job_id" required defaultValue={selectedJobId ?? ""}>
                    <option value="">Select job...</option>
                    {jobs.map((j) => {
                      const cust = j.customer as unknown as { name?: string } | null;
                      return (
                        <option key={j.id} value={j.id}>
                          {j.job_no} — {cust?.name ?? "Customer"}
                          {j.site ? ` (${j.site})` : ""}
                        </option>
                      );
                    })}
                  </Select>
                </Field>

                <Field label="Link to log book visit (optional)">
                  <Select name="log_book_id" defaultValue="">
                    <option value="">(General job expense)</option>
                    {overview.entries.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.job_no} · {shortDate(e.work_date)} · {e.technician_name ?? "Tech"}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Category *">
                    <Select name="kind" defaultValue="travel">
                      {EXPENSE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {EXPENSE_KIND_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Amount (INR) *">
                    <Input
                      type="number"
                      name="amount"
                      step="0.01"
                      min="0"
                      required
                      placeholder="e.g. 450"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Expense date *">
                    <Input
                      type="date"
                      name="expense_date"
                      defaultValue={todayIST()}
                      required
                    />
                  </Field>
                  <Field label="Technician / staff">
                    <Select name="person_id" defaultValue="">
                      <option value="">(Optional)</option>
                      {staffAndTechs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Field label="Note / particulars">
                  <Input
                    name="note"
                    placeholder="e.g. Auto / cab to Peenya Stage II, toll"
                  />
                </Field>

                <Button type="submit">Add expense</Button>
              </form>
            </Card>
          )}

          <section className="space-y-3">
            <SectionTitle>
              Recorded expenses ({overview.expenses.length})
            </SectionTitle>
            <List>
              {overview.expenses.length === 0 ? (
                <EmptyRow>No expenses recorded for this period.</EmptyRow>
              ) : (
                overview.expenses.map((exp) => {
                  const matchedJob = jobs.find((j) => j.id === exp.job_id);
                  return (
                    <ListRow
                      key={exp.id}
                      title={
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold tabular-nums text-ink">
                            {formatINR(exp.amount)}
                          </span>
                          <Badge>{EXPENSE_KIND_LABELS[exp.kind]}</Badge>
                          {matchedJob && (
                            <Link
                              href={`/jobs/${exp.job_id}`}
                              className="text-xs hover:underline"
                            >
                              <Mono>{matchedJob.job_no}</Mono>
                            </Link>
                          )}
                        </div>
                      }
                      detail={
                        <div className="text-xs text-ink-2">
                          {[
                            shortDate(exp.expense_date),
                            exp.person_name,
                            exp.note,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      }
                      action={
                        canWrite ? (
                          <details className="relative">
                            <summary className="cursor-pointer list-none rounded border border-line px-2 py-1 text-xs text-bad hover:bg-bad/5">
                              Delete
                            </summary>
                            <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-line bg-white p-2.5 shadow-md">
                              <p className="mb-2 text-xs text-ink-2">
                                Delete this {formatINR(exp.amount)} expense?
                              </p>
                              <form action={deleteJobExpenseAction.bind(null, exp.id)}>
                                <SecondaryButton type="submit" className="w-full text-bad">
                                  Confirm delete
                                </SecondaryButton>
                              </form>
                            </div>
                          </details>
                        ) : undefined
                      }
                    />
                  );
                })
              )}
            </List>
          </section>
        </div>
      </div>
    </div>
  );
}
