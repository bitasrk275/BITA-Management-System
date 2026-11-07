import Link from "next/link";
import { notFound } from "next/navigation";
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
  ListRow,
  Mono,
  PageHeader,
  SavedNote,
  SecondaryButton,
  SectionTitle,
  Select,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { Constants } from "@/lib/db/types";
import { formatIST } from "../../enquiries/labels";
import { formatINR } from "../../jobs/labels";
import {
  acceptQuotation,
  addQuotationItem,
  deleteQuotationItem,
  markQuotationSent,
  rejectQuotation,
  reopenQuotationDraft,
  reviseQuotation,
  setQuotationStatus,
  updateQuotation,
  updateQuotationItem,
  uploadQuotationFile,
} from "../actions";
import { formatDateIN, QUOTATION_STATUS_LABEL } from "../labels";
import { quotationFormOptions } from "../options";
import { QuotationForm } from "../quotation-form";
import {
  calculateQuotationTotal,
  QUOTATION_FILE_ACCEPT,
  quotationFileName,
  quotationStatusDisplay,
} from "../upload";

export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; rate_q?: string }>;
}) {
  const { id } = await params;
  const { error, saved, rate_q } = await searchParams;
  const { supabase, person } = await requireStaff();

  const { data: quotation } = await supabase.from("quotations").select("*").eq("id", id).maybeSingle();
  if (!quotation) notFound();

  const rateTerm = rate_q?.replace(/[,()%*]/g, " ").trim();
  let pastRatesQuery = supabase
    .from("quotation_items")
    .select(
      "id, description, basis, rate, minimum_charge, quotations!inner(id, ref_no, quote_date, status, customers(name))",
    )
    .neq("quotation_id", id)
    .order("position", { ascending: true })
    .limit(15);
  if (rateTerm) {
    pastRatesQuery = pastRatesQuery.or(`description.ilike.%${rateTerm}%,basis.ilike.%${rateTerm}%`);
  }

  const [customer, enquiry, items, approver, supersededBy, linkedJobs, pastRates, options] = await Promise.all([
    supabase.from("customers").select("*").eq("id", quotation.customer_id).maybeSingle(),
    quotation.enquiry_id
      ? supabase.from("enquiries").select("id, subject, source, status, received_at").eq("id", quotation.enquiry_id).maybeSingle()
      : null,
    supabase.from("quotation_items").select("*").eq("quotation_id", id).order("position").order("id"),
    quotation.approved_by
      ? supabase.from("people").select("id, full_name, position").eq("id", quotation.approved_by).maybeSingle()
      : null,
    quotation.superseded_by
      ? supabase.from("quotations").select("id, ref_no, status").eq("id", quotation.superseded_by).maybeSingle()
      : null,
    supabase
      .from("jobs")
      .select("id, job_no, status, scope, po_number, po_date, po_value")
      .eq("quotation_id", id)
      .order("created_at", { ascending: false }),
    pastRatesQuery,
    quotationFormOptions(supabase),
  ]);

  const uploadedFileName = quotationFileName(quotation.pdf_path);
  const statusInfo = quotationStatusDisplay(quotation);
  const totalAmount = calculateQuotationTotal(items.data ?? []);
  const isManagement = Boolean(person?.roles.includes("management"));
  const nextPosition = (items.data?.length ?? 0) + 1;

  const createJobHref = `/jobs/new?quotation=${id}&customer=${quotation.customer_id}${
    quotation.enquiry_id ? `&enquiry=${quotation.enquiry_id}` : ""
  }`;

  return (
    <>
      <PageHeader
        title={quotation.ref_no ? `Quotation ${quotation.ref_no}` : "Draft quotation"}
        action={
          <>
            {uploadedFileName && (
              <ButtonLink
                href={`/quotations/${id}/file`}
                variant={quotation.status === "accepted" ? "secondary" : "primary"}
              >
                Download quotation file
              </ButtonLink>
            )}
            {quotation.status === "accepted" ? (
              <ButtonLink href={createJobHref}>Create job</ButtonLink>
            ) : (
              <ButtonLink href={createJobHref} variant="secondary">
                Create job
              </ButtonLink>
            )}
            <ButtonLink href={`/quotations/${id}/print`} variant="secondary">
              Letterhead (fallback)
            </ButtonLink>
          </>
        }
      />

      <ErrorNote message={error} />
      {saved && <SavedNote />}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Badge>{statusInfo.label}</Badge>
        <span className="text-xs text-ink-3">
          Date: {formatDateIN(quotation.quote_date)} · Quoted total: <Mono>{formatINR(totalAmount)}</Mono>
        </span>
        {approver?.data && quotation.approved_at && (
          <Status tone="ok">
            Approved by {approver.data.full_name} ({formatIST(quotation.approved_at)})
          </Status>
        )}
      </div>

      {supersededBy?.data && (
        <div className="mb-5">
          <Status tone="wait">
            This quotation was superseded by{" "}
            <Link href={`/quotations/${supersededBy.data.id}`} className="underline">
              <Mono>{supersededBy.data.ref_no ?? "revised draft"}</Mono>
            </Link>
            .
          </Status>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card className="space-y-4">
            <SectionTitle>Uploaded quotation file &amp; acceptance flow</SectionTitle>

            <div className="rounded-md border border-line-2 bg-surface-2 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-ink-3">Quotation document (PDF / Word)</div>
                  {uploadedFileName ? (
                    <div className="mt-0.5 font-medium text-ink">
                      <a href={`/quotations/${id}/file`} className="underline">
                        {uploadedFileName}
                      </a>
                    </div>
                  ) : (
                    <div className="mt-0.5 text-ink-3">No quotation file uploaded yet.</div>
                  )}
                </div>
                {uploadedFileName && (
                  <ButtonLink href={`/quotations/${id}/file`} variant="secondary" size="sm">
                    Download file
                  </ButtonLink>
                )}
              </div>

              <form
                action={uploadQuotationFile.bind(null, id)}
                className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-2 pt-3"
              >
                <Input name="pdf_file" type="file" accept={QUOTATION_FILE_ACCEPT} required className="w-full max-w-xs" />
                <SecondaryButton type="submit">
                  {uploadedFileName ? "Replace quotation file" : "Upload quotation file"}
                </SecondaryButton>
              </form>
            </div>

            <div className="space-y-3 border-t border-line-2 pt-3">
              <div className="text-xs text-ink-2">
                Workflow: <strong>Draft</strong> → <strong>Sent to customer</strong> (records send after BITA emails it)
                → <strong>Accepted by customer</strong> or <strong>Rejected</strong> → <strong>Create job</strong>.
              </div>

              {quotation.status === "accepted" && (
                <div className="space-y-3 rounded-md border border-line-2 bg-surface-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Status tone="ok">Accepted by customer — ready to create the job and start work.</Status>
                    {linkedJobs.data && linkedJobs.data.length > 0 ? (
                      <ButtonLink href={`/jobs/${linkedJobs.data[0]!.id}`}>
                        Open Job {linkedJobs.data[0]!.job_no}
                      </ButtonLink>
                    ) : (
                      <ButtonLink href={createJobHref}>Create job</ButtonLink>
                    )}
                  </div>
                  {isManagement && (
                    <details className="border-t border-line-2 pt-2">
                      <summary className="cursor-pointer text-xs font-medium text-ink underline">
                        {linkedJobs.data && linkedJobs.data.length > 0
                          ? "Record or update Customer PO on linked job"
                          : "Record Customer PO & create job in one click"}
                      </summary>
                      <form action={acceptQuotation.bind(null, id)} className="mt-3 space-y-3">
                        <input type="hidden" name="create_job" value="on" />
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field label="PO number (opt.)">
                            <Input
                              name="po_number"
                              defaultValue={linkedJobs.data?.[0]?.po_number ?? ""}
                              placeholder="e.g. PO/2026/104"
                            />
                          </Field>
                          <Field label="PO date (opt.)">
                            <Input
                              name="po_date"
                              type="date"
                              defaultValue={linkedJobs.data?.[0]?.po_date ?? ""}
                            />
                          </Field>
                          <Field label="PO value ₹ (opt.)">
                            <Input
                              name="po_value"
                              type="number"
                              step="0.01"
                              min="0"
                              defaultValue={linkedJobs.data?.[0]?.po_value ?? ""}
                              placeholder="0.00"
                            />
                          </Field>
                        </div>
                        <Field label="Customer PO file (PDF or image, opt.)">
                          <Input name="po_file" type="file" accept=".pdf,image/*" />
                        </Field>
                        <Button type="submit">
                          {linkedJobs.data && linkedJobs.data.length > 0
                            ? "Save Customer PO"
                            : "Save PO & Create Job"}
                        </Button>
                      </form>
                    </details>
                  )}
                </div>
              )}

              {statusInfo.isRejected && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-2 bg-surface-2 p-3">
                  <Status tone="bad">Rejected by customer.</Status>
                  <div className="flex flex-wrap gap-2">
                    <form action={reopenQuotationDraft.bind(null, id)}>
                      <SecondaryButton type="submit">
                        Reopen as draft
                      </SecondaryButton>
                    </form>
                    {isManagement && (
                      <form action={reviseQuotation.bind(null, id)}>
                        <SecondaryButton type="submit">
                          Create revised quotation
                        </SecondaryButton>
                      </form>
                    )}
                  </div>
                </div>
              )}

              {isManagement ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {(quotation.status === "draft" || quotation.status === "approved") && (
                      <form action={markQuotationSent.bind(null, id)}>
                        <Button type="submit">Sent to customer</Button>
                      </form>
                    )}

                    {!statusInfo.isRejected && quotation.status !== "superseded" && (
                      <form action={rejectQuotation.bind(null, id)}>
                        <SecondaryButton type="submit">Rejected</SecondaryButton>
                      </form>
                    )}

                    <form action={reviseQuotation.bind(null, id)}>
                      <SecondaryButton type="submit">Create revised quotation (R11)</SecondaryButton>
                    </form>
                  </div>

                  {(quotation.status === "sent" ||
                    quotation.status === "approved" ||
                    quotation.status === "draft") && (
                    <form
                      action={acceptQuotation.bind(null, id)}
                      className="space-y-3 rounded-md border border-line-2 bg-surface-2/60 p-3"
                    >
                      <div className="text-xs font-semibold text-ink">
                        Customer Acceptance &amp; PO (optional — work can start before PO arrives)
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="PO number">
                          <Input name="po_number" placeholder="e.g. PO/2026/104" />
                        </Field>
                        <Field label="PO date">
                          <Input name="po_date" type="date" />
                        </Field>
                        <Field label="PO value (₹)">
                          <Input
                            name="po_value"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={totalAmount > 0 ? String(totalAmount) : "0.00"}
                          />
                        </Field>
                      </div>
                      <Field label="PO file (PDF or image)">
                        <Input name="po_file" type="file" accept=".pdf,image/*" />
                      </Field>
                      <label className="flex items-center gap-2 text-xs text-ink-2">
                        <input
                          type="checkbox"
                          name="create_job"
                          defaultChecked
                          className="h-4 w-4 rounded border-line"
                        />
                        Create linked job (<Mono>BITA/YY-YY/0001</Mono>) immediately on acceptance
                      </label>
                      <div>
                        {quotation.status === "sent" ? (
                          <Button type="submit">Accepted by customer</Button>
                        ) : (
                          <SecondaryButton type="submit">Accepted by customer</SecondaryButton>
                        )}
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <Status tone="wait">
                  Your account does not have the management role, so you can upload files and draft items but cannot
                  approve or mark quotations sent/accepted.
                </Status>
              )}

              {isManagement && (
                <form action={setQuotationStatus.bind(null, id)} className="flex flex-wrap items-center gap-2 pt-1">
                  <Select
                    name="status"
                    defaultValue={statusInfo.isRejected ? "rejected" : quotation.status}
                  >
                    {Constants.public.Enums.quotation_status.map((s) => (
                      <option key={s} value={s}>
                        {QUOTATION_STATUS_LABEL[s]}
                      </option>
                    ))}
                    <option value="rejected">Rejected</option>
                  </Select>
                  <SecondaryButton type="submit">
                    Update status
                  </SecondaryButton>
                </form>
              )}
            </div>
          </Card>

          <Card className="space-y-2">
            <SectionTitle>Customer &amp; enquiry</SectionTitle>
            {customer.data && (
              <div className="text-sm">
                <Link href={`/customers/${customer.data.id}`} className="font-medium underline">
                  {customer.data.name}
                </Link>
                {customer.data.billing_address && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-ink-2 break-words">{customer.data.billing_address}</p>
                )}
                <p className="mt-1 text-xs text-ink-3">
                  {[
                    customer.data.gstin ? `GSTIN ${customer.data.gstin}` : null,
                    quotation.attention ? `Attn: ${quotation.attention}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            )}
            <div className="pt-2 text-sm">
              <span className="text-ink-3">Enquiry: </span>
              {enquiry?.data ? (
                <>
                  <Link href={`/enquiries/${enquiry.data.id}`} className="underline">
                    {enquiry.data.subject ?? "(no subject)"}
                  </Link>
                  <span className="ml-2 text-xs text-ink-3">({enquiry.data.status})</span>
                </>
              ) : (
                "None"
              )}
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>Priced items, rates &amp; total (R9)</SectionTitle>
              <div className="text-xs text-ink-2">
                Total: <strong className="text-ink"><Mono>{formatINR(totalAmount)}</Mono></strong>
              </div>
            </div>
            <ul className="space-y-4">
              {items.data?.map((it) => (
                <li key={it.id} className="border-b border-line-2 pb-4 last:border-0">
                  <details>
                    <summary className="cursor-pointer">
                      <Mono>#{it.position}</Mono> <span className="text-sm font-medium">{it.description}</span>
                      <div className="mt-0.5 text-xs text-ink-2">
                        <Mono>{formatINR(it.rate)}</Mono> {it.basis ? <span>({it.basis})</span> : null}
                        {it.minimum_charge ? ` · Minimum charge: ${formatINR(it.minimum_charge)}` : ""}
                        {it.notes ? ` · ${it.notes}` : ""}
                      </div>
                    </summary>
                    <form action={updateQuotationItem.bind(null, id, it.id)} className="mt-3 space-y-3">
                      <ItemFields item={it} />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit">Save item</Button>
                        <SecondaryButton formAction={deleteQuotationItem.bind(null, id, it.id)}>
                          Remove
                        </SecondaryButton>
                      </div>
                    </form>
                  </details>
                </li>
              ))}
              {items.data?.length === 0 && (
                <li className="text-sm text-ink-3">
                  No items added yet. Add the component and inspection rates below.
                </li>
              )}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
              <span className="font-medium text-ink-2">Quoted total (before GST)</span>
              <strong className="text-ink"><Mono>{formatINR(totalAmount)}</Mono></strong>
            </div>

            <details className="pt-2" open={(items.data?.length ?? 0) === 0}>
              <summary className="cursor-pointer text-sm font-semibold underline">Add a priced item</summary>
              <form action={addQuotationItem.bind(null, id)} className="mt-3 space-y-3">
                <ItemFields defaultPosition={nextPosition} />
                <Button type="submit">Add item</Button>
              </form>
            </details>
          </Card>

          <div>
            <SectionTitle>Jobs covered by this quotation (R13)</SectionTitle>
            <List>
              {linkedJobs.data?.map((j) => (
                <ListRow
                  key={j.id}
                  tone="info"
                  title={
                    <Link href={`/jobs/${j.id}`} className="underline">
                      <Mono>{j.job_no}</Mono>
                    </Link>
                  }
                  detail={[j.status, j.scope].filter(Boolean).join(" · ")}
                />
              ))}
              {linkedJobs.data?.length === 0 && <EmptyRow>No jobs linked to this quotation yet.</EmptyRow>}
            </List>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Edit quotation details</SectionTitle>
            <QuotationForm
              action={updateQuotation.bind(null, id)}
              quotation={quotation}
              submitLabel="Save changes"
              {...options}
            />
          </Card>

          <div>
            <SectionTitle>Search past rates (R9)</SectionTitle>
            <form className="mb-3 flex gap-2">
              <Input name="rate_q" placeholder="Component, method or basis…" defaultValue={rate_q} />
              <SecondaryButton type="submit">Search</SecondaryButton>
            </form>
            <List>
              {pastRates.data?.map((it) => (
                <ListRow
                  key={it.id}
                  title={it.description}
                  detail={
                    <>
                      <Link href={`/quotations/${it.quotations.id}`} className="underline">
                        <Mono>{it.quotations.ref_no ?? "Draft"}</Mono>
                      </Link>
                      {" · "}
                      {it.quotations.customers?.name} · {formatDateIN(it.quotations.quote_date)}
                    </>
                  }
                  action={
                    <div className="text-right">
                      <Mono>{formatINR(it.rate)}</Mono>
                      {it.basis ? <span className="ml-1 text-xs text-ink-3">{it.basis}</span> : null}
                      {it.minimum_charge ? (
                        <div className="text-xs text-ink-3">Min {formatINR(it.minimum_charge)}</div>
                      ) : null}
                    </div>
                  }
                />
              ))}
              {pastRates.data?.length === 0 && <EmptyRow>No matching past items found.</EmptyRow>}
            </List>
          </div>
        </div>
      </div>
    </>
  );
}

function ItemFields({
  item,
  defaultPosition = 1,
}: {
  item?: {
    position: number;
    description: string;
    basis: string | null;
    rate: number | null;
    minimum_charge: number | null;
    notes: string | null;
  };
  defaultPosition?: number;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
        <Field label="Sl. No.">
          <Input name="position" type="number" min="1" required defaultValue={item?.position ?? defaultPosition} />
        </Field>
        <Field label="Component / inspection description">
          <Input
            name="description"
            required
            placeholder="Ultrasonic testing of forged shafts"
            defaultValue={item?.description ?? ""}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Rate (INR)">
          <Input name="rate" type="number" step="0.01" min="0" defaultValue={item?.rate ?? ""} />
        </Field>
        <Field label="Basis" hint="e.g. per shaft, per ring, per visit">
          <Input name="basis" placeholder="per shaft" defaultValue={item?.basis ?? ""} />
        </Field>
        <Field label="Minimum charge (INR)">
          <Input name="minimum_charge" type="number" step="0.01" min="0" defaultValue={item?.minimum_charge ?? ""} />
        </Field>
      </div>
      <Field label="Notes">
        <Input name="notes" placeholder="Optional item note or conveyance detail" defaultValue={item?.notes ?? ""} />
      </Field>
    </>
  );
}
