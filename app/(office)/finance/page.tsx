import Link from "next/link";
import { formatINR } from "@/app/(office)/jobs/labels";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Mono,
  PageHeader,
  SectionTitle,
  Select,
  Stats,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { shortDate, todayIST } from "@/lib/dates";
import {
  currentFinancialYear,
  formatMonthLabel,
} from "@/lib/modules/finance/schema";
import { getFinanceOverview } from "@/lib/modules/finance/service";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";

export const metadata = { title: "Financial reports – BITA" };

function buildFinancialYearOptions(asOfDate: string): string[] {
  const cur = currentFinancialYear(asOfDate);
  const startYear = Number(cur.slice(0, 4)) || 2026;
  const options: string[] = [];
  for (let y = startYear + 1; y >= startYear - 3; y--) {
    const endShort = String((y + 1) % 100).padStart(2, "0");
    options.push(`${y}-${endShort}`);
  }
  return options;
}

export default async function FinanceReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; month?: string }>;
}) {
  const { fy: rawFy, month: rawMonth } = await searchParams;
  const { supabase, person } = await requireStaff();

  const allowed = await hasPermissionForRoles(
    supabase,
    person?.roles,
    "view_finance",
  );

  if (!allowed) {
    return (
      <div>
        <PageHeader
          title="Financial reports"
          subtitle="Receivables ageing, customer revenue, monthly income vs expenses, TDS payments, and unconverted proformas"
        />
        <Card>
          <h2 className="text-sm font-semibold text-ink">Access restricted</h2>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            You do not have permission (<Mono>view_finance</Mono>) to view financial reports. Contact management to grant access in Settings.
          </p>
        </Card>
      </div>
    );
  }

  const asOf = todayIST();
  const overview = await getFinanceOverview(supabase, {
    fy: rawFy,
    month: rawMonth,
    asOfDate: asOf,
  });

  const fyOptions = buildFinancialYearOptions(asOf);
  if (!fyOptions.includes(overview.fy)) {
    fyOptions.unshift(overview.fy);
  }

  const {
    ageing,
    customer_revenue: custRev,
    monthly_income_vs_expenses: monthly,
    monthly_payments: payments,
    unconverted_proformas: proformas,
  } = overview;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Financial reports"
        subtitle={`FY ${overview.fy} (Apr–Mar) · Payments month ${formatMonthLabel(overview.month)} · Live balances net of payments, TDS & credit notes`}
      />

      {/* Filter bar */}
      <Card>
        <form
          method="get"
          action="/finance"
          className="flex flex-wrap items-end gap-3"
        >
          <div className="w-full sm:w-44">
            <Field label="Financial year (Apr–Mar)">
              <Select name="fy" defaultValue={overview.fy}>
                {fyOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    FY {opt}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-full sm:w-48">
            <Field label="Payments month">
              <Input
                type="month"
                name="month"
                defaultValue={overview.month}
              />
            </Field>
          </div>
          <Button type="submit">Apply filters</Button>
          <Link
            href="/finance"
            className="inline-flex h-8 items-center rounded-md border border-line bg-white px-3 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Reset
          </Link>
        </form>
      </Card>

      {/* Top KPI summary */}
      <Stats
        items={[
          {
            label: "Total receivables",
            value: formatINR(ageing.totals.total_outstanding),
            note: `${ageing.totals.invoice_count} open tax invoice(s) · 90+d: ${formatINR(ageing.totals.days_90_plus)}`,
          },
          {
            label: `FY ${overview.fy} net invoiced`,
            value: formatINR(custRev.totals.net_invoiced),
            note: `Taxable ${formatINR(custRev.totals.net_taxable_revenue)} · Expenses ${formatINR(monthly.totals.expenses_total)}`,
          },
          {
            label: `${formatMonthLabel(payments.month)} collections`,
            value: formatINR(payments.totals.amount_received),
            note: `TDS deducted ${formatINR(payments.totals.tds_total)}`,
          },
        ]}
      />

      {/* (a) Receivables ageing */}
      <section>
        <SectionTitle
          link={{
            href: "/api/v1/finance/ageing?format=csv",
            label: "Download CSV",
          }}
        >
          1. Receivables ageing (issued tax invoices)
        </SectionTitle>
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface text-[11.5px] font-medium text-ink-3">
                <th className="px-3.5 py-2.5">Customer</th>
                <th className="px-3 py-2.5 text-right">Invoices</th>
                <th className="px-3 py-2.5 text-right">Not due</th>
                <th className="px-3 py-2.5 text-right">0–30 days</th>
                <th className="px-3 py-2.5 text-right">31–60 days</th>
                <th className="px-3 py-2.5 text-right">61–90 days</th>
                <th className="px-3 py-2.5 text-right">90+ days</th>
                <th className="px-3.5 py-2.5 text-right">Total balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ageing.customers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[13px] text-ink-3">
                    No outstanding tax invoice receivables as of {shortDate(ageing.as_of_date)}.
                  </td>
                </tr>
              ) : (
                ageing.customers.map((c) => (
                  <tr key={c.customer_id} className="hover:bg-surface/60">
                    <td className="px-3.5 py-2.5">
                      <div className="font-medium text-ink">
                        <Link href={`/customers/${c.customer_id}`} className="hover:underline">
                          {c.customer_name}
                        </Link>
                      </div>
                      {c.customer_gstin && (
                        <div className="font-mono text-[11.5px] text-ink-3">
                          {c.customer_gstin}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {c.invoice_count}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(c.not_due)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(c.days_0_30)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(c.days_31_60)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(c.days_61_90)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-bad">
                      {formatINR(c.days_90_plus)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-ink">
                      {formatINR(c.total_outstanding)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {ageing.customers.length > 0 && (
              <tfoot>
                <tr className="border-t border-line bg-surface font-medium text-ink">
                  <td className="px-3.5 py-2.5">Total ({ageing.totals.customer_count} customers)</td>
                  <td className="px-3 py-2.5 text-right font-mono">{ageing.totals.invoice_count}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(ageing.totals.not_due)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(ageing.totals.days_0_30)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(ageing.totals.days_31_60)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(ageing.totals.days_61_90)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-bad">{formatINR(ageing.totals.days_90_plus)}</td>
                  <td className="px-3.5 py-2.5 text-right font-mono font-semibold">{formatINR(ageing.totals.total_outstanding)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* (b) Customer-wise revenue and outstanding for FY */}
      <section>
        <SectionTitle
          link={{
            href: `/api/v1/finance/customer-revenue?fy=${encodeURIComponent(custRev.fy)}&format=csv`,
            label: "Download CSV",
          }}
        >
          2. Customer-wise revenue & outstanding (FY {custRev.fy})
        </SectionTitle>
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[780px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface text-[11.5px] font-medium text-ink-3">
                <th className="px-3.5 py-2.5">Customer</th>
                <th className="px-3 py-2.5 text-right">Invoices</th>
                <th className="px-3 py-2.5 text-right">Taxable value</th>
                <th className="px-3 py-2.5 text-right">GST</th>
                <th className="px-3 py-2.5 text-right">Credit notes</th>
                <th className="px-3 py-2.5 text-right">Net invoiced</th>
                <th className="px-3 py-2.5 text-right">Received + TDS</th>
                <th className="px-3.5 py-2.5 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {custRev.customers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[13px] text-ink-3">
                    No issued tax invoices recorded in FY {custRev.fy} ({shortDate(custRev.start_date)} to {shortDate(custRev.end_date)}).
                  </td>
                </tr>
              ) : (
                custRev.customers.map((c) => (
                  <tr key={c.customer_id} className="hover:bg-surface/60">
                    <td className="px-3.5 py-2.5">
                      <div className="font-medium text-ink">
                        <Link href={`/customers/${c.customer_id}`} className="hover:underline">
                          {c.customer_name}
                        </Link>
                      </div>
                      {c.customer_gstin && (
                        <div className="font-mono text-[11.5px] text-ink-3">
                          {c.customer_gstin}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {c.invoice_count}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(c.taxable_value)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(c.gst_total)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-3">
                      {formatINR(c.credit_notes_total)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-medium text-ink">
                      {formatINR(c.net_invoiced)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(c.paid_amount + c.tds_amount)}
                      {c.tds_amount > 0 && (
                        <div className="text-[11px] text-ink-3">
                          incl. TDS {formatINR(c.tds_amount)}
                        </div>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-ink">
                      {formatINR(c.outstanding_balance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {custRev.customers.length > 0 && (
              <tfoot>
                <tr className="border-t border-line bg-surface font-medium text-ink">
                  <td className="px-3.5 py-2.5">Total ({custRev.totals.customer_count} customers)</td>
                  <td className="px-3 py-2.5 text-right font-mono">{custRev.totals.invoice_count}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(custRev.totals.taxable_value)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(custRev.totals.gst_total)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(custRev.totals.credit_notes_total)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold">{formatINR(custRev.totals.net_invoiced)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatINR(custRev.totals.paid_amount + custRev.totals.tds_amount)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono font-semibold">{formatINR(custRev.totals.outstanding_balance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* (c) Monthly income vs expenses */}
      <section>
        <SectionTitle
          link={{
            href: `/api/v1/finance/monthly-income-expenses?fy=${encodeURIComponent(monthly.fy)}&format=csv`,
            label: "Download CSV",
          }}
        >
          3. Monthly income vs job expenses (FY {monthly.fy})
        </SectionTitle>
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface text-[11.5px] font-medium text-ink-3">
                <th className="px-3.5 py-2.5">Month</th>
                <th className="px-3 py-2.5 text-right">Tax invoices</th>
                <th className="px-3 py-2.5 text-right">Taxable value</th>
                <th className="px-3 py-2.5 text-right">GST</th>
                <th className="px-3 py-2.5 text-right">Gross income</th>
                <th className="px-3 py-2.5 text-right">Credit notes</th>
                <th className="px-3 py-2.5 text-right">Job expenses</th>
                <th className="px-3.5 py-2.5 text-right">Operating surplus</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {monthly.months.map((m) => (
                <tr key={m.month} className="hover:bg-surface/60">
                  <td className="px-3.5 py-2 font-medium text-ink">{m.label}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-2">{m.invoice_count}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-2">{formatINR(m.taxable_value)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-2">{formatINR(m.gst_total)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink">{formatINR(m.gross_income)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-3">{formatINR(m.credit_notes_total)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-2">{formatINR(m.expenses_total)}</td>
                  <td
                    className={`px-3.5 py-2 text-right font-mono font-medium ${
                      m.net_operating_surplus < 0 ? "text-bad" : "text-ink"
                    }`}
                  >
                    {formatINR(m.net_operating_surplus)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface font-medium text-ink">
                <td className="px-3.5 py-2.5">FY {monthly.fy} Total</td>
                <td className="px-3 py-2.5 text-right font-mono">{monthly.totals.invoice_count}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatINR(monthly.totals.taxable_value)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatINR(monthly.totals.gst_total)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatINR(monthly.totals.gross_income)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatINR(monthly.totals.credit_notes_total)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatINR(monthly.totals.expenses_total)}</td>
                <td className="px-3.5 py-2.5 text-right font-mono font-semibold">
                  {formatINR(monthly.totals.net_operating_surplus)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* (d) Payments received in month with TDS totals */}
      <section>
        <SectionTitle
          link={{
            href: `/api/v1/finance/payments?month=${encodeURIComponent(payments.month)}&format=csv`,
            label: "Download CSV",
          }}
        >
          4. Payments received & TDS ({formatMonthLabel(payments.month)})
        </SectionTitle>
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface text-[11.5px] font-medium text-ink-3">
                <th className="px-3.5 py-2.5">Paid on</th>
                <th className="px-3 py-2.5">Invoice / Job</th>
                <th className="px-3 py-2.5">Customer</th>
                <th className="px-3 py-2.5">Mode / Ref</th>
                <th className="px-3 py-2.5 text-right">Amount received</th>
                <th className="px-3 py-2.5 text-right">TDS deducted</th>
                <th className="px-3.5 py-2.5 text-right">Total settled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payments.payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[13px] text-ink-3">
                    No payments recorded in {formatMonthLabel(payments.month)}.
                  </td>
                </tr>
              ) : (
                payments.payments.map((p) => (
                  <tr key={p.payment_id} className="hover:bg-surface/60">
                    <td className="px-3.5 py-2.5 font-mono text-[12.5px] text-ink-2">
                      {shortDate(p.paid_on)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/invoices/${p.invoice_id}`}
                        className="font-mono text-[12.5px] font-medium text-ink hover:underline"
                      >
                        {p.invoice_no}
                      </Link>
                      <div className="font-mono text-[11px] text-ink-3">
                        {p.job_no}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-ink">{p.customer_name}</div>
                      {p.customer_gstin && (
                        <div className="font-mono text-[11px] text-ink-3">
                          {p.customer_gstin}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">
                      <div>{p.mode ?? "—"}</div>
                      {p.reference && (
                        <div className="font-mono text-[11px] text-ink-3">
                          {p.reference}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink">
                      {formatINR(p.amount)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(p.tds_amount)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-ink">
                      {formatINR(p.total_settled)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {payments.payments.length > 0 && (
              <tfoot>
                <tr className="border-t border-line bg-surface font-medium text-ink">
                  <td colSpan={4} className="px-3.5 py-2.5">
                    Total ({payments.totals.payment_count} payment(s))
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatINR(payments.totals.amount_received)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatINR(payments.totals.tds_total)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono font-semibold">
                    {formatINR(payments.totals.total_settled)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* (e) Proformas not yet converted */}
      <section>
        <SectionTitle
          link={{
            href: "/api/v1/finance/proformas?format=csv",
            label: "Download CSV",
          }}
        >
          5. Proforma invoices not yet converted to tax invoices
        </SectionTitle>
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[700px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface text-[11.5px] font-medium text-ink-3">
                <th className="px-3.5 py-2.5">Proforma no.</th>
                <th className="px-3 py-2.5">Date / Age</th>
                <th className="px-3 py-2.5">Customer & Job</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Taxable value</th>
                <th className="px-3 py-2.5 text-right">GST</th>
                <th className="px-3.5 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {proformas.proformas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[13px] text-ink-3">
                    All active proforma invoices have been converted to tax invoices.
                  </td>
                </tr>
              ) : (
                proformas.proformas.map((pf) => (
                  <tr key={pf.invoice_id} className="hover:bg-surface/60">
                    <td className="px-3.5 py-2.5">
                      <Link
                        href={`/invoices/${pf.invoice_id}`}
                        className="font-mono text-[12.5px] font-medium text-ink hover:underline"
                      >
                        {pf.invoice_no}
                      </Link>
                      {pf.customer_po_number && (
                        <div className="font-mono text-[11px] text-ink-3">
                          PO: {pf.customer_po_number}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-[12.5px] text-ink-2">
                        {shortDate(pf.invoice_date)}
                      </div>
                      <Badge>{pf.age_days}d old</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-ink">{pf.customer_name}</div>
                      <div className="font-mono text-[11.5px] text-ink-3">
                        <Link href={`/jobs/${pf.job_id}`} className="hover:underline">
                          {pf.job_no}
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Status tone={pf.status === "draft" ? "none" : "wait"}>
                        {pf.status}
                      </Status>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(pf.taxable_value)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-2">
                      {formatINR(pf.gst_total)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-ink">
                      {formatINR(pf.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {proformas.proformas.length > 0 && (
              <tfoot>
                <tr className="border-t border-line bg-surface font-medium text-ink">
                  <td colSpan={4} className="px-3.5 py-2.5">
                    Total ({proformas.totals.proforma_count} unconverted proforma(s))
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatINR(proformas.totals.taxable_value)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatINR(proformas.totals.gst_total)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono font-semibold">
                    {formatINR(proformas.totals.total_value)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
