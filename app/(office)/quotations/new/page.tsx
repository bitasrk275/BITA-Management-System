import Link from "next/link";
import { Card, EmptyRow, ErrorNote, List, ListRow, Mono, PageHeader, SectionTitle } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { resolveEnquiryAttention } from "../../jobs/closure";
import { formatINR } from "../../jobs/labels";
import { createQuotation } from "../actions";
import { formatDateIN, QUOTATION_STATUS_LABEL } from "../labels";
import { quotationFormOptions } from "../options";
import { QuotationForm } from "../quotation-form";

export const metadata = { title: "New quotation – BITA" };

// Opened from an enquiry as /quotations/new?enquiry=<id> or customer as /quotations/new?customer=<id>.
export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; enquiry?: string; customer?: string }>;
}) {
  const { error, enquiry: enquiryId, customer: customerIdParam } = await searchParams;
  const { supabase } = await requireStaff();
  const options = await quotationFormOptions(supabase);

  let defaults: { customer_id?: string; enquiry_id?: string; subject?: string; attention?: string } | undefined;
  if (enquiryId) {
    const { data: enquiry } = await supabase
      .from("enquiries")
      .select("id, customer_id, subject, from_name, from_address")
      .eq("id", enquiryId)
      .maybeSingle();
    if (enquiry) {
      const resolvedCustomerId = enquiry.customer_id ?? customerIdParam ?? undefined;
      const { data: contacts } = resolvedCustomerId
        ? await supabase
            .from("customer_contacts")
            .select("name, email, mobile")
            .eq("customer_id", resolvedCustomerId)
            .order("name")
        : { data: [] };

      defaults = {
        enquiry_id: enquiry.id,
        customer_id: resolvedCustomerId,
        subject: enquiry.subject ?? undefined,
        attention: resolveEnquiryAttention(enquiry, contacts ?? []),
      };
    }
  } else if (customerIdParam) {
    const { data: contacts } = await supabase
      .from("customer_contacts")
      .select("name")
      .eq("customer_id", customerIdParam)
      .order("name")
      .limit(1);
    defaults = {
      customer_id: customerIdParam,
      attention: contacts?.[0]?.name ?? undefined,
    };
  }

  const targetCustomerId = defaults?.customer_id;
  const { data: pastItems } = await supabase
    .from("quotation_items")
    .select(
      "id, description, basis, rate, minimum_charge, quotations!inner(id, ref_no, quote_date, status, customer_id, customers(name))",
    )
    .order("position", { ascending: true })
    .limit(15);

  const sortedPastItems = (pastItems ?? []).sort((a, b) => {
    const aMatch = targetCustomerId && a.quotations.customer_id === targetCustomerId ? 0 : 1;
    const bMatch = targetCustomerId && b.quotations.customer_id === targetCustomerId ? 0 : 1;
    return aMatch - bMatch;
  });

  return (
    <>
      <PageHeader
        title="New quotation"
        subtitle="Upload the quotation prepared by BITA (PDF or Word, up to 6 MB) and enter the quoted items, rates and total."
      />
      <ErrorNote message={error} />

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Card>
          <QuotationForm
            action={createQuotation}
            defaults={defaults}
            includeFirstItem
            submitLabel="Create quotation"
            {...options}
          />
        </Card>

        <div>
          <SectionTitle>Past quoted rates</SectionTitle>
          <List>
            {sortedPastItems.length > 0 ? (
              sortedPastItems.map((it) => (
                <ListRow
                  key={it.id}
                  title={it.description}
                  detail={
                    <>
                      <Link href={`/quotations/${it.quotations.id}`} className="underline">
                        <Mono>{it.quotations.ref_no ?? "Draft"}</Mono>
                      </Link>
                      {" · "}
                      {it.quotations.customers?.name}
                      {" · "}
                      {formatDateIN(it.quotations.quote_date)} ({QUOTATION_STATUS_LABEL[it.quotations.status]})
                    </>
                  }
                  action={
                    <div className="text-right">
                      <Mono>{formatINR(it.rate)}</Mono>
                      {it.basis ? <span className="ml-1 text-xs text-ink-3">{it.basis}</span> : null}
                      {it.minimum_charge ? (
                        <div className="text-xs text-ink-3">min {formatINR(it.minimum_charge)}</div>
                      ) : null}
                    </div>
                  }
                />
              ))
            ) : (
              <EmptyRow>No past quotation items recorded yet.</EmptyRow>
            )}
          </List>
        </div>
      </div>
    </>
  );
}
