import Link from "next/link";
import {
  Badge,
  ButtonLink,
  EmptyRow,
  ErrorNote,
  List,
  PageHeader,
  SecondaryButton,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  SOFT_DELETE_TABLES,
  isSoftDeleteTable,
  listRecycleBin,
  type SoftDeleteTable,
} from "@/lib/modules/recycle-bin/service";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";
import { restoreRecycleBinItem } from "./actions";

export const metadata = { title: "Recycle bin – BITA" };

const TABLE_LABELS: Record<SoftDeleteTable, string> = {
  customers: "Customer",
  enquiries: "Enquiry",
  quotations: "Quotation",
  jobs: "Job",
  people: "Person",
  equipment: "Equipment",
};

function formatIst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function RecycleBinPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; error?: string; restored?: string }>;
}) {
  const { table, error, restored } = await searchParams;
  const { supabase, person } = await requireStaff();

  const selectedTable = table && isSoftDeleteTable(table) ? table : undefined;

  const [{ data: items, error: queryError }, canRestore] = await Promise.all([
    listRecycleBin(supabase, { table: selectedTable }),
    hasPermissionForRoles(supabase, person?.roles, "delete"),
  ]);

  return (
    <>
      <PageHeader
        title="Recycle bin"
        subtitle="Deleted records are kept safely and can be restored by management."
        action={
          <ButtonLink href="/settings" variant="secondary">
            Settings
          </ButtonLink>
        }
      />

      <ErrorNote message={error ?? queryError ?? undefined} />
      {restored && (
        <div className="mb-5">
          <Status tone="ok">Record restored.</Status>
        </div>
      )}

      {!canRestore && (
        <div className="mb-5">
          <Status tone="wait">
            Only management (or roles permitted in Settings) can restore deleted records.
          </Status>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/recycle-bin"
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            !selectedTable
              ? "border-ink bg-ink text-white"
              : "border-line bg-white text-ink-2 hover:bg-side"
          }`}
        >
          All ({items.length})
        </Link>
        {SOFT_DELETE_TABLES.map((t) => (
          <Link
            key={t}
            href={`/recycle-bin?table=${t}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              selectedTable === t
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-ink-2 hover:bg-side"
            }`}
          >
            {TABLE_LABELS[t]}s
          </Link>
        ))}
      </div>

      <List>
        {items.length === 0 ? (
          <EmptyRow>The recycle bin is empty.</EmptyRow>
        ) : (
          items.map((item) => (
            <li
              key={`${item.table_name}:${item.record_id}`}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 px-4 py-3.5 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{TABLE_LABELS[item.table_name]}</Badge>
                  <span className="font-medium text-ink break-words">{item.label}</span>
                </div>
                <div className="mt-1 text-xs text-ink-3 break-words">
                  {item.detail} · Deleted {formatIst(item.deleted_at)}
                  {item.deleted_by_name ? ` by ${item.deleted_by_name}` : ""}
                </div>
              </div>

              {canRestore && (
                <form action={restoreRecycleBinItem.bind(null, item.table_name, item.record_id)}>
                  <SecondaryButton type="submit">Restore</SecondaryButton>
                </form>
              )}
            </li>
          ))
        )}
      </List>
    </>
  );
}
