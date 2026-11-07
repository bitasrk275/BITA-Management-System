import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
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
  amountInWordsINR,
  buildInvoiceDocumentSpec,
  formatPlaceOfSupply,
} from "@/lib/invoices";
import { checkPoUtilization } from "@/lib/modules/po/service";
import { listPriceItems } from "@/lib/modules/price-items/service";
import { validUuid } from "@/lib/reports/review";
import { homeFor } from "@/lib/roles";
import { formatINR } from "../../jobs/labels";
import {
  cancelInvoice,
  issueInvoice,
  recordPayment,
  toggleInvoiceReminders,
  updateDraftInvoice,
} from "../actions";
import {
  invoiceLinesTable,
  invoicesTable,
  paymentRemindersTable,
  paymentsTable,
  type InvoiceLineRow,
  type InvoiceWithRelations,
  type PaymentReminderRow,
  type PaymentRow,
} from "../db";
import { InvoiceDraftEditor } from "./invoice-draft-editor";

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

  const [invoiceRes, linesRes, paymentsRes, remindersRes, priceItemsRes] = await Promise.all([
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

  const isDraft = invoice.status === "draft";
  const isCancelled = invoice.status === "cancelled";
  const isIssued = ["issued", "partly_paid", "paid"].includes(invoice.status);
  const displayNo = invoice.invoice_no ?? invoice.number ?? "Draft Invoice (Unissued)";
  const statusInfo = STATUS_META[invoice.status] ?? { label: invoice.status, tone: "none" as Tone };

  const poCheck = await checkPoUtilization(supabase, {
    jobId: invoice.job_id,
    customerId: job?.customer_id,
    poNumber: invoice.customer_po_number ?? job?.po_number,
    poValue: job?.po_value,
    excludeInvoiceId: invoice.id,
    currentInvoiceTotal: isCancelled ? 0 : Number(invoice.total) || 0,
  });

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
  });

  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const remainingBalance = Number(invoice.balance) || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={displayNo}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-3">
            <Status tone={statusInfo.tone}>{statusInfo.label}</Status>
            <span>
              {customer?.name ?? "Customer"} · {job?.job_no ?? "Job"}
              {report?.report_no ? ` · Report ${report.report_no}` : ""}
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
            <SectionTitle>1. Issue Tax Invoice</SectionTitle>
            <p className="text-[13px] text-ink-2">
              Review the lines, quantities, rates and GST breakdown below. Clicking{" "}
              <strong className="font-medium text-ink">Issue invoice</strong> assigns the official{" "}
              <Mono>BITA/YY-YY/INV-0001</Mono> number and freezes the invoice against further edits.
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
                  Issue invoice (assigns number & freezes)
                </Button>
              </form>
              <form action={cancelInvoice.bind(null, invoice.id)}>
                <SecondaryButton type="submit">Cancel draft</SecondaryButton>
              </form>
            </div>
          </Card>
        )}

        {isIssued && (
          <Card className="space-y-4">
            <SectionTitle>1. Issued Tax Invoice (Frozen)</SectionTitle>
            <p className="text-[13px] text-ink-2">
              Issued on {invoice.issued_at ? formatIST(invoice.issued_at) : invoice.invoice_date ? shortDate(invoice.invoice_date) : "—"}. Content and tax totals are frozen; download the PDF or Word file to send to the customer.
            </p>
            <dl className="grid grid-cols-1 gap-2 rounded-lg border border-line bg-surface-2/40 p-3 text-[12.5px] sm:grid-cols-3 sm:gap-3">
              <div>
                <dt className="text-ink-3">Invoice Total</dt>
                <dd className="font-semibold text-ink tabular-nums">{formatINR(Number(invoice.total) || 0)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Received</dt>
                <dd className="font-medium text-ok tabular-nums">{formatINR(totalPaid)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Balance Due</dt>
                <dd className="font-semibold text-ink tabular-nums">{formatINR(remainingBalance)}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2.5">
              <form action={toggleInvoiceReminders.bind(null, invoice.id, !invoice.reminders_paused)}>
                <SecondaryButton type="submit">
                  {invoice.reminders_paused ? "Resume payment reminders" : "Pause payment reminders"}
                </SecondaryButton>
              </form>
              {totalPaid === 0 && (
                <form action={cancelInvoice.bind(null, invoice.id)}>
                  <SecondaryButton type="submit">Cancel invoice</SecondaryButton>
                </form>
              )}
            </div>
          </Card>
        )}

        {isIssued && remainingBalance > 0 && (
          <Card className="space-y-4">
            <SectionTitle>2. Record payment</SectionTitle>
            <p className="text-[13px] text-ink-2">
              Record a customer payment against this invoice. Recording the full remaining balance ({formatINR(remainingBalance)}) automatically marks the invoice <strong className="font-medium text-ink">Paid</strong>.
            </p>
            <form action={recordPayment.bind(null, invoice.id)} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amount received (INR)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={remainingBalance}
                    name="amount"
                    defaultValue={String(remainingBalance)}
                    required
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
                <Field label="Reference / UTR / Cheque no.">
                  <Input name="reference" placeholder="e.g. UTR-HDFC0001234" />
                </Field>
              </div>
              <Button type="submit">Record payment</Button>
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
            {payments.map((p) => (
              <ListRow
                key={p.id}
                tone="ok"
                title={
                  <span>
                    <strong className="font-semibold text-ink tabular-nums">{formatINR(Number(p.amount) || 0)}</strong>
                    <span className="ml-2.5 text-[13px] text-ink-2">
                      via {p.mode || "Bank Transfer"}
                      {p.reference ? ` · Ref: ${p.reference}` : ""}
                    </span>
                  </span>
                }
                detail={`Paid on ${shortDate(p.paid_on)}`}
              />
            ))}
            {payments.length === 0 && (
              <EmptyRow>No payments recorded against this invoice yet.</EmptyRow>
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

      {/* Clean BITA Tax Invoice Preview Card */}
      <Card className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
              {spec.title}
            </div>
            <h2 className="mt-0.5 text-lg font-bold text-ink">{spec.seller.name}</h2>
            <p className="text-[12.5px] text-ink-2">{spec.seller.subtitle}</p>
            <p className="text-[12px] text-ink-3">{spec.seller.address}</p>
            <p className="mt-1 text-[12px] text-ink-2">
              Supplier GSTIN: <Mono>{spec.seller.gstin}</Mono> · State: {spec.seller.stateCode} - {spec.seller.stateName}
            </p>
          </div>
          <div className="text-left sm:text-right text-[12.5px] space-y-1">
            <div>
              <span className="text-ink-3">Invoice No: </span>
              <strong className="text-ink">
                <Mono>{spec.invoiceNoDisplay}</Mono>
              </strong>
            </div>
            <div>
              <span className="text-ink-3">Invoice Date: </span>
              <span className="font-medium text-ink">{spec.invoiceDateDisplay}</span>
            </div>
            <div>
              <span className="text-ink-3">Due Date: </span>
              <span className="font-medium text-ink">{spec.dueDateDisplay}</span>
            </div>
            <div>
              <span className="text-ink-3">Place of Supply: </span>
              <span className="font-medium text-ink">{spec.placeOfSupplyDisplay}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 text-[13px]">
          <div className="rounded-lg border border-line bg-surface-2/30 p-3.5 space-y-1">
            <div className="text-[11px] font-semibold uppercase text-ink-3">Bill To (Customer)</div>
            <div className="font-semibold text-ink">{spec.customerName}</div>
            <div className="whitespace-pre-line text-[12.5px] text-ink-2">{spec.customerAddress}</div>
            <div className="pt-1 text-[12.5px]">
              <span className="text-ink-3">Customer GSTIN: </span>
              <Mono>{spec.customerGstin}</Mono>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-surface-2/30 p-3.5 space-y-1.5 text-[12.5px]">
            <div className="text-[11px] font-semibold uppercase text-ink-3">References</div>
            <div className="flex justify-between">
              <span className="text-ink-3">Job ID</span>
              {job ? (
                <Link href={`/jobs/${job.id}`} className="font-medium text-ink underline">
                  <Mono>{job.job_no}</Mono>
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-ink-3">
                Approved Report{linkedReports.length > 1 ? "s" : ""}
              </span>
              {linkedReports.length > 0 ? (
                <span className="flex flex-wrap justify-end gap-1.5 text-right">
                  {linkedReports.map((r) => (
                    <Link
                      key={r.id}
                      href={`/review/${r.id}`}
                      className="font-medium text-ink underline"
                    >
                      <Mono>{r.report_no}</Mono>
                    </Link>
                  ))}
                </span>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-ink-3">Quotation Ref</span>
              {quotation ? (
                <Link href={`/quotations/${quotation.id}`} className="font-medium text-ink underline">
                  <Mono>{quotation.ref_no ?? "Quotation"}</Mono>
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-ink-3">Customer PO</span>
              <span className="font-medium text-ink">{spec.poDisplay}</span>
            </div>
          </div>
        </div>

        {/* Invoice Lines Table */}
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[12px] font-medium text-ink-2">
                <th className="px-3 py-2 w-12">Sl.</th>
                <th className="px-3 py-2">Description of Services</th>
                <th className="px-3 py-2 w-24 text-center">SAC</th>
                <th className="px-3 py-2 w-24 text-right">Qty</th>
                <th className="px-3 py-2 w-28 text-right">Rate</th>
                <th className="px-3 py-2 w-32 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {spec.lines.map((l) => (
                <tr key={l.slNo}>
                  <td className="px-3 py-2.5 text-ink-3 tabular-nums">{l.slNo}</td>
                  <td className="px-3 py-2.5 text-ink">{l.description}</td>
                  <td className="px-3 py-2.5 text-center text-ink-2">
                    <Mono>{l.sac}</Mono>
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">
                    {l.qty} {l.unit}
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{l.rate}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-ink tabular-nums">{l.amount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line bg-surface-2/40 text-[13px]">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-right font-medium text-ink-2">
                  Taxable Value
                </td>
                <td className="px-3 py-2 text-right font-semibold text-ink tabular-nums">
                  {formatINR(Number(invoice.taxable_value) || 0)}
                </td>
              </tr>
              {spec.isIntraState ? (
                <>
                  <tr>
                    <td colSpan={5} className="px-3 py-1.5 text-right text-ink-2">
                      CGST @ 9% (Intra-state Karnataka)
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink tabular-nums">
                      {formatINR(Number(invoice.cgst) || 0)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="px-3 py-1.5 text-right text-ink-2">
                      SGST @ 9% (Intra-state Karnataka)
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink tabular-nums">
                      {formatINR(Number(invoice.sgst) || 0)}
                    </td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-1.5 text-right text-ink-2">
                    IGST @ 18% (Inter-state Supply)
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink tabular-nums">
                    {formatINR(Number(invoice.igst) || 0)}
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={5} className="px-3 py-1.5 text-right text-ink-2">
                  Round-off
                </td>
                <td className="px-3 py-1.5 text-right text-ink tabular-nums">
                  {(Number(invoice.round_off) || 0) > 0 ? "+" : ""}
                  {formatINR(Number(invoice.round_off) || 0)}
                </td>
              </tr>
              <tr className="border-t border-line text-[14px] font-semibold text-ink">
                <td colSpan={5} className="px-3 py-2.5 text-right">
                  Total Invoice Amount (INR)
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatINR(Number(invoice.total) || 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="space-y-2 border-t border-line pt-3 text-[12.5px]">
          <div>
            <span className="text-ink-3">Amount in words: </span>
            <strong className="font-semibold text-ink">{amountInWordsINR(Number(invoice.total) || 0)}</strong>
          </div>
          {spec.notes && (
            <div>
              <span className="text-ink-3">Notes: </span>
              <span className="text-ink-2">{spec.notes}</span>
            </div>
          )}
          <div className="rounded border border-dashed border-line p-2.5 text-[11.5px] text-ink-3 space-y-1">
            <div>
              <strong className="font-medium text-ink-2">Bank details:</strong> {spec.seller.bankDetailsPlaceholder}
            </div>
            <div>
              <strong className="font-medium text-ink-2">Terms:</strong> {spec.seller.termsPlaceholder}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
