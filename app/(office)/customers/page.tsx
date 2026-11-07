import Link from "next/link";
import { Badge, ButtonLink, Input, PageHeader, Status } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { listCustomers } from "@/lib/modules/customers/service";

export const metadata = { title: "Customers – BITA" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; deleted?: string }>;
}) {
  const { q, deleted } = await searchParams;
  const { supabase } = await requireStaff();

  const { data: customers, error } = await listCustomers(supabase, { q });

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
          <li key={c.id}>
            <Link href={`/customers/${c.id}`} className="block px-4 py-3 hover:bg-side">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                {c.code && <Badge>{c.code}</Badge>}
                {c.uses_proforma && <Badge>Proforma</Badge>}
              </div>
              <div className="mt-1 text-xs text-ink-3">
                {c.gstin ?? "GSTIN not given"} · {c.contact_count} contacts
              </div>
            </Link>
          </li>
        ))}
        {customers.length === 0 && <li className="px-4 py-6 text-sm text-ink-3">No customers found.</li>}
      </ul>
    </>
  );
}
