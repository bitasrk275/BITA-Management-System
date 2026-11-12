import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
  type Tone,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { shortDate, todayIST } from "@/lib/dates";
import { formatIST } from "../../enquiries/labels";
import {
  buildInvoiceDocumentSpec,
  formatPlaceOfSupply,
} from "@/lib/invoices";
import { checkPoUtilization } from "@/lib/modules/po/service";
import { listPriceItems } from "@/lib/modules/price-items/service";
import { validUuid } from "@/lib/reports/review";
import { homeFor } from "@/lib/roles";
import { formatINR } from "../../jobs/labels";
import {
  cancelCreditNoteAction,
  cancelInvoice,
  convertProformaAction,
  issueCreditNoteAction,
  issueInvoice,
  recordPayment,
  toggleInvoiceReminders,
  updateDraftInvoice,
} from "../actions";
import {
  creditNotesTable,
  invoiceLinesTable,
  invoicesTable,
  paymentRemindersTable,
  paymentsTable,
  type CreditNoteRow,
  type InvoiceLineRow,
  type InvoiceWithRelations,
  type PaymentReminderRow,
  type PaymentRow,
} from "../db";
import { InvoiceDraftEditor } from "./invoice-draft-editor";
import { loadBitaInvoiceProfile } from "./load-template-input";

