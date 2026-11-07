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
  Mono,
  PageHeader,
  SavedNote,
  SecondaryButton,
  SectionTitle,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  getPermissionsMatrix,
  listSettings,
  listSettingsOptions,
} from "@/lib/modules/settings/service";
import {
  addDropdownOption,
  removeDropdownOption,
  toggleDropdownOption,
} from "./actions";

export const metadata = { title: "Settings – BITA" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; list?: string }>;
}) {
  const { error, saved, list } = await searchParams;
  const { supabase, person } = await requireStaff();
  const isManagement = Boolean(person?.roles.includes("management"));

  const [{ data: settings, error: settingsErr }, { data: options, error: optionsErr }, permissions] =
    await Promise.all([
      listSettings(supabase),
      listSettingsOptions(supabase, { listKey: list }),
      getPermissionsMatrix(supabase),
    ]);

  const listKeys = Array.from(new Set(options.map((o) => o.list_key))).sort();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Configure BITA system rules, dropdown lists, permissions, numbering, and users without code changes."
        action={
          <>
            <ButtonLink href="/settings/users" variant="secondary">
              Users & logins
            </ButtonLink>
            <ButtonLink href="/recycle-bin" variant="secondary">
              Recycle bin
            </ButtonLink>
          </>
        }
      />

      <ErrorNote message={error ?? settingsErr ?? optionsErr ?? undefined} />
      {saved && <SavedNote />}

      {!isManagement && (
        <div className="mb-5">
          <Status tone="wait">
            Only management can modify system settings. Office staff can manage dropdown options.
          </Status>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <SectionTitle link={{ href: "/settings/users", label: "Manage users" }}>
              Permissions overview
            </SectionTitle>
            <p className="mb-3 text-xs text-ink-3">
              Enforced in both database triggers/RLS and module services.
            </p>
            <dl className="divide-y divide-line-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                <dt className="text-ink-2">Delete & restore records</dt>
                <dd className="flex flex-wrap gap-1">
                  {permissions.delete.map((r) => (
                    <Badge key={r}>{r}</Badge>
                  ))}
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                <dt className="text-ink-2">View employee salaries</dt>
                <dd className="flex flex-wrap gap-1">
                  {permissions.view_salaries.map((r) => (
                    <Badge key={r}>{r}</Badge>
                  ))}
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                <dt className="text-ink-2">Approve inspection reports</dt>
                <dd className="flex flex-wrap gap-1">
                  {permissions.approve_reports.map((r) => (
                    <Badge key={r}>{r}</Badge>
                  ))}
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                <dt className="text-ink-2">Issue invoices</dt>
                <dd className="flex flex-wrap gap-1">
                  {permissions.issue_invoices.map((r) => (
                    <Badge key={r}>{r}</Badge>
                  ))}
                </dd>
              </div>
            </dl>
          </Card>

          <div>
            <SectionTitle>System settings keys ({settings.length})</SectionTitle>
            <List>
              {settings.length === 0 ? (
                <EmptyRow>No system settings configured yet.</EmptyRow>
              ) : (
                settings.map((s) => (
                  <li key={s.key} className="border-t border-line-2 px-4 py-3 first:border-t-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink">
                        <Mono>{s.key}</Mono>
                      </span>
                    </div>
                    {s.description && (
                      <p className="mt-0.5 text-xs text-ink-3">{s.description}</p>
                    )}
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-side p-2 font-mono text-xs text-ink-2">
                      {JSON.stringify(s.value, null, 2)}
                    </pre>
                  </li>
                ))
              )}
            </List>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-ink">Add dropdown option</h2>
            <p className="mb-3 text-xs text-ink-3">
              Dropdown options are used across report templates, equipment types, and forms.
            </p>
            <form action={addDropdownOption} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="List key" hint="e.g. couplant, surface_condition, equipment_type">
                  <Input
                    name="list_key"
                    required
                    defaultValue={list ?? "couplant"}
                    placeholder="couplant"
                  />
                </Field>
                <Field label="Display order">
                  <Input name="position" type="number" min={0} defaultValue={10} />
                </Field>
              </div>
              <Field label="Option value">
                <Input name="value" required placeholder="e.g. Ultrasonic gel" />
              </Field>
              <Button type="submit">Add option</Button>
            </form>
          </Card>

          <div>
            <SectionTitle>
              Dropdown options ({options.length})
              {listKeys.length > 0 ? ` · ${listKeys.join(", ")}` : ""}
            </SectionTitle>
            <List>
              {options.length === 0 ? (
                <EmptyRow>No dropdown options found.</EmptyRow>
              ) : (
                options.map((opt) => (
                  <li
                    key={opt.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 px-4 py-3 first:border-t-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>
                          <Mono>{opt.list_key}</Mono>
                        </Badge>
                        <span className="font-medium text-ink break-words">{opt.value}</span>
                        <Status tone={opt.active ? "ok" : "none"}>
                          {opt.active ? "Active" : "Inactive"}
                        </Status>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <form action={toggleDropdownOption.bind(null, opt.id, !opt.active)}>
                        <SecondaryButton type="submit">
                          {opt.active ? "Disable" : "Enable"}
                        </SecondaryButton>
                      </form>
                      <form action={removeDropdownOption.bind(null, opt.id)}>
                        <SecondaryButton type="submit">Remove</SecondaryButton>
                      </form>
                    </div>
                  </li>
                ))
              )}
            </List>
          </div>
        </div>
      </div>
    </>
  );
}
