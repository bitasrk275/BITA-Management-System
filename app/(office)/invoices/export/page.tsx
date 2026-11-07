import { redirect } from "next/navigation";
import {
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  Mono,
  PageHeader,
  SectionTitle,
  Stats,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { B2B_GST_COLUMNS, B2C_GST_COLUMNS, type GstExportRow } from "@/lib/invoices";
import { homeFor } from "@/lib/roles";
import { formatINR } from "../../jobs/labels";
import { loadGstExportData } from "./load";

export const metadata = { title: "CA GST Export (GSTR-1) – BITA" };

function renderStatusBadge(status: GstExportRow["status"]) {
  if (status === "cancelled") return <Status tone="bad">cancelled</Status>;
  if (status === "paid") return <Status tone="ok">paid</Status>;
  return <Status tone="info">{status}</Status>;
}

export default async function GstExportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, person } = await requireStaff();
  if (!person?.roles.some((r) => r === "management" || r === "office")) {
    redirect(homeFor(person?.roles));
  }

  const { fromDate, toDate, month, report } = await loadGstExportData(supabase, sp);
  const queryBase = `from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="CA GST Export (GSTR-1)"
        subtitle={`Period ${fromDate} to ${toDate} · Issued, partly paid & paid tax invoices (cancelled listed with zero amounts; drafts excluded).`}
        action={
          <>
            <ButtonLink href="/invoices" variant="secondary" size="sm">
              All invoices
            </ButtonLink>
            <ButtonLink
              href={`/invoices/export/download?${queryBase}&format=excel`}
              variant="secondary"
              size="sm"
            >
              Download Excel (.xls)
            </ButtonLink>
            <ButtonLink
              href={`/invoices/export/download?${queryBase}&format=combined`}
              variant="primary"
              size="sm"
            >
              Download GSTR-1 CSV
            </ButtonLink>
          </>
        }
      />

      {/* Period Picker */}
      <Card className="space-y-4">
        <div className="grid gap-5 lg:grid-cols-2">
          <form method="GET" action="/invoices/export" className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <Field label="Select month">
                <Input type="month" name="month" defaultValue={month} />
              </Field>
            </div>
            <Button type="submit">Load month</Button>
          </form>

          <form method="GET" action="/invoices/export" className="flex flex-wrap items-end gap-3">
            <div className="min-w-[140px] flex-1">
              <Field label="From date">
                <Input type="date" name="from" defaultValue={fromDate} />
              </Field>
            </div>
            <div className="min-w-[140px] flex-1">
              <Field label="To date">
                <Input type="date" name="to" defaultValue={toDate} />
              </Field>
            </div>
            <Button type="submit">Load range</Button>
          </form>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px] text-ink-2">
          <span>
            Showing <strong className="text-ink">{report.grand_totals.count}</strong> invoice(s) ({report.b2b.length} B2B, {report.b2c.length} B2C
            {report.grand_totals.cancelled_count > 0 ? `, ${report.grand_totals.cancelled_count} cancelled` : ""}).
          </span>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/invoices/export/download?${queryBase}&format=b2b`} variant="secondary" size="sm">
              B2B CSV ({report.b2b.length})
            </ButtonLink>
            <ButtonLink href={`/invoices/export/download?${queryBase}&format=b2c`} variant="secondary" size="sm">
              B2C CSV ({report.b2c.length})
            </ButtonLink>
          </div>
        </div>
      </Card>

      <Stats
        items={[
          {
            label: "Taxable value",
            value: formatINR(report.grand_totals.taxable_value),
            note: `${report.grand_totals.count} invoices in period`,
          },
          {
            label: "CGST + SGST (Intra-state)",
            value: formatINR(report.grand_totals.cgst + report.grand_totals.sgst),
            note: `${formatINR(report.grand_totals.cgst)} CGST · ${formatINR(report.grand_totals.sgst)} SGST`,
          },
          {
            label: "IGST (Inter-state)",
            value: formatINR(report.grand_totals.igst),
            note: "Outside Karnataka (29)",
          },
          {
            label: "Total invoice value",
            value: formatINR(report.grand_totals.total),
            note:
              report.grand_totals.cancelled_count > 0
                ? `${report.grand_totals.cancelled_count} cancelled (₹0)`
                : "no cancelled invoices",
          },
        ]}
      />

      {/* Section 1: B2B Table */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <SectionTitle>1. B2B Invoices — Registered Customers ({report.b2b.length})</SectionTitle>
            <p className="text-[12px] text-ink-3">
              Customers with a GSTIN on record. Columns defined in <Mono>lib/invoices/gst-export.ts</Mono>.
            </p>
          </div>
          <ButtonLink href={`/invoices/export/download?${queryBase}&format=b2b`} variant="secondary" size="sm">
            Download B2B CSV
          </ButtonLink>
        </div>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[11.5px] font-medium text-ink-2">
                {B2B_GST_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-2.5 py-2 whitespace-nowrap ${
                      ["taxable_value", "cgst", "sgst", "igst", "total"].includes(col.key)
                        ? "text-right"
                        : ""
                    }`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.b2b.map((row) => (
                <tr key={`${row.invoice_no}-${row.invoice_date}`}>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <Mono>{row.customer_gstin}</Mono>
                  </td>
                  <td className="px-2.5 py-2 text-ink">{row.customer_name}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <Mono>{row.invoice_no}</Mono>
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 tabular-nums">{row.invoice_date}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{row.place_of_supply}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                    <Mono>{row.sac || "—"}</Mono>
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{renderStatusBadge(row.status)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(row.taxable_value)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(row.cgst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(row.sgst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(row.igst)}</td>
                  <td className="px-2.5 py-2 text-right font-medium text-ink tabular-nums">
                    {formatINR(row.total)}
                  </td>
                </tr>
              ))}
              {report.b2b.length === 0 && (
                <tr>
                  <td colSpan={B2B_GST_COLUMNS.length} className="px-3 py-6 text-center text-ink-3">
                    No B2B invoices in this period.
                  </td>
                </tr>
              )}
            </tbody>
            {report.b2b.length > 0 && (
              <tfoot className="border-t border-line bg-surface-2/40 font-semibold text-ink">
                <tr>
                  <td colSpan={7} className="px-2.5 py-2 text-right">
                    B2B Total
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">
                    {formatINR(report.b2b_totals.taxable_value)}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(report.b2b_totals.cgst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(report.b2b_totals.sgst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(report.b2b_totals.igst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(report.b2b_totals.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* Section 2: B2C Table */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <SectionTitle>2. B2C Invoices — Unregistered Customers ({report.b2c.length})</SectionTitle>
            <p className="text-[12px] text-ink-3">
              Customers without a GSTIN. Same columns as B2B without the GSTIN column.
            </p>
          </div>
          <ButtonLink href={`/invoices/export/download?${queryBase}&format=b2c`} variant="secondary" size="sm">
            Download B2C CSV
          </ButtonLink>
        </div>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[11.5px] font-medium text-ink-2">
                {B2C_GST_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-2.5 py-2 whitespace-nowrap ${
                      ["taxable_value", "cgst", "sgst", "igst", "total"].includes(col.key)
                        ? "text-right"
                        : ""
                    }`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.b2c.map((row) => (
                <tr key={`${row.invoice_no}-${row.invoice_date}`}>
                  <td className="px-2.5 py-2 text-ink">{row.customer_name}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <Mono>{row.invoice_no}</Mono>
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 tabular-nums">{row.invoice_date}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">{row.place_of_supply}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                    <Mono>{row.sac || "—"}</Mono>
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{renderStatusBadge(row.status)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(row.taxable_value)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(row.cgst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(row.sgst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(row.igst)}</td>
                  <td className="px-2.5 py-2 text-right font-medium text-ink tabular-nums">
                    {formatINR(row.total)}
                  </td>
                </tr>
              ))}
              {report.b2c.length === 0 && (
                <tr>
                  <td colSpan={B2C_GST_COLUMNS.length} className="px-3 py-6 text-center text-ink-3">
                    No B2C invoices in this period.
                  </td>
                </tr>
              )}
            </tbody>
            {report.b2c.length > 0 && (
              <tfoot className="border-t border-line bg-surface-2/40 font-semibold text-ink">
                <tr>
                  <td colSpan={6} className="px-2.5 py-2 text-right">
                    B2C Total
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">
                    {formatINR(report.b2c_totals.taxable_value)}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(report.b2c_totals.cgst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(report.b2c_totals.sgst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(report.b2c_totals.igst)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatINR(report.b2c_totals.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
