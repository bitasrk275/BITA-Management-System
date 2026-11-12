import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, ButtonLink, Card, ErrorNote, Field, PageHeader, SecondaryButton, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { Constants } from "@/lib/db/types";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";
import { deleteEnquiry, linkCustomer, setStatus } from "../actions";
import { CustomerSelect } from "../customer-select";
import { formatIST, SOURCE_LABEL, STATUS_LABEL } from "../labels";

export default async function EnquiryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase, person } = await requireStaff();

  const [{ data: enquiry }, canDelete] = await Promise.all([
    supabase.from("enquiries").select("*, customers(id, name)").eq("id", id).maybeSingle(),
    hasPermissionForRoles(supabase, person?.roles, "delete"),
  ]);
  if (!enquiry) notFound();

  const { data: customers } = await supabase.from("customers").select("id, name").order("name");

  // R4: suggest the customer whose contact has the same email or mobile as the sender.
  let suggested: { id: string; name: string } | null = null;
  if (!enquiry.customer_id && enquiry.from_address) {
    const { data: match } = await supabase
      .from("customer_contacts")
      .select("customers(id, name)")
      .or(`email.eq.${enquiry.from_address.replace(/[,()]/g, "")},mobile.eq.${enquiry.from_address.replace(/[,()]/g, "")}`)
      .limit(1)
      .maybeSingle();
    suggested = match?.customers ?? null;
  }

  return (
    <>
      <PageHeader
        title={enquiry.subject || "(no subject)"}
        action={
          <>
            <ButtonLink
              href={`/quotations/new?enquiry=${id}`}
              variant={enquiry.customer_id ? "secondary" : "primary"}
            >
              Draft quotation
            </ButtonLink>
            {enquiry.customer_id && <ButtonLink href={`/jobs/new?enquiry=${id}`}>Create job</ButtonLink>}
          </>
        }
      />
      <ErrorNote message={error} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge>{SOURCE_LABEL[enquiry.source]}</Badge>
        <Badge>{STATUS_LABEL[enquiry.status]}</Badge>
        <span className="text-xs text-ink-3">{formatIST(enquiry.received_at)}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Message</h2>
          <p className="text-sm text-ink-2 break-words">
            From: {[enquiry.from_name, enquiry.from_address].filter(Boolean).join(" · ") || "not given"}
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm break-words">{enquiry.body || "No details."}</p>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Customer</h2>
            {enquiry.customers && (
              <p className="mb-3 text-sm">
                Linked to{" "}
                <Link href={`/customers/${enquiry.customers.id}`} className="font-medium text-ink underline">
                  {enquiry.customers.name}
                </Link>
              </p>
            )}
            {suggested && (
              <form action={linkCustomer.bind(null, id)} className="mb-3 rounded-lg border border-wait/30 bg-wait/5 p-3 text-[13.5px]">
                <input type="hidden" name="customer_id" value={suggested.id} />
                Sender matches a contact of <strong>{suggested.name}</strong>.{" "}
                <button className="font-semibold text-ink underline">Link to this customer</button>
              </form>
            )}
            <form action={linkCustomer.bind(null, id)} className="space-y-3">
              <Field label="Link to customer">
                <CustomerSelect customers={customers ?? []} defaultValue={enquiry.customer_id} />
              </Field>
              <Button type="submit">Save</Button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Status</h2>
            <form action={setStatus.bind(null, id)} className="flex gap-2">
              <Select name="status" defaultValue={enquiry.status}>
                {Constants.public.Enums.enquiry_status.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
              <Button type="submit">Update</Button>
            </form>
          </Card>

          {canDelete && (
            <Card>
              <details>
                <summary className="cursor-pointer text-sm font-medium text-bad">
                  Delete enquiry
                </summary>
                <p className="mt-2 text-xs text-ink-3">
                  Deleting moves this enquiry to the{" "}
                  <Link href="/recycle-bin" className="underline">
                    recycle bin
                  </Link>
                  , where management can restore it at any time.
                </p>
                <form action={deleteEnquiry.bind(null, id)} className="mt-3">
                  <SecondaryButton type="submit">Confirm delete enquiry</SecondaryButton>
                </form>
              </details>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
