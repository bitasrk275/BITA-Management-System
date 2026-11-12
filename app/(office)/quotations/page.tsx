import Link from "next/link";
import {
  Badge,
  ButtonLink,
  EmptyRow,
  ErrorNote,
  Input,
  List,
  ListRow,
  Mono,
  PageHeader,
  SecondaryButton,
  SectionTitle,
  Select,
  type Tone,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { Constants, type Enums } from "@/lib/db/types";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";
import { formatINR } from "../jobs/labels";
import { deleteQuotation } from "./actions";
import { formatDateIN, QUOTATION_STATUS_LABEL } from "./labels";
import { calculateQuotationTotal, quotationFileName, quotationStatusDisplay } from "./upload";

export const metadata = { title: "Quotations – BITA" };

const STATUS_TONE: Record<Enums<"quotation_status">, Tone> = {
  draft: "wait",
  approved: "info",
  sent: "info",
  accepted: "ok",
  superseded: "none",
};

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; rate?: string; deleted?: string }>;
}) {
  const { q, status, rate } = await searchParams;
  const { supabase, person } = await requireStaff();

  let query = supabase
    .from("quotations")
    .select(
      "id, ref_no, customer_id, enquiry_id, quote_date, subject, attention, status, approved_at, pdf_path, superseded_by, customers(name), quotation_items(id, description, basis, rate, minimum_charge)",
    )
    .order("quote_date", { ascending: false })
    .limit(100);

  if (status && (Constants.public.Enums.quotation_status as readonly string[]).includes(status)) {
    query = query.eq("status", status as Enums<"quotation_status">);
  }

  // Commas and brackets have a meaning in the filter syntax, so they are dropped from the search text.
  const term = q?.replace(/[,()%*]/g, " ").trim();
  if (term) {
    query = query.or(`ref_no.ilike.%${term}%,subject.ilike.%${term}%,attention.ilike.%${term}%`);
  }

  // R9: Previous quotations and their rates must be searchable for reference.
  const rateTerm = (rate ?? q)?.replace(/[,()%*]/g, " ").trim();
  let itemQuery = supabase
    .from("quotation_items")
    .select(
      "id, description, basis, rate, minimum_charge, notes, quotations!inner(id, ref_no, quote_date, status, customers(name))",
    )
    .order("position", { ascending: true })
    .limit(40);
  if (rateTerm) {
    itemQuery = itemQuery.or(`description.ilike.%${rateTerm}%,basis.ilike.%${rateTerm}%,notes.ilike.%${rateTerm}%`);
  }

  const [{ data: quotations, error }, { data: pastItems }, canDelete] = await Promise.all([
    query,
    itemQuery,
    hasPermissionForRoles(supabase, person?.roles, "delete"),
  ]);

  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle="Uploaded quotations, priced items & total, customer acceptance, and past rates."
        action={<ButtonLink href="/quotations/new">Upload / new quotation</ButtonLink>}
      />

      <form className="mb-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Input name="q" placeholder="Search Ref. No., subject or attention" defaultValue={q} />
        <Input name="rate" placeholder="Search past item rates (component, method, basis)" defaultValue={rate} />
        <Select name="status" defaultValue={status ?? ""}>
          <option value="">All statuses</option>
          {Constants.public.Enums.quotation_status.map((s) => (
            <option key={s} value={s}>
              {QUOTATION_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <SecondaryButton type="submit">Filter</SecondaryButton>
      </form>

      <ErrorNote message={error?.message} />

      {(rateTerm || (pastItems && pastItems.length > 0)) && (
        <div className="mb-6">
          <SectionTitle>
            {rateTerm ? `Past rates matching "${rateTerm}"` : "Recent quoted rates"}
          </SectionTitle>
          <List>
            {pastItems && pastItems.length > 0 ? (
              pastItems.map((it) => (
                <ListRow
                  key={it.id}
                  tone={STATUS_TONE[it.quotations.status]}
                  title={
                    <>
                      {it.description}
                      {it.notes ? ` (${it.notes})` : ""}
                    </>
                  }
                  detail={
                    <>
                      <Link href={`/quotations/${it.quotations.id}`} className="underline">
                        <Mono>{it.quotations.ref_no ?? "Draft"}</Mono>
                      </Link>
                      {" · "}
                      {it.quotations.customers?.name ?? "Customer"}
                      {" · "}
                      {formatDateIN(it.quotations.quote_date)}
                      {" · "}
                      {QUOTATION_STATUS_LABEL[it.quotations.status]}
                    </>
                  }
                  action={
                    <div className="text-right">
                      <Mono>{formatINR(it.rate)}</Mono>
                      {it.basis ? <span className="ml-1 text-xs text-ink-3">{it.basis}</span> : null}
                      {it.minimum_charge ? (
                        <div className="text-xs text-ink-3">Min. {formatINR(it.minimum_charge)}</div>
                      ) : null}
                    </div>
                  }
                />
              ))
            ) : (
              <EmptyRow>No past quoted items matched this search.</EmptyRow>
            )}
          </List>
        </div>
      )}

      <SectionTitle>All quotations</SectionTitle>
      <List>
        {quotations?.map((qt) => {
          const statusInfo = quotationStatusDisplay(qt);
          const total = calculateQuotationTotal(qt.quotation_items);
          const fileName = quotationFileName(qt.pdf_path);
          return (
            <ListRow
              key={qt.id}
              tone={statusInfo.tone}
              title={
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/quotations/${qt.id}`} className="hover:underline">
                    <Mono>{qt.ref_no ?? "Draft"}</Mono>
                  </Link>
                  <span>{qt.customers?.name}</span>
                  <Badge>{statusInfo.label}</Badge>
                  {total > 0 && (
                    <span className="text-xs text-ink-2">
                      Total: <Mono>{formatINR(total)}</Mono>
                    </span>
                  )}
                </div>
              }
              detail={
                <>
                  {[
                    formatDateIN(qt.quote_date),
                    qt.subject,
                    qt.attention ? `Attn: ${qt.attention}` : null,
                    `${qt.quotation_items.length} item(s)`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {fileName && (
                    <>
                      {" · "}
                      <a href={`/quotations/${qt.id}/file`} className="underline">
                        {fileName}
                      </a>
                    </>
                  )}
                  {qt.quotation_items.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {qt.quotation_items.slice(0, 3).map((it) => (
                        <span key={it.id}>
                          {it.description}: <Mono>{formatINR(it.rate)}</Mono> {it.basis ?? ""}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              }
              action={
                <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                  {qt.status === "accepted" && (
                    <ButtonLink
                      href={`/jobs/new?quotation=${qt.id}&customer=${qt.customer_id}${
                        qt.enquiry_id ? `&enquiry=${qt.enquiry_id}` : ""
                      }`}
                      size="sm"
                    >
                      Create job
                    </ButtonLink>
                  )}
                  <ButtonLink href={`/quotations/${qt.id}`} variant="secondary" size="sm">
                    Open
                  </ButtonLink>
                  {canDelete && (
                    <details className="text-right text-xs">
                      <summary className="cursor-pointer font-medium text-bad hover:underline">
                        Delete…
                      </summary>
                      <form
                        action={deleteQuotation.bind(null, qt.id)}
                        className="mt-1 flex items-center justify-end gap-2 rounded border border-line bg-surface-2 p-1.5"
                      >
                        <span className="text-xs text-ink-2">Recycle bin?</span>
                        <button
                          type="submit"
                          className="rounded border border-bad bg-bad/10 px-2 py-0.5 text-xs font-semibold text-bad hover:bg-bad/20"
                        >
                          Confirm
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              }
            />
          );
        })}
        {quotations?.length === 0 && <EmptyRow>No quotations found.</EmptyRow>}
      </List>
    </>
  );
}
