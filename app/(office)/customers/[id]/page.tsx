import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Checkbox, ErrorNote, Field, Input, PageHeader, SecondaryButton, SavedNote } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { addContact, deleteContact, updateContact, updateCustomer } from "../actions";
import { CustomerForm } from "../customer-form";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const { supabase } = await requireStaff();

  const { data: customer } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (!customer) notFound();

  const [{ data: contacts }, { data: enquiries }] = await Promise.all([
    supabase.from("customer_contacts").select("*").eq("customer_id", id).order("name"),
    supabase
      .from("enquiries")
      .select("id, subject, source, status, received_at")
      .eq("customer_id", id)
      .order("received_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <>
      <PageHeader title={customer.name} />
      <ErrorNote message={error} />
      {saved && <SavedNote />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Details</h2>
          <CustomerForm action={updateCustomer.bind(null, id)} customer={customer} submitLabel="Save changes" />
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Contacts</h2>
            <ul className="space-y-4">
              {contacts?.map((c) => (
                <li key={c.id} className="border-b border-line-2 pb-4 last:border-0">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="font-medium">{c.name}</span>{" "}
                      {c.receives_reports && <Badge>Reports</Badge>} {c.receives_invoices && <Badge>Invoices</Badge>}
                      <div className="text-xs text-ink-3 break-words">
                        {[c.mobile, c.email].filter(Boolean).join(" · ") || "No phone or email"}
                      </div>
                    </summary>
                    <form action={updateContact.bind(null, id, c.id)} className="mt-3 space-y-3">
                      <ContactFields contact={c} />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit">Save contact</Button>
                        <SecondaryButton formAction={deleteContact.bind(null, id, c.id)}>Remove</SecondaryButton>
                      </div>
                    </form>
                  </details>
                </li>
              ))}
              {contacts?.length === 0 && <li className="text-sm text-ink-3">No contacts yet.</li>}
            </ul>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-ink">Add a contact</summary>
              <form action={addContact.bind(null, id)} className="mt-3 space-y-3">
                <ContactFields />
                <Button type="submit">Add contact</Button>
              </form>
            </details>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Recent enquiries</h2>
            <ul className="space-y-2 text-sm">
              {enquiries?.map((e) => (
                <li key={e.id} className="break-words">
                  <Link href={`/enquiries/${e.id}`} className="hover:text-ink">
                    {e.subject || "(no subject)"}
                  </Link>{" "}
                  <span className="text-xs text-ink-3">
                    {e.source} · {e.status}
                  </span>
                </li>
              ))}
              {enquiries?.length === 0 && <li className="text-ink-3">No enquiries yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function ContactFields({
  contact,
}: {
  contact?: { name: string; mobile: string | null; email: string | null; notes: string | null; receives_reports: boolean; receives_invoices: boolean };
}) {
  return (
    <>
      <Field label="Name">
        <Input name="name" required defaultValue={contact?.name} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mobile">
          <Input name="mobile" type="tel" defaultValue={contact?.mobile ?? ""} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={contact?.email ?? ""} />
        </Field>
      </div>
      <Field label="Notes">
        <Input name="notes" defaultValue={contact?.notes ?? ""} />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Checkbox name="receives_reports" label="Receives reports" defaultChecked={contact?.receives_reports} />
        <Checkbox name="receives_invoices" label="Receives invoices" defaultChecked={contact?.receives_invoices} />
      </div>
    </>
  );
}
