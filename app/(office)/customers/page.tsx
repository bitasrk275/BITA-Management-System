import Link from "next/link";
import { Badge, ButtonLink, Input, PageHeader, Status } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { listCustomers } from "@/lib/modules/customers/service";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";
import { deleteCustomer } from "./actions";

export const metadata = { title: "Customers – BITA" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; deleted?: string }>;
}) {
  const { q, deleted } = await searchParams;
  const { supabase, person } = await requireStaff();

  const [{ data: customers, error }, canDelete] = await Promise.all([
    listCustomers(supabase, { q }),
    hasPermissionForRoles(supabase, person?.roles, "delete"),
  ]);

  return (
    <>
      <PageHeader title="Customers" action={<ButtonLink href="/customers/new">New customer</ButtonLink>} />
      {deleted && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-side px-3.5 py-2.5 text-sm">
          <Status tone="info">Customer moved to the recycle bin.</Status>
          <Link href="/recycle-bin" className="text-xs font-medium text-ink underline">
            Open recycle bin
          </Link>
        </div>
      )}
      <form className="mb-4">
        <Input name="q" placeholder="Search name, code or GSTIN" defaultValue={q} />
      </form>
      {error && <p className="text-sm text-ink">{error}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {customers.map((c) => (
          <li key={c.id} className="flex flex-col justify-between sm:flex-row sm:items-center px-4 py-3 hover:bg-side">
            <Link href={`/customers/${c.id}`} className="block flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                {c.code && <Badge>{c.code}</Badge>}
                {c.uses_proforma && <Badge>Proforma</Badge>}
              </div>
              <div className="mt-1 text-xs text-ink-3">
                {c.gstin ?? "GSTIN not given"} · {c.contact_count} contacts
              </div>
            </Link>
            {canDelete && (
              <details className="mt-2 sm:mt-0 text-xs">
                <summary className="cursor-pointer font-medium text-bad hover:underline">
                  Delete…
                </summary>
                <form action={deleteCustomer.bind(null, c.id)} className="mt-1.5 flex items-center gap-2 rounded border border-line bg-surface-2 p-2">
                  <span className="text-xs text-ink-2">Recycle bin?</span>
                  <button
                    type="submit"
                    className="rounded border border-bad bg-bad/10 px-2 py-0.5 text-xs font-semibold text-bad hover:bg-bad/20"
                  >
                    Confirm delete
                  </button>
                </form>
              </details>
            )}
          </li>
        ))}
        {customers.length === 0 && <li className="px-4 py-6 text-sm text-ink-3">No customers found.</li>}
      </ul>
    </>
  );
}
