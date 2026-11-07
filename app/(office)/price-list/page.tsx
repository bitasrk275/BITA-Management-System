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
import { listPriceItems } from "@/lib/modules/price-items/service";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";
import { formatINR } from "../jobs/labels";
import {
  createPriceItemAction,
  deletePriceItemAction,
  updatePriceItemAction,
} from "./actions";

export const metadata = { title: "Price list – BITA" };

export default async function PriceListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string; saved?: string; deleted?: string }>;
}) {
  const { q, error, saved, deleted } = await searchParams;
  const { supabase, person } = await requireStaff();

  const [{ data: items, error: queryError }, canDelete] = await Promise.all([
    listPriceItems(supabase, { search: q }),
    hasPermissionForRoles(supabase, person?.roles, "delete"),
  ]);

  const canWrite = Boolean(
    person?.roles.some((r) => r === "management" || r === "office"),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Price list"
        subtitle="Services and standard charges with default rates, used in the invoice line dropdown. Changing an item here never changes past invoices."
        action={
          <>
            <ButtonLink href="/invoices" variant="secondary">
              Invoices
            </ButtonLink>
            <ButtonLink href="/recycle-bin?table=price_items" variant="secondary">
              Recycle bin
            </ButtonLink>
          </>
        }
      />

      <ErrorNote message={error ?? queryError ?? undefined} />
      {saved && <SavedNote />}
      {deleted && (
        <div>
          <Status tone="ok">
            Price item moved to the{" "}
            <a href="/recycle-bin?table=price_items" className="underline">
              recycle bin
            </a>
            .
          </Status>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <form className="flex flex-wrap gap-2">
            <Input
              name="q"
              type="search"
              placeholder="Search service name, description or SAC…"
              defaultValue={q}
              className="max-w-md"
            />
            <SecondaryButton type="submit">Search</SecondaryButton>
          </form>

          <List>
            {items.length === 0 ? (
              <EmptyRow>No price list items found.</EmptyRow>
            ) : (
              items.map((item) => (
                <li
                  key={item.id}
                  className="border-t border-line-2 px-4 py-3.5 first:border-t-0"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{item.name}</span>
                        {!item.active && <Badge>Inactive</Badge>}
                        {item.sac && (
                          <span className="text-xs text-ink-3">
                            SAC <Mono>{item.sac}</Mono>
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <div className="mt-0.5 text-xs text-ink-2 break-words">
                          {item.description}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-ink tabular-nums">
                        <Mono>{formatINR(Number(item.default_rate) || 0)}</Mono>
                      </div>
                      <div className="text-xs text-ink-3">per {item.unit}</div>
                    </div>
                  </div>

                  {canWrite && (
                    <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-line-2/60 pt-2.5">
                      <details className="w-full">
                        <summary className="cursor-pointer text-xs font-medium text-ink-2 underline">
                          Edit price item
                        </summary>
                        <form
                          action={updatePriceItemAction.bind(null, item.id)}
                          className="mt-3 space-y-3 rounded-md border border-line bg-surface-2/40 p-3"
                        >
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Service / item name">
                              <Input name="name" required defaultValue={item.name} />
                            </Field>
                            <Field label="Default rate (₹)">
                              <Input
                                name="default_rate"
                                type="number"
                                step="0.01"
                                min="0"
                                required
                                defaultValue={String(item.default_rate)}
                              />
                            </Field>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Unit" hint="e.g. nos, visit, day, meter">
                              <Input name="unit" defaultValue={item.unit} />
                            </Field>
                            <Field label="SAC code">
                              <Input name="sac" defaultValue={item.sac ?? ""} placeholder="998346" />
                            </Field>
                          </div>
                          <Field label="Description on invoice line">
                            <Input
                              name="description"
                              defaultValue={item.description ?? ""}
                              placeholder="Detailed service description copied onto invoice lines"
                            />
                          </Field>
                          <label className="flex items-center gap-2 text-xs text-ink-2">
                            <input
                              type="checkbox"
                              name="active"
                              defaultChecked={item.active}
                              className="h-4 w-4 rounded border-line"
                            />
                            Show in invoice line dropdown (active)
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button type="submit">Save changes</Button>
                          </div>
                        </form>
                      </details>

                      {canDelete && (
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-bad underline">
                            Delete item…
                          </summary>
                          <form
                            action={deletePriceItemAction.bind(null, item.id)}
                            className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2 p-2.5"
                          >
                            <span className="text-xs text-ink-2">
                              Move <strong>{item.name}</strong> to the recycle bin? Past invoices are unaffected.
                            </span>
                            <SecondaryButton type="submit">Confirm delete</SecondaryButton>
                          </form>
                        </details>
                      )}
                    </div>
                  )}
                </li>
              ))
            )}
          </List>
        </div>

        {canWrite && (
          <Card className="h-fit space-y-4">
            <SectionTitle>Add new price item</SectionTitle>
            <p className="text-xs text-ink-2">
              Items added here appear in the invoice line dropdown immediately. Rates can still be changed on each individual invoice.
            </p>
            <form action={createPriceItemAction} className="space-y-3">
              <Field label="Service / item name">
                <Input name="name" required placeholder="e.g. UT service" />
              </Field>
              <Field label="Description on invoice line">
                <Input
                  name="description"
                  placeholder="e.g. Ultrasonic Testing (UT) inspection charges"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Default rate (₹)">
                  <Input
                    name="default_rate"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    defaultValue="0"
                  />
                </Field>
                <Field label="Unit">
                  <Input name="unit" defaultValue="nos" placeholder="nos / visit / day" />
                </Field>
              </div>
              <Field label="SAC code (optional)">
                <Input name="sac" defaultValue="998346" placeholder="998346" />
              </Field>
              <input type="hidden" name="active" value="on" />
              <Button type="submit">Add to price list</Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