export const metadata = { title: "Invoice – BITA" };

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft · editable", tone: "wait" },
  issued: { label: "Issued · frozen", tone: "info" },
  partly_paid: { label: "Partly paid", tone: "info" },
  paid: { label: "Paid in full", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "none" },
};

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;

  if (!validUuid(id)) notFound();

  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    redirect(homeFor(person?.roles));
  }

  const [invoiceRes, linesRes, paymentsRes, creditNotesRes, remindersRes, priceItemsRes] =
    await Promise.all([
      invoicesTable(supabase)
        .select(
          "*, jobs(id, job_no, po_number, po_date, po_value, scope, status, customer_id, quotation_id, customers(id, name, code, gstin, billing_address, payment_terms_days)), reports(id, report_no, method, status), invoice_reports(report_id, reports(id, report_no, method, status, job_id, jobs(id, job_no, po_number))), quotations(id, ref_no, status)",
        )
        .eq("id", id)
        .maybeSingle() as Promise<{ data: InvoiceWithRelations | null }>,
      invoiceLinesTable(supabase)
        .select("*")
        .eq("invoice_id", id)
        .order("position", { ascending: true }) as Promise<{ data: InvoiceLineRow[] | null }>,
      paymentsTable(supabase)
        .select("*")
        .eq("invoice_id", id)
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false }) as Promise<{ data: PaymentRow[] | null }>,
      creditNotesTable(supabase)
        .select("*")
        .eq("invoice_id", id)
        .order("credit_date", { ascending: false })
        .order("created_at", { ascending: false }) as Promise<{ data: CreditNoteRow[] | null }>,
      paymentRemindersTable(supabase)
        .select("*")
        .eq("invoice_id", id)
        .order("scheduled_for", { ascending: false }) as Promise<{ data: PaymentReminderRow[] | null }>,
      listPriceItems(supabase, { activeOnly: true }),
    ]);

  const invoice = invoiceRes.data;
  if (!invoice) notFound();

  const lines = linesRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const creditNotes = creditNotesRes.data ?? [];
  const reminders = remindersRes.data ?? [];
  const priceItems = priceItemsRes.data ?? [];
  const job = invoice.jobs;
  const customer = job?.customers;
  const report = invoice.reports;
  const quotation = invoice.quotations;

  const linkedReportsMap = new Map<
    string,
    { id: string; report_no: string; method: string; job_no?: string | null; po_number?: string | null }
  >();
  for (const ir of invoice.invoice_reports ?? []) {
    if (ir.reports) {
      linkedReportsMap.set(ir.reports.id, {
        id: ir.reports.id,
        report_no: ir.reports.report_no,
        method: ir.reports.method,
        job_no: ir.reports.jobs?.job_no ?? job?.job_no,
        po_number: ir.reports.jobs?.po_number ?? null,
      });
    }
  }
  if (report && !linkedReportsMap.has(report.id)) {
    linkedReportsMap.set(report.id, {
      id: report.id,
      report_no: report.report_no,
      method: report.method,
      job_no: job?.job_no,
      po_number: job?.po_number ?? null,
    });
  }
  const linkedReports = Array.from(linkedReportsMap.values());
  const combinedReportNos =
    linkedReports.length > 0
      ? linkedReports.map((r) => r.report_no).join(", ")
      : report?.report_no ?? null;

  const isProforma = invoice.kind === "proforma";
  const isDraft = invoice.status === "draft";
  const isCancelled = invoice.status === "cancelled";
  const isIssued = ["issued", "partly_paid", "paid"].includes(invoice.status);
  const displayNo =
    invoice.invoice_no ??
    invoice.number ??
    (isProforma ? "Draft Proforma (Unissued)" : "Draft Invoice (Unissued)");
  const statusInfo = STATUS_META[invoice.status] ?? { label: invoice.status, tone: "none" as Tone };

  const [convertedTaxRes, sourceProformaRes] = await Promise.all([
    isProforma
      ? invoicesTable(supabase)
          .select("id, invoice_no, number, status")
          .eq("converted_from_id", invoice.id)
          .neq("status", "cancelled")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    invoice.converted_from_id
      ? invoicesTable(supabase)
          .select("id, invoice_no, number, status")
          .eq("id", invoice.converted_from_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const convertedTaxInvoice = convertedTaxRes.data as {
    id: string;
    invoice_no: string | null;
    number: string | null;
    status: string;
  } | null;
  const sourceProforma = sourceProformaRes.data as {
    id: string;
    invoice_no: string | null;
    number: string | null;
    status: string;
  } | null;

  const [poCheck, companyProfile] = await Promise.all([
    checkPoUtilization(supabase, {
      jobId: invoice.job_id,
      customerId: job?.customer_id,
      poNumber: invoice.customer_po_number ?? job?.po_number,
      poValue: job?.po_value,
      excludeInvoiceId: invoice.id,
      currentInvoiceTotal: isCancelled ? 0 : Number(invoice.total) || 0,
    }),
    loadBitaInvoiceProfile(supabase),
  ]);

  const spec = buildInvoiceDocumentSpec({
    kind: invoice.kind,
    status: invoice.status,
    invoiceNo: invoice.invoice_no ?? invoice.number,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    jobNo: job?.job_no,
    reportNo: combinedReportNos,
    quotationRef: quotation?.ref_no,
    poNumber: invoice.customer_po_number ?? job?.po_number,
    poDate: job?.po_date,
    customerName: customer?.name ?? "Customer",
    customerAddress: customer?.billing_address,
    customerGstin: customer?.gstin,
    placeOfSupply: invoice.place_of_supply,
    lines: lines.map((l) => ({
      position: l.position,
      description: l.description,
      sac: l.sac,
      qty: Number(l.qty) || 1,
      unit: l.unit,
      rate: Number(l.rate) || 0,
      amount: Number(l.amount) || 0,
    })),
    taxableValue: Number(invoice.taxable_value) || 0,
    cgst: Number(invoice.cgst) || 0,
    sgst: Number(invoice.sgst) || 0,
    igst: Number(invoice.igst) || 0,
    roundOff: Number(invoice.round_off) || 0,
    total: Number(invoice.total) || 0,
    notes: invoice.notes,
    profile: companyProfile,
  });

  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const totalTds = payments.reduce((sum, p) => sum + (Number(p.tds_amount) || 0), 0);
  const totalCredited = creditNotes
    .filter((cn) => cn.status === "issued")
    .reduce((sum, cn) => sum + (Number(cn.total) || 0), 0);
  const totalSettled = totalPaid + totalTds + totalCredited;
  const remainingBalance = Number(invoice.balance) || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={displayNo}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-3">
            {isProforma && <Badge>Proforma</Badge>}
            <Status tone={statusInfo.tone}>{statusInfo.label}</Status>
            <span>
              {customer?.name ?? "Customer"} · {job?.job_no ?? "Job"}
              {combinedReportNos
                ? ` · Report${linkedReports.length > 1 ? "s" : ""} ${combinedReportNos}`
                : ""}
              {invoice.invoice_date ? ` · Dated ${shortDate(invoice.invoice_date)}` : ""}
            </span>
          </span>
        }
        action={
          <>
            <ButtonLink href="/invoices" variant="secondary" size="sm">
              All invoices
            </ButtonLink>
            <ButtonLink href="/price-list" variant="secondary" size="sm">
              Price list
            </ButtonLink>
            {job && (
              <ButtonLink href={`/jobs/${job.id}`} variant="secondary" size="sm">
                Job {job.job_no}
              </ButtonLink>
            )}
            <ButtonLink href={`/invoices/${invoice.id}/docx`} variant="secondary" size="sm">
              Download Word (.docx)
            </ButtonLink>
            <ButtonLink
              href={`/invoices/${invoice.id}/pdf`}
              variant={isIssued ? "primary" : "secondary"}
              size="sm"
            >
              Download PDF
            </ButtonLink>
          </>
        }
      />

      <ErrorNote message={error} />
      {saved && <SavedNote />}
      {poCheck.exceedsPoValue && poCheck.warningMessage && (
        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <Status tone="wait">{poCheck.warningMessage}</Status>
        </div>
      )}

      {/* Workflow Actions */}
      <div className="grid gap-5 lg:grid-cols-2">
        {isDraft && (
          <Card className="space-y-4">
            <SectionTitle>
              1. Issue {isProforma ? "Proforma Invoice" : "Tax Invoice"}
            </SectionTitle>
            <p className="text-[13px] text-ink-2">
              Review the lines, quantities, rates and GST breakdown below. Clicking{" "}
              <strong className="font-medium text-ink">
                Issue {isProforma ? "proforma" : "invoice"}
              </strong>{" "}
              assigns the official{" "}
              <Mono>{isProforma ? "BITA/YY-YY/PI-0001" : "BITA/YY-YY/INV-0001"}</Mono> number and freezes the document against further edits.
              {isProforma
                ? " Proforma invoices are excluded from CA GST files and payment reminders, and can be converted to a Tax Invoice at any time."
                : ""}
            </p>
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-2/40 p-3 text-[12.5px]">
              <div>
                <dt className="text-ink-3">Place of supply</dt>
                <dd className="font-medium text-ink">{formatPlaceOfSupply(invoice.place_of_supply)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Total (incl. GST)</dt>
                <dd className="font-semibold text-ink tabular-nums">{formatINR(Number(invoice.total) || 0)}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2.5">
              <form action={issueInvoice.bind(null, invoice.id)}>
                <Button type="submit" disabled={lines.length === 0}>
                  Issue {isProforma ? "proforma" : "invoice"} (assigns number & freezes)
                </Button>
              </form>
              {isProforma &&
                (convertedTaxInvoice ? (
                  <ButtonLink href={`/invoices/${convertedTaxInvoice.id}`} variant="secondary">
                    Open tax invoice {convertedTaxInvoice.invoice_no ?? convertedTaxInvoice.number ?? "Draft"}
                  </ButtonLink>
                ) : (
                  <form action={convertProformaAction.bind(null, invoice.id)}>
                    <SecondaryButton type="submit">Convert to tax invoice</SecondaryButton>
                  </form>
                ))}
              <form action={cancelInvoice.bind(null, invoice.id)}>
                <SecondaryButton type="submit">Cancel draft</SecondaryButton>
              </form>
            </div>
          </Card>
        )}

        {isIssued && (
          <Card className="space-y-4">
            <SectionTitle>
              1. Issued {isProforma ? "Proforma Invoice" : "Tax Invoice"} (Frozen)
            </SectionTitle>
            <p className="text-[13px] text-ink-2">
              Issued on {invoice.issued_at ? formatIST(invoice.issued_at) : invoice.invoice_date ? shortDate(invoice.invoice_date) : "—"}. Content and tax totals are frozen; download the PDF or Word file to send to the customer.
              {isProforma
                ? " Proforma invoices are excluded from CA GST exports and payment reminders."
                : ""}
            </p>
            <dl className="grid grid-cols-1 gap-2 rounded-lg border border-line bg-surface-2/40 p-3 text-[12.5px] sm:grid-cols-3 sm:gap-3">
              <div>
                <dt className="text-ink-3">Invoice Total</dt>
                <dd className="font-semibold text-ink tabular-nums">{formatINR(Number(invoice.total) || 0)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Settled (Bank / TDS / CN)</dt>
                <dd className="font-medium text-ok tabular-nums">
                  {formatINR(totalSettled)}
                  {(totalTds > 0 || totalCredited > 0) && (
                    <span className="block text-[11px] font-normal text-ink-3">
                      Bank {formatINR(totalPaid)}
                      {totalTds > 0 ? ` · TDS ${formatINR(totalTds)}` : ""}
                      {totalCredited > 0 ? ` · CN ${formatINR(totalCredited)}` : ""}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Balance Due</dt>
                <dd className="font-semibold text-ink tabular-nums">{formatINR(remainingBalance)}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2.5">
              {isProforma ? (
                convertedTaxInvoice ? (
                  <ButtonLink href={`/invoices/${convertedTaxInvoice.id}`}>
                    Open tax invoice {convertedTaxInvoice.invoice_no ?? convertedTaxInvoice.number ?? "Draft"}
                  </ButtonLink>
                ) : (
                  <form action={convertProformaAction.bind(null, invoice.id)}>
                    <Button type="submit">Convert to tax invoice</Button>
                  </form>
                )
              ) : (
                <form action={toggleInvoiceReminders.bind(null, invoice.id, !invoice.reminders_paused)}>
                  <SecondaryButton type="submit">
                    {invoice.reminders_paused ? "Resume payment reminders" : "Pause payment reminders"}
                  </SecondaryButton>
                </form>
              )}
              {totalSettled === 0 && (
                <form action={cancelInvoice.bind(null, invoice.id)}>
                  <SecondaryButton type="submit">
                    Cancel {isProforma ? "proforma" : "invoice"}
                  </SecondaryButton>
                </form>
              )}
            </div>
          </Card>
        )}

        {isIssued && remainingBalance > 0 && (
          <Card className="space-y-4">
            <SectionTitle>2. Record payment &amp; TDS</SectionTitle>
            <p className="text-[13px] text-ink-2">
              Record a customer payment against this invoice. Both the bank receipt and any TDS deducted by the customer settle the remaining balance ({formatINR(remainingBalance)}).
            </p>
            <form action={recordPayment.bind(null, invoice.id)} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amount received in bank (INR)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={remainingBalance}
                    name="amount"
                    defaultValue={String(remainingBalance)}
                    required
                  />
                </Field>
                <Field label="TDS deducted by customer (INR)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={remainingBalance}
                    name="tds_amount"
                    defaultValue="0"
                  />
                </Field>
                <Field label="Payment date">
                  <Input type="date" name="paid_on" defaultValue={todayIST()} required />
                </Field>
                <Field label="Payment mode">
                  <Select name="mode" defaultValue="NEFT">
                    <option value="NEFT">NEFT</option>
                    <option value="RTGS">RTGS</option>
                    <option value="IMPS">IMPS</option>
                    <option value="UPI">UPI</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Reference / UTR / Cheque no.">
                    <Input name="reference" placeholder="e.g. UTR-HDFC0001234" />
                  </Field>
                </div>
              </div>
              <Button type="submit">Record payment</Button>
            </form>
          </Card>
        )}

        {!isProforma && isIssued && remainingBalance > 0 && (
          <Card className="space-y-4">
            <SectionTitle>3. Issue Credit Note (BITA/YY-YY/CN-0001)</SectionTitle>
            <p className="text-[13px] text-ink-2">
              Issue a credit note against this tax invoice for rate adjustments, short quantities or billing corrections. The credit note total reduces the invoice balance and is included in the CA GST export.
            </p>
            <form action={issueCreditNoteAction.bind(null, invoice.id)} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Taxable credit amount (INR)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    name="taxable_value"
                    placeholder="e.g. 1000.00"
                    required
                  />
                </Field>
                <Field label="Credit note date">
                  <Input type="date" name="credit_date" defaultValue={todayIST()} required />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Reason for credit note">
                    <Input
                      name="reason"
                      placeholder="e.g. Rate revision as per customer discussion"
                      required
                    />
                  </Field>
                </div>
              </div>
              <SecondaryButton type="submit">Issue credit note (18% GST auto-computed)</SecondaryButton>
            </form>
          </Card>
        )}

        {isCancelled && (
          <Card className="space-y-2">
            <SectionTitle>Cancelled Invoice</SectionTitle>
            <p className="text-[13px] text-ink-2">
              This invoice is cancelled and carries zero balance. You can generate a replacement invoice from the job or approved report page if needed.
            </p>
          </Card>
        )}
      </div>

      {/* Draft Editor */}
      {isDraft && (
        <Card className="space-y-4">
          <SectionTitle>2. Edit draft invoice</SectionTitle>
          <InvoiceDraftEditor
            action={updateDraftInvoice.bind(null, invoice.id)}
            invoiceDate={invoice.invoice_date ?? todayIST()}
            dueDate={invoice.due_date ?? todayIST(customer?.payment_terms_days ?? 30)}
            placeOfSupply={invoice.place_of_supply ?? "29"}
            customerPoNumber={invoice.customer_po_number ?? job?.po_number ?? ""}
            poValue={poCheck.poValue}
            otherInvoicesTotal={poCheck.otherInvoicesTotal}
            notes={invoice.notes ?? ""}
            customerGstin={customer?.gstin}
            customerAddress={customer?.billing_address}
            initialLines={lines}
            priceItems={priceItems}
          />
        </Card>
      )}

      {/* Payment History */}
      {(isIssued || payments.length > 0) && (
        <section>
          <SectionTitle>Payments received ({payments.length})</SectionTitle>
          <List>
            {payments.map((p) => {
              const bankAmt = Number(p.amount) || 0;
              const tdsAmt = Number(p.tds_amount) || 0;
              return (
                <ListRow
                  key={p.id}
                  tone="ok"
                  title={
                    <span>
                      <strong className="font-semibold text-ink tabular-nums">
                        {formatINR(bankAmt)}
                      </strong>
                      {tdsAmt > 0 && (
                        <span className="ml-2 font-medium text-ink-2 tabular-nums">
                          + TDS {formatINR(tdsAmt)} (Total settled: {formatINR(bankAmt + tdsAmt)})
                        </span>
                      )}
                      <span className="ml-2.5 text-[13px] text-ink-2">
                        via {p.mode || "Bank Transfer"}
                        {p.reference ? ` · Ref: ${p.reference}` : ""}
                      </span>
                    </span>
                  }
                  detail={`Paid on ${shortDate(p.paid_on)}`}
                />
              );
            })}
            {payments.length === 0 && (
              <EmptyRow>No payments recorded against this invoice yet.</EmptyRow>
            )}
          </List>
        </section>
      )}

      {/* Credit Notes History */}
      {(!isProforma && (isIssued || creditNotes.length > 0)) && (
        <section>
          <SectionTitle>Credit notes ({creditNotes.length})</SectionTitle>
          <List>
            {creditNotes.map((cn) => (
              <ListRow
                key={cn.id}
                tone={cn.status === "issued" ? "info" : "none"}
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Mono>{cn.credit_note_no}</Mono>
                    <strong className="font-semibold text-ink tabular-nums">
                      {formatINR(Number(cn.total) || 0)}
                    </strong>
                    <span className="text-[12.5px] text-ink-2">
                      (Taxable {formatINR(Number(cn.taxable_value) || 0)} + GST{" "}
                      {formatINR(
                        (Number(cn.cgst) || 0) +
                          (Number(cn.sgst) || 0) +
                          (Number(cn.igst) || 0),
                      )}
                      )
                    </span>
                    <Status tone={cn.status === "issued" ? "info" : "none"}>
                      {cn.status === "issued" ? "Issued" : "Cancelled"}
                    </Status>
                  </span>
                }
                detail={
                  <span className="inline-flex flex-wrap items-center gap-3">
                    <span>
                      {cn.reason} · Dated {shortDate(cn.credit_date)}
                    </span>
                    {cn.status === "issued" && (
                      <form action={cancelCreditNoteAction.bind(null, invoice.id, cn.id)}>
                        <button
                          type="submit"
                          className="text-[12px] font-medium text-ink-2 underline hover:text-ink"
                        >
                          Cancel credit note
                        </button>
                      </form>
                    )}
                  </span>
                }
              />
            ))}
            {creditNotes.length === 0 && (
              <EmptyRow>No credit notes issued against this tax invoice.</EmptyRow>
            )}
          </List>
        </section>
      )}

      {/* Email Payment Reminders History */}
      {(isIssued || reminders.length > 0) && (
        <section>
          <SectionTitle>Email payment reminders ({reminders.length})</SectionTitle>
          <List>
            {reminders.map((r) => {
              const kindLabel =
                r.kind === "before_due"
                  ? "Before due (-2 days)"
                  : r.kind === "on_due"
                    ? "On due date"
                    : "Overdue follow-up";
              return (
                <ListRow
                  key={r.id}
                  tone={r.sent_at ? "ok" : "info"}
                  title={
                    <span>
                      <strong className="font-semibold text-ink">{kindLabel}</strong>
                      <span className="ml-2.5 text-[13px] text-ink-2">
                        Scheduled for {shortDate(r.scheduled_for)}
                      </span>
                    </span>
                  }
                  detail={
                    <span>
                      To:{" "}
                      {r.sent_to && r.sent_to.length > 0
                        ? r.sent_to.join(", ")
                        : "No invoice-receiving contacts configured"}
                      {r.from_mailbox ? ` · From: ${r.from_mailbox}` : ""}
                      {" · "}
                      {r.sent_at ? `Sent ${formatIST(r.sent_at)}` : "Planned (pending email dispatch)"}
                    </span>
                  }
                />
              );
            })}
            {reminders.length === 0 && (
              <EmptyRow>
                No email reminders planned yet. Reminders trigger automatically 2 days before due date, on the due date, and daily from day +5 overdue while balance &gt; 0.
              </EmptyRow>
            )}
          </List>
        </section>
      )}

      {/* BITA Boxed Tax Invoice Preview (matching Reference Invoice 5387) */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold uppercase tracking-wider text-ink-3">{spec.title}</span>
            {job && (
              <span>
                Job:{" "}
                <Link href={`/jobs/${job.id}`} className="font-medium text-ink underline">
                  <Mono>{job.job_no}</Mono>
                </Link>
              </span>
            )}
            {linkedReports.length > 0 && (
              <span>
                Report{linkedReports.length > 1 ? "s" : ""}:{" "}
                {linkedReports.map((r, idx) => (
                  <span key={r.id}>
                    {idx > 0 ? ", " : ""}
                    <Link href={`/review/${r.id}`} className="font-medium text-ink underline">
                      <Mono>{r.report_no}</Mono>
                    </Link>
                  </span>
                ))}
              </span>
            )}
            {quotation && (
              <span>
                Quote:{" "}
                <Link href={`/quotations/${quotation.id}`} className="font-medium text-ink underline">
                  <Mono>{quotation.ref_no ?? "Quotation"}</Mono>
                </Link>
              </span>
            )}
            {sourceProforma && (
              <span>
                From Proforma:{" "}
                <Link href={`/invoices/${sourceProforma.id}`} className="font-medium text-ink underline">
                  <Mono>{sourceProforma.invoice_no ?? sourceProforma.number ?? "Proforma"}</Mono>
                </Link>
              </span>
            )}
            {convertedTaxInvoice && (
              <span>
                Tax Invoice:{" "}
                <Link href={`/invoices/${convertedTaxInvoice.id}`} className="font-medium text-ink underline">
                  <Mono>{convertedTaxInvoice.invoice_no ?? convertedTaxInvoice.number ?? "Tax Invoice"}</Mono>
                </Link>
              </span>
            )}
          </div>
          <div>Place of Supply: <strong>{spec.placeOfSupplyDisplay}</strong></div>
        </div>

        {/* Exact BITA Boxed Invoice Sheet */}
        <div className="overflow-x-auto">
          <div className="min-w-[680px] border border-neutral-800 bg-white text-[13px] text-neutral-900">
            {/* Row 1: Agency Header + B [ITA] Logo + Invoice No. / Date Box */}
            <div className="grid grid-cols-[1fr_140px_180px] border-b border-neutral-800">
              <div className="border-r border-neutral-800 p-3 text-center leading-snug">
                <div className="text-[15px] font-bold tracking-tight uppercase">
                  {spec.seller.name}
                </div>
                <div className="mt-0.5 whitespace-pre-line text-[12.5px]">
                  {spec.seller.address}
                </div>
                {spec.seller.phone && (
                  <div className="text-[12.5px]">{spec.seller.phone}</div>
                )}
                {spec.seller.email && (
                  <div className="text-[12.5px]">Email Id : {spec.seller.email}</div>
                )}
              </div>

              {/* Middle B [ITA] Emblem or Uploaded Logo Box */}
              <div className="flex items-center justify-center border-r border-neutral-800 p-2">
                {spec.seller.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={spec.seller.logoUrl}
                    alt="Company Logo"
                    className="max-h-20 max-w-[120px] object-contain"
                  />
                ) : (
                  <div className="relative flex h-20 w-20 items-center justify-center rounded border-2 border-neutral-900 font-serif text-4xl font-black tracking-tighter text-neutral-900">
                    <span>B</span>
                    <span className="ml-0.5 rounded bg-neutral-900 px-1 py-0.5 text-[11px] font-bold tracking-normal text-white">
                      ITA
                    </span>
                  </div>
                )}
              </div>

              {/* Top-Right Invoice No. & Date Stacked Boxes */}
              <div className="flex flex-col">
                <div className="flex-1 border-b border-neutral-800 p-2 text-center">
                  <div className="text-[13px] font-medium">
                    {isProforma ? "Proforma No." : "Invoice No."}
                  </div>
                  <div className="mt-0.5 font-mono text-[15px] font-bold">
                    {spec.invoiceNoDisplay}
                  </div>
                </div>
                <div className="p-2 text-center">
                  <div className="text-[13px] font-medium">Date</div>
                  <div className="mt-0.5 font-mono text-[14px] font-semibold">
                    {spec.invoiceDateDotsDisplay}
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: Customer Address & GSTIN (Left) + Top-Right P.O. No. Box (Right) */}
            <div className="grid grid-cols-[1fr_180px] border-b border-neutral-800">
              <div className="border-r border-neutral-800 p-3 leading-relaxed">
                <div className="text-[14px] font-semibold">{spec.customerName}</div>
                <div className="whitespace-pre-line text-[13px]">{spec.customerAddress}</div>
                <div className="mt-2 font-semibold text-[13px]">
                  GSTIN: <span className="font-mono">{spec.customerGstin}</span>
                </div>
              </div>

              {/* Top-Right P.O. No. Box — blank if without PO, filled if PO is present */}
              <div className="p-2.5 text-center">
                <div className="text-[13px] font-medium">P.O. No.</div>
                {spec.poBoxDisplay ? (
                  <div className="mt-2 whitespace-pre-line font-mono text-[13px] font-semibold text-neutral-900">
                    {spec.poBoxDisplay}
                  </div>
                ) : (
                  <div className="mt-6 text-[11px] text-neutral-400 select-none">&nbsp;</div>
                )}
              </div>
            </div>

            {/* Row 3: Line Items + Tax Rows + A/C Details & Total */}
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-neutral-800 text-center font-medium">
                  <th className="w-16 border-r border-neutral-800 px-2 py-1.5">S.No.</th>
                  <th className="border-r border-neutral-800 px-3 py-1.5 text-center">Description</th>
                  <th colSpan={2} className="w-28 border-r border-neutral-800 px-2 py-1.5 text-center">
                    Unit
                  </th>
                  <th className="w-28 border-r border-neutral-800 px-2 py-1.5 text-center">
                    Rate in Rs.
                  </th>
                  <th className="w-36 px-2 py-1.5 text-center">Amount in Rs.</th>
                </tr>
              </thead>
              <tbody>
                {spec.lines.map((l, idx) => (
                  <tr key={l.slNo} className="border-b border-neutral-800 align-top">
                    <td className="border-r border-neutral-800 px-2 py-2.5 text-center font-medium">
                      {l.slNoPadded}
                    </td>
                    <td className="border-r border-neutral-800 px-3 py-2.5 whitespace-pre-line leading-relaxed">
                      <div>{l.description}</div>
                      {idx === 0 && combinedReportNos && !l.description.includes(combinedReportNos) && (
                        <div className="mt-1 text-[12px] text-neutral-800">
                          As per Inspection Report{linkedReports.length > 1 ? "s" : ""} {combinedReportNos}
                        </div>
                      )}
                    </td>
                    <td className="w-12 border-r border-neutral-800 px-2 py-2.5 text-center align-middle">
                      {l.qty}
                    </td>
                    <td className="w-16 border-r border-neutral-800 px-2 py-2.5 text-center align-middle">
                      {l.unit}
                    </td>
                    <td className="border-r border-neutral-800 px-2 py-2.5 text-center align-middle font-mono">
                      {l.rateSlashDisplay}
                    </td>
                    <td className="px-2 py-2.5 text-center align-middle font-mono font-semibold">
                      {l.amountSlashDisplay}
                    </td>
                  </tr>
                ))}

                {/* Tax Row (SGST / CGST / IGST) */}
                <tr className="border-b border-neutral-800">
                  <td className="border-r border-neutral-800 px-2 py-2 text-center align-top font-medium">
                    {String(spec.lines.length + 1).padStart(2, "0")}.
                  </td>
                  <td className="border-r border-neutral-800 px-4 py-2 text-right font-medium leading-relaxed">
                    <div>SGST</div>
                    <div>CGST</div>
                    <div>IGST</div>
                    {(Number(invoice.round_off) || 0) !== 0 && <div>Round-off</div>}
                  </td>
                  <td className="border-r border-neutral-800 px-2 py-2" />
                  <td className="border-r border-neutral-800 px-2 py-2" />
                  <td className="border-r border-neutral-800 px-2 py-2 text-center font-mono leading-relaxed">
                    <div>9%</div>
                    <div>9%</div>
                    <div>18%</div>
                    {(Number(invoice.round_off) || 0) !== 0 && <div>—</div>}
                  </td>
                  <td className="px-2 py-2 text-center font-mono leading-relaxed">
                    <div>{spec.sgstSlashDisplay}</div>
                    <div>{spec.cgstSlashDisplay}</div>
                    <div>{spec.igstSlashDisplay}</div>
                    {(Number(invoice.round_off) || 0) !== 0 && <div>{spec.roundOffDisplay}</div>}
                  </td>
                </tr>

                {/* A/C Details + Total Row */}
                <tr className="border-b border-neutral-800">
                  <td className="border-r border-neutral-800 px-2 py-2.5 text-left align-top text-[12px] font-medium">
                    A/C
                    <br />
                    Details
                  </td>
                  <td colSpan={3} className="border-r border-neutral-800 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="whitespace-pre-line text-[12.5px] leading-snug">
                        {spec.seller.bankDetailsPlaceholder}
                      </div>
                      <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-emerald-700/70 text-[10px] font-bold text-emerald-800">
                        BITA
                      </div>
                    </div>
                  </td>
                  <td className="border-r border-neutral-800 px-2 py-2.5 text-center align-bottom text-[14px] font-semibold">
                    Total
                  </td>
                  <td className="px-2 py-2.5 text-center align-bottom font-mono text-[15px] font-bold">
                    {spec.totalSlashDisplay}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Row 4: Footer (PAN/GSTIN/SAC + Amount in Words on Left, Signatory on Right) */}
            <div className="grid grid-cols-2">
              <div className="border-r border-neutral-800 flex flex-col">
                <div className="border-b border-neutral-800 p-2.5 text-[12.5px] leading-snug space-y-0.5">
                  {spec.seller.pan && <div>PAN : {spec.seller.pan}</div>}
                  <div>GSTIN : {spec.seller.gstin}</div>
                  <div>SAC No. : {spec.defaultSac}</div>
                </div>
                <div className="p-2.5 text-[13px] leading-snug flex-1">
                  <div className="font-medium">Amount in Words : {spec.amountInWords}</div>
                  {spec.notes && (
                    <div className="mt-1.5 text-[12px] text-neutral-700">Note: {spec.notes}</div>
                  )}
                </div>
              </div>

              <div className="p-3 flex flex-col justify-between text-center">
                <div className="text-[13.5px] font-semibold">
                  For {spec.seller.name}
                </div>
                {!spec.isDraft && spec.seller.sealUrl ? (
                  <div className="my-1 flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={spec.seller.sealUrl}
                      alt="Approved company seal"
                      className="h-16 w-16 object-contain"
                    />
                  </div>
                ) : (
                  <div className="my-4 text-[11.5px] text-neutral-600 italic">
                    Authorised Signatory
                  </div>
                )}
                {!spec.isDraft && spec.seller.sealUrl && (
                  <div className="text-[11.5px] font-semibold text-neutral-700">
                    Authorised Signatory
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mt-1.5 text-center text-[12px] text-ink-2">
            This is a digitally signed original document. No physical signature is required..
          </div>
        </div>
      </Card>
    </div>
  );
}
