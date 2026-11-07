import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyRow,
  ErrorNote,
  Field,
  Input,
  List,
  Mono,
  PageHeader,
  SavedNote,
  SecondaryButton,
  SectionTitle,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { Constants, type Enums } from "@/lib/db/types";
import { homeFor, roleLabel } from "@/lib/roles";
import { createPerson, unlinkPersonLogin, updatePerson } from "./actions";

export const metadata = { title: "Users & logins – BITA" };

const ROLE_DESCRIPTION: Record<Enums<"app_role">, string> = {
  management: "Management — full access, approves quotations, manages registers & users",
  office: "Office — enquiries, quotations, jobs, scheduling & POs",
  reviewer: "Technical reviewer — reviews and approves inspection reports",
  technician: "Technician — sees only own assigned jobs, enters readings & photos (no prices)",
};

export default async function SettingsUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; note?: string }>;
}) {
  const { error, saved, note } = await searchParams;
  const { supabase, person: currentPerson } = await requireStaff();

  const isManagement = Boolean(currentPerson?.roles.includes("management"));
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: people, error: queryError } = await supabase
    .from("people")
    .select("id, full_name, initials, position, mobile, email, user_id, roles, active, created_at")
    .order("active", { ascending: false })
    .order("full_name", { ascending: true });

  return (
    <>
      <PageHeader
        title="Users & logins"
        subtitle="Manage BITA staff and technicians, assign roles, and link login emails (D-015)."
      />

      <ErrorNote message={error ?? queryError?.message} />
      {saved && <SavedNote />}
      {note && (
        <div className="mb-5">
          <Status tone="info">{note}</Status>
        </div>
      )}

      {!isManagement && (
        <div className="mb-5">
          <Status tone="wait">
            Only management can add people, change roles, or link login emails.
          </Status>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div>
          <SectionTitle>All people ({people?.length ?? 0})</SectionTitle>
          <List>
            {(people ?? []).length === 0 ? (
              <EmptyRow>No people records found.</EmptyRow>
            ) : (
              (people ?? []).map((p) => {
                const loginTone = !p.active
                  ? "bad"
                  : p.user_id
                    ? "ok"
                    : p.email
                      ? "wait"
                      : "none";
                const loginText = !p.active
                  ? "Inactive"
                  : p.user_id
                    ? "Login linked"
                    : p.email
                      ? "Email set · login not linked"
                      : "No login";

                return (
                  <li key={p.id} className="border-t border-line-2 px-4 py-3.5 first:border-t-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <Avatar name={p.full_name} />
                        <div className="min-w-0 flex-1 break-words">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink">{p.full_name}</span>
                            {p.initials && (
                              <Badge>
                                <Mono>{p.initials}</Mono>
                              </Badge>
                            )}
                            <Status tone={loginTone}>{loginText}</Status>
                          </div>
                          <div className="mt-0.5 text-[12.5px] text-ink-3">
                            {[
                              p.position,
                              p.roles.length > 0 ? roleLabel(p.roles) : "No roles assigned",
                              p.roles.length > 0 ? `Home: ${homeFor(p.roles)}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                          <div className="mt-0.5 text-[12.5px] text-ink-3">
                            {[p.email, p.mobile].filter(Boolean).join(" · ") || "No email or mobile set"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {isManagement && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-[13px] font-medium text-ink-2 hover:text-ink">
                          Edit roles, details or login
                        </summary>
                        <form
                          action={updatePerson.bind(null, p.id)}
                          className="mt-3 space-y-3.5 border-t border-line-2 pt-3"
                        >
                          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                            <Field label="Full name *">
                              <Input name="full_name" required defaultValue={p.full_name} />
                            </Field>
                            <Field label="Initials">
                              <Input name="initials" placeholder="AT" defaultValue={p.initials ?? ""} />
                            </Field>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Position / title">
                              <Input name="position" placeholder="Technical Reviewer" defaultValue={p.position ?? ""} />
                            </Field>
                            <Field label="Mobile">
                              <Input name="mobile" placeholder="+91 90000 00000" defaultValue={p.mobile ?? ""} />
                            </Field>
                          </div>

                          <div>
                            <span className="text-[13px] font-medium text-ink-2">Roles</span>
                            <div className="mt-1.5 space-y-1.5">
                              {Constants.public.Enums.app_role.map((role) => (
                                <Checkbox
                                  key={role}
                                  name="roles"
                                  value={role}
                                  defaultChecked={p.roles.includes(role)}
                                  label={ROLE_DESCRIPTION[role]}
                                />
                              ))}
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field
                              label="Login email"
                              hint="Used for signing into the BITA web app"
                            >
                              <Input
                                type="email"
                                name="email"
                                placeholder="name@bita.example"
                                defaultValue={p.email ?? ""}
                              />
                            </Field>
                            <Field
                              label="Set / reset password (optional)"
                              hint={
                                hasServiceKey
                                  ? "Min 6 characters; creates or updates the login"
                                  : "Requires SUPABASE_SERVICE_ROLE_KEY on server"
                              }
                            >
                              <Input
                                type="password"
                                name="password"
                                minLength={6}
                                placeholder="Leave blank to keep or send invite"
                              />
                            </Field>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field
                              label="Linked auth user ID (optional)"
                              hint="Populated automatically when provisioned, or paste an existing auth.users UUID"
                            >
                              <Input
                                name="user_id"
                                placeholder="00000000-0000-0000-0000-000000000000"
                                defaultValue={p.user_id ?? ""}
                              />
                            </Field>
                            <div className="flex flex-col justify-end space-y-2 pb-1">
                              <Checkbox
                                name="provision_login"
                                label="Create or link Supabase login for this email"
                              />
                              <Checkbox
                                name="active"
                                defaultChecked={p.active}
                                label="Active at BITA"
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button type="submit">Save changes</Button>
                            {p.user_id && currentPerson?.id !== p.id && (
                              <SecondaryButton
                                type="submit"
                                formAction={unlinkPersonLogin.bind(null, p.id)}
                              >
                                Unlink login
                              </SecondaryButton>
                            )}
                          </div>
                        </form>
                      </details>
                    )}
                  </li>
                );
              })
            )}
          </List>
        </div>

        {isManagement && (
          <div>
            <SectionTitle>Add a person</SectionTitle>
            <Card>
              <form action={createPerson} className="space-y-3.5">
                <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                  <Field label="Full name *">
                    <Input name="full_name" required placeholder="R. Kumar" />
                  </Field>
                  <Field label="Initials">
                    <Input name="initials" placeholder="RK" />
                  </Field>
                </div>

                <Field label="Position / title">
                  <Input name="position" placeholder="NDT Technician / Office Coordinator" />
                </Field>

                <Field label="Mobile">
                  <Input name="mobile" placeholder="+91 90000 00000" />
                </Field>

                <div>
                  <span className="text-[13px] font-medium text-ink-2">Roles</span>
                  <div className="mt-1.5 space-y-1.5">
                    {Constants.public.Enums.app_role.map((role) => (
                      <Checkbox
                        key={role}
                        name="roles"
                        value={role}
                        defaultChecked={role === "technician"}
                        label={ROLE_DESCRIPTION[role]}
                      />
                    ))}
                  </div>
                </div>

                <Field label="Login email (optional)">
                  <Input type="email" name="email" placeholder="tech@bita.example" />
                </Field>

                <Field
                  label="Initial password (optional)"
                  hint={
                    hasServiceKey
                      ? "Creates a confirmed login immediately"
                      : "Saved when SUPABASE_SERVICE_ROLE_KEY is set on the server"
                  }
                >
                  <Input type="password" name="password" minLength={6} placeholder="Min 6 characters" />
                </Field>

                <Checkbox
                  name="provision_login"
                  label="Create or link Supabase login for this email"
                />

                <Button type="submit" className="w-full">
                  Add person
                </Button>
              </form>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
