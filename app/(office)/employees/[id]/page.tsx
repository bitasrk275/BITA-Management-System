import { notFound } from "next/navigation";
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
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { shortDate } from "@/lib/dates";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";
import {
  APP_ROLES,
  TEST_METHODS,
  currentMonthIST,
  isValidUuid,
} from "@/lib/modules/employees/schema";
import { getEmployeeDetail } from "@/lib/modules/employees/service";
import {
  addQualificationAction,
  deleteEmployeeAction,
  deleteQualificationAction,
  linkEmployeePhoneAction,
  removeEmployeeSignatureAction,
  revokeEmployeePhoneAction,
  updateEmployeeAction,
  uploadEmployeeSignatureAction,
} from "../actions";

export const metadata = { title: "Employee details – BITA" };
export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    month?: string;
    saved?: string;
    error?: string;
    pairingCode?: string;
    expiresAt?: string;
  }>;
}) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const query = await searchParams;
  const { supabase, person } = await requireStaff();

  const isManagement = person?.roles.includes("management") ?? false;
  const canEditStaff =
    person?.roles.some((r) => r === "management" || r === "office") ?? false;
  const month = query.month || currentMonthIST();

  const [employee, canDelete] = await Promise.all([
    getEmployeeDetail(supabase, id, {
      month,
      canViewSalaries: isManagement,
    }),
    hasPermissionForRoles(supabase, person?.roles, "delete"),
  ]);

  if (!employee) notFound();

  const isTech = employee.roles.includes("technician");

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title={employee.full_name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {employee.initials && (
              <Badge>
                <Mono>{employee.initials}</Mono>
              </Badge>
            )}
            {employee.roles.map((r) => (
              <Badge key={r}>{r}</Badge>
            ))}
            <Status tone={employee.active ? "ok" : "none"}>
              {employee.active ? "Active" : "Inactive"}
            </Status>
            {employee.position && <span>· {employee.position}</span>}
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/employees?month=${month}`} variant="secondary">
              ← Back to employees
            </ButtonLink>
            <ButtonLink
              href={`/calendar?technicianId=${employee.id}`}
              variant="secondary"
            >
              View on Calendar
            </ButtonLink>
          </div>
        }
      />

      <ErrorNote message={query.error} />
      {query.saved && <SavedNote />}

      {query.pairingCode && (
        <Card className="border-ok/30 bg-ok/5 p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            New Phone Pairing Code
          </div>
          <div className="my-2 font-mono text-3xl font-bold tracking-widest text-ink">
            {query.pairingCode}
          </div>
          <p className="text-xs text-ink-2">
            Valid for 15 minutes
            {query.expiresAt
              ? ` (until ${new Date(query.expiresAt).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })})`
              : ""}
            . Have {employee.full_name} open the BITA Technician Android app and enter
            these 6 digits.
          </p>
        </Card>
      )}

      {/* Monthly Attendance Summary from Calendar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>
            Calendar attendance summary ({employee.attendance.month})
          </SectionTitle>
          <form method="GET" action={`/employees/${employee.id}`} className="flex items-center gap-2">
            <Input
              type="month"
              name="month"
              defaultValue={employee.attendance.month}
              className="w-40"
            />
            <SecondaryButton type="submit">Change month</SecondaryButton>
          </form>
        </div>
        <Stats
          items={[
            {
              label: "Days worked",
              value: employee.attendance.workedDays,
              note: "Scheduled on jobs",
            },
            {
              label: "Days idle",
              value: employee.attendance.idleDays,
              note: "Working days without job or leave",
            },
            {
              label: "Days on leave",
              value: employee.attendance.leaveDays,
              note: "Recorded in leave register",
            },
            {
              label: "Working days in month",
              value: employee.attendance.workingDays,
              note: `${employee.attendance.sundaysAndHolidays} Sundays & holidays excluded`,
            },
          ]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Profile & Compensation (Management edits) */}
        <div className="space-y-6">
          <Card className="space-y-4">
            <SectionTitle>
              Employee details {isManagement ? "& compensation" : ""}
            </SectionTitle>
            {!isManagement && (
              <p className="text-xs text-ink-3">
                Only management can edit employee roles or view/edit salary & per-job
                allowance.
              </p>
            )}
            <form
              action={updateEmployeeAction.bind(null, employee.id)}
              className="space-y-3"
            >
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="Full name *">
                    <Input
                      name="full_name"
                      defaultValue={employee.full_name}
                      required
                      disabled={!isManagement}
                    />
                  </Field>
                </div>
                <Field label="Initials">
                  <Input
                    name="initials"
                    defaultValue={employee.initials ?? ""}
                    maxLength={6}
                    disabled={!isManagement}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Position / title">
                  <Input
                    name="position"
                    defaultValue={employee.position ?? ""}
                    disabled={!isManagement}
                  />
                </Field>
                <Field label="Mobile">
                  <Input
                    name="mobile"
                    defaultValue={employee.mobile ?? ""}
                    disabled={!isManagement}
                  />
                </Field>
              </div>

              <Field label="Email">
                <Input
                  type="email"
                  name="email"
                  defaultValue={employee.email ?? ""}
                  disabled={!isManagement}
                />
              </Field>

              <Field label="Roles">
                <div className="flex flex-wrap gap-3 pt-1 text-xs">
                  {APP_ROLES.map((r) => (
                    <label key={r} className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        name="roles"
                        value={r}
                        defaultChecked={employee.roles.includes(r)}
                        disabled={!isManagement}
                      />
                      <span className="capitalize">{r}</span>
                    </label>
                  ))}
                </div>
              </Field>

              {isManagement && (
                <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
                  <Field
                    label="Monthly salary (INR)"
                    hint="Visible only to management"
                  >
                    <Input
                      type="number"
                      name="monthly_salary"
                      step="0.01"
                      min="0"
                      defaultValue={
                        employee.monthly_salary !== null
                          ? String(employee.monthly_salary)
                          : ""
                      }
                      placeholder="e.g. 38000"
                    />
                  </Field>
                  <Field
                    label="Per-job allowance (INR)"
                    hint="Visible only to management"
                  >
                    <Input
                      type="number"
                      name="per_job_allowance"
                      step="0.01"
                      min="0"
                      defaultValue={
                        employee.per_job_allowance !== null
                          ? String(employee.per_job_allowance)
                          : ""
                      }
                      placeholder="e.g. 500"
                    />
                  </Field>
                </div>
              )}

              <label className="flex items-center gap-2 pt-1 text-xs font-medium text-ink">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={employee.active}
                  disabled={!isManagement}
                />
                Active employee
              </label>

              {isManagement && (
                <div className="pt-2">
                  <Button type="submit">Save employee changes</Button>
                </div>
              )}
            </form>

            {canDelete && (
              <div className="flex items-center justify-between border-t border-line pt-3 text-xs text-ink-2">
                <span>Move employee to recycle bin</span>
                <details className="relative">
                  <summary className="cursor-pointer list-none rounded border border-line px-2.5 py-1 text-xs text-bad hover:bg-bad/5">
                    Delete employee
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-line bg-white p-3 shadow-md">
                    <p className="mb-2 text-xs text-ink-2">
                      Move {employee.full_name} to the recycle bin?
                    </p>
                    <form action={deleteEmployeeAction.bind(null, employee.id)}>
                      <SecondaryButton type="submit" className="w-full text-bad">
                        Confirm delete
                      </SecondaryButton>
                    </form>
                  </div>
                </details>
              </div>
            )}
          </Card>

          {/* Phone Link / Unlink Section */}
          {isTech && (
            <Card className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <SectionTitle>Linked phones (Android app)</SectionTitle>
                  <p className="text-xs text-ink-3">
                    Link a technician phone with a one-time 6-digit code, or unlink a
                    lost phone immediately.
                  </p>
                </div>
                {canEditStaff && (
                  <form action={linkEmployeePhoneAction.bind(null, employee.id)}>
                    <Button type="submit">Link a phone</Button>
                  </form>
                )}
              </div>

              <List>
                {employee.devices.length === 0 ? (
                  <EmptyRow>
                    No phones linked yet. Click &quot;Link a phone&quot; to generate a
                    6-digit code.
                  </EmptyRow>
                ) : (
                  employee.devices.map((dev) => (
                    <ListRow
                      key={dev.id}
                      tone={dev.revoked_at ? "bad" : "ok"}
                      title={dev.device_name || "Android phone"}
                      detail={
                        dev.revoked_at
                          ? `Unlinked / revoked on ${shortDate(
                              dev.revoked_at.slice(0, 10)
                            )}`
                          : `Paired ${shortDate(
                              dev.paired_at.slice(0, 10)
                            )} · Last seen ${
                              dev.last_seen_at
                                ? shortDate(dev.last_seen_at.slice(0, 10))
                                : "never"
                            }`
                      }
                      action={
                        canEditStaff && !dev.revoked_at ? (
                          <details className="relative">
                            <summary className="cursor-pointer list-none rounded border border-line px-2.5 py-1 text-xs text-bad hover:bg-bad/5">
                              Unlink phone
                            </summary>
                            <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-line bg-white p-2.5 shadow-md">
                              <p className="mb-2 text-xs text-ink-2">
                                Unlink {dev.device_name || "this phone"}? It will lose
                                access immediately.
                              </p>
                              <form
                                action={revokeEmployeePhoneAction.bind(
                                  null,
                                  employee.id,
                                  dev.id
                                )}
                              >
                                <SecondaryButton
                                  type="submit"
                                  className="w-full text-bad"
                                >
                                  Confirm unlink
                                </SecondaryButton>
                              </form>
                            </div>
                          </details>
                        ) : undefined
                      }
                    />
                  ))
                )}
              </List>
            </Card>
          )}

          {/* Digital Signature Card */}
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <SectionTitle>Digital signature</SectionTitle>
                <p className="text-xs text-ink-3">
                  Applied to approved inspection reports when {employee.full_name} is the technical reviewer.
                </p>
              </div>
              {employee.signature_path ? (
                <Status tone="ok">Uploaded</Status>
              ) : (
                <Status tone="none">Not uploaded</Status>
              )}
            </div>

            {employee.signature_path && (
              <div className="flex items-center justify-between rounded border border-line bg-side/40 p-3">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-xs font-mono text-ink">
                    {employee.signature_path.split("/").pop()}
                  </span>
                </div>
                {isManagement && (
                  <form action={removeEmployeeSignatureAction.bind(null, employee.id)}>
                    <SecondaryButton type="submit" className="text-xs text-bad">
                      Remove signature
                    </SecondaryButton>
                  </form>
                )}
              </div>
            )}

            {isManagement && (
              <form
                action={uploadEmployeeSignatureAction.bind(null, employee.id)}
                className="space-y-3 pt-1 border-t border-line"
              >
                <Field
                  label={
                    employee.signature_path
                      ? "Replace signature image (PNG / JPEG)"
                      : "Upload signature image (PNG / JPEG)"
                  }
                  hint="Transparent PNG or crisp JPEG scan under 2 MB"
                >
                  <input
                    type="file"
                    name="signature_file"
                    accept="image/png,image/jpeg,image/jpg"
                    required
                    className="w-full text-xs text-ink-2 file:mr-2 file:rounded file:border file:border-line file:bg-side file:px-2.5 file:py-1 file:text-xs file:text-ink"
                  />
                </Field>
                <Button type="submit">
                  {employee.signature_path ? "Replace signature" : "Upload signature"}
                </Button>
              </form>
            )}
          </Card>
        </div>

        {/* Right: NDT Qualifications & Certificates */}
        <div className="space-y-6">
          <section className="space-y-3">
            <SectionTitle>
              Qualifications & NDT certificates ({employee.qualifications.length})
            </SectionTitle>
            <List>
              {employee.qualifications.length === 0 ? (
                <EmptyRow>No NDT qualifications recorded yet.</EmptyRow>
              ) : (
                employee.qualifications.map((q) => (
                  <ListRow
                    key={q.id}
                    tone={q.is_expired ? "bad" : "ok"}
                    title={
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">
                          {q.method} · {q.level}
                        </span>
                        <Status tone={q.is_expired ? "bad" : "ok"}>
                          {q.is_expired
                            ? "Expired"
                            : q.valid_until
                              ? "In date"
                              : "No expiry"}
                        </Status>
                        {q.certificate_no && (
                          <Badge>
                            <Mono>{q.certificate_no}</Mono>
                          </Badge>
                        )}
                      </div>
                    }
                    detail={
                      <div className="text-xs text-ink-2">
                        <div>
                          {[q.scheme, q.certifying_body]
                            .filter(Boolean)
                            .join(" · ") || "Standard scheme"}
                        </div>
                        <div>
                          Issued: {q.issued_on ? shortDate(q.issued_on) : "—"} · Valid
                          until: {q.valid_until ? shortDate(q.valid_until) : "—"}
                        </div>
                      </div>
                    }
                    action={
                      <div className="flex items-center gap-2">
                        {q.certificate_path && (
                          <a
                            href={`/registers/qualifications/${q.id}/certificate`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-ink underline"
                          >
                            Certificate ↗
                          </a>
                        )}
                        {canDelete && (
                          <details className="relative">
                            <summary className="cursor-pointer list-none rounded border border-line px-2 py-1 text-xs text-bad hover:bg-bad/5">
                              Remove
                            </summary>
                            <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-line bg-white p-2.5 shadow-md">
                              <p className="mb-2 text-xs text-ink-2">
                                Delete {q.method} {q.level} qualification?
                              </p>
                              <form
                                action={deleteQualificationAction.bind(
                                  null,
                                  employee.id,
                                  q.id
                                )}
                              >
                                <SecondaryButton
                                  type="submit"
                                  className="w-full text-bad"
                                >
                                  Confirm delete
                                </SecondaryButton>
                              </form>
                            </div>
                          </details>
                        )}
                      </div>
                    }
                  />
                ))
              )}
            </List>
          </section>

          {canEditStaff && (
            <Card className="space-y-4">
              <SectionTitle>Add qualification / certificate</SectionTitle>
              <form
                action={addQualificationAction.bind(null, employee.id)}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Test method *">
                    <Select name="method" defaultValue="UT">
                      {TEST_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Level *">
                    <Input
                      name="level"
                      required
                      defaultValue="Level II"
                      placeholder="e.g. Level II"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Scheme">
                    <Input
                      name="scheme"
                      defaultValue="ASNT SNT-TC-1A"
                      placeholder="ASNT SNT-TC-1A / ISNT"
                    />
                  </Field>
                  <Field label="Certifying body">
                    <Input name="certifying_body" placeholder="BITA / ISNT" />
                  </Field>
                </div>

                <Field label="Certificate number">
                  <Input
                    name="certificate_no"
                    placeholder="e.g. BITA/NDT/UT-2026-04"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Issued on">
                    <Input type="date" name="issued_on" />
                  </Field>
                  <Field label="Valid until">
                    <Input type="date" name="valid_until" />
                  </Field>
                </div>

                <Field label="Certificate file (PDF / image)">
                  <input
                    type="file"
                    name="certificate_file"
                    accept=".pdf,image/*"
                    className="w-full text-xs text-ink-2 file:mr-2 file:rounded file:border file:border-line file:bg-side file:px-2.5 file:py-1 file:text-xs file:text-ink"
                  />
                </Field>

                <Button type="submit">Add qualification</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
