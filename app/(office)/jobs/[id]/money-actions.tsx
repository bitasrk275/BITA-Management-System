import Link from "next/link";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Input,
  SecondaryButton,
  Select,
  Status,
} from "@/components/ui";
import { shortDate, todayIST } from "@/lib/dates";
import type { Enums } from "@/lib/db/types";
import {
  formatDaysSinceInvoiceDate,
  formatUnpaidInvoiceDaysLabel,
} from "@/lib/modules/invoices/payments-received";
import {
  generateInvoiceFromJob,
  generateReportFromJob,
} from "../../invoices/actions";
import { formatINR, METHOD_LABEL } from "../labels";

export interface JobMoneyActionsProps {
  job: {
    id: string;
    job_no: string;
    status: string;
    test_methods: Enums<"test_method">[];
    paid_at?: string | null;
  };
  customer: {
    id: string;
    name: string;
    uses_proforma?: boolean | null;
  } | null;
  reports: Array<{
    id: string;
    report_no: string;
    method: Enums<"test_method">;
    status: Enums<"report_status">;
    approved_at: string | null;
    sent_at: string | null;
  }>;
  invoices: Array<{
    id: string;
    kind: Enums<"invoice_kind">;
    invoice_no?: string | null;
    number: string | null;
    invoice_date: string | null;
    due_date: string | null;
    total: number;
    balance: number;
    status: string;
  }>;
}

