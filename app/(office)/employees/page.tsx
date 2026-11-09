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
  SectionTitle,
  Select,
  Stats,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { Enums } from "@/lib/db/types";
import { APP_ROLES, currentMonthIST } from "@/lib/modules/employees/schema";
import { listEmployees } from "@/lib/modules/employees/service";
import { formatINR } from "../jobs/labels";
import { createEmployeeAction } from "./actions";

export const metadata = { title: "Employees – BITA" };
export const dynamic = "force-dynamic";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    role?: string;
    status?: string;
    q?: string;
    saved?: string;
    deleted?: string;
    error?: string;
  }>;
}) {
  const { supabase, person } = await requireStaff();
  const params = await searchParams;

  const isManagement = person?.roles.includes("management") ?? false;
  const selectedMonth = params.month || currentMonthIST();
  const selectedRole: Enums<"app_role"> | "all" =
    params.role && (APP_ROLES as readonly string[]).includes(params.role)
      ? (params.role as Enums<"app_role">)
      : "all";
  const selectedStatus: "active" | "inactive" | "all" =
    params.status === "inactive" || params.status === "all"
      ? params.status
      : "active";
  const searchTerm = params.q || undefined;

  const { month, employees } = await listEmployees(supabase, {
    month: selectedMonth,
    role: selectedRole,
    status: selectedStatus,
    search: searchTerm,
    canViewSalaries: isManagement,
  });

  const totalActive = employees.filter((e) => e.active).length;
  const technicianCount = employees.filter((e) =>
    e.roles.includes("technician")
  ).length;
  const expiredCertCount = employees.reduce(
    (sum, e) => sum + e.qualifications.filter((q) => q.is_expired).length,
    0
  );
  const linkedPhoneCount = employees.reduce(
    (sum, e) => sum + e.active_devices_count,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee register"
        subtitle="Technicians and office staff, monthly worked / idle / leave days from the calendar, NDT qualifications, and phone pairing."
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/calendar" variant="secondary">
              Calendar
            </ButtonLink>
            {isManagement && (
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg bg-ink px-3.5 py-2 text-[13.5px] font-medium text-white hover:bg-ink/90">
                  + Add employee
                </summary>
                <div className="absolute right-0 z-30 mt-2 w-80 sm:w-96 rounded-xl border border-line bg-white p-4 shadow-xl">
                  <SectionTitle>New employee</SectionTitle>
                  <form action={createEmployeeAction} className="mt-3 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <Field label="Full name *">
                          <Input name="full_name" required placeholder="e.g. Ramesh Kumar" />
                        </Field>
                      </div>
                      <Field label="Initials">
                        <Input name="initials" maxLength={6} placeholder="RK" />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Position">
                        <Input name="position" placeholder="Senior NDT Technician" />
                      </Field>
                      <Field label="Mobile">
                        <Input name="mobile" placeholder="+91 98450 00000" />
                      </Field>
                    </div>
                    <Field label="Email">
                      <Input type="email" name="email" placeholder="ramesh@bita.test" />
                    </Field>
                    <Field label="Roles">
                      <div className="flex flex-wrap gap-3 pt-1 text-xs">
                        {APP_ROLES.map((r) => (
                          <label key={r} className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              name="roles"
                              value={r}
                              defaultChecked={r === "technician"}
                            />
                            <span className="capitalize">{r}</span>
                          </label>
                        ))}
                      </div>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Monthly salary (INR)">
                        <Input
                          type="number"
                          name="monthly_salary"
                          step="0.01"
                          min="0"
                          placeholder="e.g. 38000"
                        />
                      </Field>
                      <Field label="Per-job allowance (INR)">
                        <Input
                          type="number"
                          name="per_job_allowance"
                          step="0.01"
                          min="0"
                          placeholder="e.g. 500"
                        />
                      </Field>
                    </div>
                    <input type="hidden" name="active" value="true" />
                    <Button type="submit">Save employee</Button>
                  </form>
                </div>
              </details>
            )}
          </div>
        }
      />

      <ErrorNote message={params.error} />
      {params.saved && <SavedNote />}
      {params.deleted && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          Employee moved to{" "}
          <Link href="/recycle-bin" className="underline font-medium">
            Recycle bin
          </Link>
          .
        </Card>
      )}

      <Stats
        items={[
          { label: "Active staff", value: totalActive, note: `${employees.length} shown` },
          { label: "Technicians", value: technicianCount, note: `${linkedPhoneCount} linked phone(s)` },
          {
            label: "Certificate alerts",
            value: expiredCertCount,
            note: expiredCertCount > 0 ? "Expired NDT certificates" : "All certificates in date",
          },
          {
            label: "Attendance month",
            value: month,
            note: "Sundays & BITA holidays excluded from idle days",
          },
        ]}
      />

      {/* Filter Bar */}
      <Card className="p-4">
        <form method="GET" action="/employees" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Attendance month">
            <Input type="month" name="month" defaultValue={month} />
          </Field>
          <Field label="Role">
            <Select name="role" defaultValue={selectedRole}>
              <option value="all">All roles</option>
              {APP_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={selectedStatus}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </Select>
          </Field>
          <Field label="Search name / method / cert">
            <Input
              name="q"
              defaultValue={searchTerm ?? ""}
              placeholder="Name, initials, UT, Level II..."
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit">Apply</Button>
            <ButtonLink href="/employees" variant="secondary">
              Reset
            </ButtonLink>
          </div>
        </form>
      </Card>

      <section className="space-y-3">
        <SectionTitle>Employees ({employees.length})</SectionTitle>
        <List>
          {employees.length === 0 ? (
            <EmptyRow>No employees match the selected filters.</EmptyRow>
          ) : (
            employees.map((emp) => {
              const expiredQuals = emp.qualifications.filter((q) => q.is_expired);
              const isTech = emp.roles.includes("technician");

              return (
                <ListRow
                  key={emp.id}
                  tone={!emp.active ? "none" : expiredQuals.length > 0 ? "bad" : "ok"}
                  title={
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/employees/${emp.id}?month=${month}`}
                        className="font-semibold text-ink hover:underline"
                      >
                        {emp.full_name}
                      </Link>
                      {emp.initials && (
                        <Badge>
                          <Mono>{emp.initials}</Mono>
                        </Badge>
                      )}
                      {emp.roles.map((r) => (
                        <Badge key={r}>{r}</Badge>
                      ))}
                      {!emp.active && <Status tone="none">Inactive</Status>}
                      {isTech && (
                        <Status tone={emp.active_devices_count > 0 ? "ok" : "wait"}>
                          {emp.active_devices_count > 0
                            ? `${emp.active_devices_count} phone linked`
                            : "No phone linked"}
                        </Status>
                      )}
                    </div>
                  }
                  detail={
                    <div className="mt-1 space-y-1 text-xs text-ink-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>
                          {[emp.position, emp.mobile, emp.email]
                            .filter(Boolean)
                            .join(" · ") || "No contact info"}
                        </span>
                        <span>
                          <strong className="text-ink">Worked ({month}):</strong>{" "}
                          {emp.attendance.workedDays}d ·{" "}
                          <strong className="text-ink">Idle:</strong>{" "}
                          {emp.attendance.idleDays}d ·{" "}
                          <strong className="text-ink">Leave:</strong>{" "}
                          {emp.attendance.leaveDays}d{" "}
                          <span className="text-ink-3">
                            ({emp.attendance.workingDays} working days)
                          </span>
                        </span>
                      </div>

                      {emp.qualifications.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-ink-3">Certificates:</span>
                          {emp.qualifications.map((q) => (
                            <span
                              key={q.id}
                              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                q.is_expired
                                  ? "bg-bad/10 text-bad"
                                  : "bg-side text-ink-2"
                              }`}
                            >
                              {q.method} {q.level}
                              {q.is_expired ? " (Expired)" : ""}
                            </span>
                          ))}
                        </div>
                      )}

                      {isManagement &&
                        (emp.monthly_salary !== null ||
                          emp.per_job_allowance !== null) && (
                          <div className="pt-0.5 text-[11.5px] text-ink-2">
                            <strong className="text-ink">Compensation (Management only):</strong>{" "}
                            Salary{" "}
                            {emp.monthly_salary !== null
                              ? formatINR(emp.monthly_salary)
                              : "—"}{" "}
                            / month · Per-job allowance{" "}
                            {emp.per_job_allowance !== null
                              ? formatINR(emp.per_job_allowance)
                              : "—"}
                          </div>
                        )}
                    </div>
                  }
                  action={
                    <ButtonLink
                      href={`/employees/${emp.id}?month=${month}`}
                      variant="secondary"
                      size="sm"
                    >
                      Manage →
                    </ButtonLink>
                  }
                />
              );
            })
          )}
        </List>
      </section>
    </div>
  );
}
