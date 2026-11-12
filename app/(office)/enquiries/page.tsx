import Link from "next/link";
import { Badge, ButtonLink, PageHeader, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { Constants, type Enums } from "@/lib/db/types";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";
import { deleteEnquiry } from "./actions";
import { formatIST, SOURCE_LABEL, STATUS_LABEL } from "./labels";

export const metadata = { title: "Enquiries – BITA" };

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string; deleted?: string }>;
}) {
  const { status, source } = await searchParams;
  const { supabase, person } = await requireStaff();

  let query = supabase
    .from("enquiries")
    .select("id, source, subject, from_name, from_address, status, received_at, customers(name)")
    .order("received_at", { ascending: false })
    .limit(100);
  if (status && (Constants.public.Enums.enquiry_status as readonly string[]).includes(status))
    query = query.eq("status", status as Enums<"enquiry_status">);
  if (source && (Constants.public.Enums.enquiry_source as readonly string[]).includes(source))
    query = query.eq("source", source as Enums<"enquiry_source">);

  const [{ data: enquiries, error }, canDelete] = await Promise.all([
    query,
    hasPermissionForRoles(supabase, person?.roles, "delete"),
  ]);

  return (
    <>
      <PageHeader title="Enquiries" action={<ButtonLink href="/enquiries/new">New enquiry</ButtonLink>} />
      <form className="mb-4 grid grid-cols-2 gap-3">
        <Select name="status" defaultValue={status ?? ""}>
          <option value="">All statuses</option>
          {Constants.public.Enums.enquiry_status.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={source ?? ""}>
          <option value="">All sources</option>
          {Constants.public.Enums.enquiry_source.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </Select>
        <button className="col-span-2 rounded-md border border-line py-2 text-sm font-semibold hover:bg-side">
          Filter
        </button>
      </form>
      {error && <p className="text-sm text-ink">{error.message}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {enquiries?.map((e) => (
          <li key={e.id} className="flex flex-col justify-between sm:flex-row sm:items-center px-4 py-3 hover:bg-side">
            <Link href={`/enquiries/${e.id}`} className="block flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.subject || "(no subject)"}</span>
                <Badge>{SOURCE_LABEL[e.source]}</Badge>
                <Badge>{STATUS_LABEL[e.status]}</Badge>
              </div>
              <div className="mt-1 text-xs text-ink-3">
                {e.customers?.name ?? e.from_name ?? e.from_address ?? "Unknown sender"} · {formatIST(e.received_at)}
              </div>
            </Link>
            {canDelete && (
              <details className="mt-2 sm:mt-0 text-xs">
                <summary className="cursor-pointer font-medium text-bad hover:underline">
                  Delete…
                </summary>
                <form action={deleteEnquiry.bind(null, e.id)} className="mt-1.5 flex items-center gap-2 rounded border border-line bg-surface-2 p-2">
                  <span className="text-xs text-ink-2">Move to recycle bin?</span>
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
        {enquiries?.length === 0 && <li className="px-4 py-6 text-sm text-ink-3">No enquiries found.</li>}
      </ul>
    </>
  );
}