export function JobMoneyActions({
  job,
  customer,
  reports,
  invoices,
}: JobMoneyActionsProps) {
  const today = todayIST();
  const approvedReports = reports.filter(
    (r) => Boolean(r.approved_at) || r.status === "approved" || r.status === "sent",
  );
  const hasApprovedReport = approvedReports.length > 0;
  const defaultInvoiceKind = customer?.uses_proforma ? "proforma" : "tax_invoice";
  const defaultMethod = job.test_methods?.[0] ?? "UT";

  const activeInvoices = invoices.filter((i) => i.status !== "cancelled");
  const issuedTaxInvoices = activeInvoices.filter(
    (i) =>
      i.kind === "tax_invoice" &&
      ["issued", "partly_paid", "paid"].includes(i.status),
  );
  const outstanding = activeInvoices
    .filter((i) => i.status === "issued" || i.status === "partly_paid")
    .reduce((sum, i) => sum + (Number(i.balance) || 0), 0);

  const isJobPaid =
    issuedTaxInvoices.length > 0
      ? outstanding === 0
      : Boolean(job.paid_at);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Reports, invoices &amp; payments</h2>
          <p className="text-xs text-ink-3">
            Generate or open the inspection report and invoice for {job.job_no}.
          </p>
        </div>
        {isJobPaid ? (
          <Status tone="ok">Paid</Status>
        ) : outstanding > 0 ? (
          <Status tone="wait">Outstanding: {formatINR(outstanding)}</Status>
        ) : null}
      </div>

      {/* 1. Report actions (Generate report / Open report) */}
      <div className="space-y-2.5 rounded-lg border border-line bg-surface-2/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            Inspection report
          </span>
          <form
            action={generateReportFromJob.bind(null, job.id)}
            className="flex flex-wrap items-center gap-2"
          >
            <Select name="method" defaultValue={defaultMethod} className="w-40 text-xs">
              {(job.test_methods.length > 0
                ? job.test_methods
                : (["UT", "MPT", "DPT", "RT", "VT"] as Enums<"test_method">[])
              ).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m] ?? m}
                </option>
              ))}
            </Select>
            <Input
              name="report_no"
              placeholder={`${job.job_no}/R-0${reports.length + 1}`}
              className="w-40 text-xs"
            />
            <SecondaryButton type="submit">
              {reports.length === 0 ? "Generate report" : "+ New report"}
            </SecondaryButton>
          </form>
        </div>

        {reports.length > 0 ? (
          <ul className="divide-y divide-line rounded-md border border-line bg-white">
            {reports.map((r) => {
              const isApproved =
                Boolean(r.approved_at) ||
                r.status === "approved" ||
                r.status === "sent";
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/review/${r.id}`}
                      className="font-mono font-semibold text-ink underline"
                    >
                      {r.report_no}
                    </Link>
                    <Badge>{METHOD_LABEL[r.method] ?? r.method}</Badge>
                    <Status tone={isApproved ? "ok" : "wait"}>
                      {r.status}
                    </Status>
                  </div>
                  <ButtonLink href={`/review/${r.id}`} variant="secondary" size="sm">
                    Open report
                  </ButtonLink>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-ink-3">
            No report created for this job yet. Click <strong>Generate report</strong> above to prepare one.
          </p>
        )}
      </div>

      {/* 2. Invoice actions (Generate invoice / Open invoice) */}
      <div className="space-y-2.5 rounded-lg border border-line bg-surface-2/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">
              Invoice ({customer?.uses_proforma ? "Customer prefers Proforma first" : "Tax or Proforma"})
            </span>
          </div>
          <form
            action={generateInvoiceFromJob.bind(null, job.id)}
            className="flex flex-wrap items-center gap-2"
          >
            <Select name="kind" defaultValue={defaultInvoiceKind} className="w-48 text-xs">
              <option value="tax_invoice">Tax invoice (INV)</option>
              <option value="proforma">Proforma invoice (PI)</option>
            </Select>
            <Button type="submit">Generate invoice</Button>
          </form>
        </div>

        {!hasApprovedReport && (
          <div className="rounded-md border border-line bg-white p-2.5 text-xs text-ink-2">
            {reports.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Report <strong>{reports[0].report_no}</strong> is currently{" "}
                  <strong>{reports[0].status}</strong> (not approved yet). No report leaves without technical reviewer approval — approve the report before sending to the customer, or prepare the draft invoice now.
                </span>
                <ButtonLink href={`/review/${reports[0].id}`} variant="secondary" size="sm">
                  Open report to approve
                </ButtonLink>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  No approved report on this job yet. A report must be approved by a technical reviewer before it is sent to the customer. You can generate the report above or prepare a draft invoice now.
                </span>
              </div>
            )}
          </div>
        )}

        {invoices.length > 0 ? (
          <ul className="divide-y divide-line rounded-md border border-line bg-white">
            {invoices.map((i) => {
              const displayNo =
                i.invoice_no ??
                i.number ??
                (i.kind === "proforma" ? "Draft Proforma" : "Draft Invoice");
              const age = formatDaysSinceInvoiceDate(i.invoice_date, today);
              const unpaidAge = formatUnpaidInvoiceDaysLabel(i, today);
              return (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/invoices/${i.id}`}
                        className="font-mono font-semibold text-ink underline"
                      >
                        {displayNo}
                      </Link>
                      <Badge>
                        {i.kind === "proforma" ? "Proforma" : "GST invoice"}
                      </Badge>
                      <Status
                        tone={
                          i.status === "paid"
                            ? "ok"
                            : i.status === "draft"
                              ? "wait"
                              : "info"
                        }
                      >
                        {i.status}
                      </Status>
                      {unpaidAge && <Badge>{unpaidAge}</Badge>}
                    </div>
                    <div className="text-xs text-ink-3">
                      Total {formatINR(Number(i.total) || 0)} · Balance{" "}
                      {formatINR(Number(i.balance) || 0)}
                      {i.invoice_date ? ` · Dated ${shortDate(i.invoice_date)}` : ""}
                      {age ? ` (${age.label})` : ""}
                    </div>
                  </div>
                  <ButtonLink href={`/invoices/${i.id}`} variant="secondary" size="sm">
                    {i.status === "draft" ? "Open & issue invoice" : "Open invoice"}
                  </ButtonLink>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-ink-3">
            No invoices yet. Choose Tax invoice or Proforma above and click <strong>Generate invoice</strong>.
          </p>
        )}

        {invoices.length > 0 && (
          <div className="flex flex-wrap items-center justify-between pt-1 text-xs">
            <span className="font-semibold text-ink">
              Outstanding balance: {formatINR(outstanding)}
            </span>
            <Link href="/invoices" className="text-ink underline">
              All invoices &amp; payments →
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}
