"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  SecondaryButton,
  SectionTitle,
  Select,
  Status,
} from "@/components/ui";
import { shortDate } from "@/lib/dates";
import type {
  JobPaymentStatusRow,
  PaymentReceiptSummary,
} from "@/lib/modules/invoices/payments-received";
import { formatINR } from "../jobs/labels";
import { recordMultiJobPaymentAction } from "./actions";

export interface PaymentsReceivedSectionProps {
  jobs: JobPaymentStatusRow[];
  receipts: PaymentReceiptSummary[];
  customers: Array<{ id: string; name: string }>;
  today: string;
}

export function PaymentsReceivedSection({
  jobs,
  receipts,
  customers,
  today,
}: PaymentsReceivedSectionProps) {
  const [customerId, setCustomerId] = useState<string>("");
  const [viewFilter, setViewFilter] = useState<"all" | "pending" | "paid">("all");
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [customAmount, setCustomAmount] = useState<string>("");

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (customerId && j.customer_id !== customerId) return false;
      if (viewFilter === "pending" && j.is_paid) return false;
      if (viewFilter === "paid" && !j.is_paid) return false;
      return true;
    });
  }, [jobs, customerId, viewFilter]);

  const pendingInFilter = useMemo(
    () => filteredJobs.filter((j) => !j.is_paid),
    [filteredJobs],
  );

  const selectedBalanceSum = useMemo(() => {
    const idSet = new Set(selectedJobIds);
    return jobs
      .filter((j) => idSet.has(j.job_id))
      .reduce((sum, j) => sum + (j.outstanding_balance || 0), 0);
  }, [jobs, selectedJobIds]);

  function toggleJob(jobId: string) {
    setSelectedJobIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId],
    );
  }

  function selectAllPendingVisible() {
    setSelectedJobIds(pendingInFilter.map((j) => j.job_id));
  }

  function clearSelection() {
    setSelectedJobIds([]);
  }

  const paidCount = jobs.filter((j) => j.is_paid).length;
  const pendingCount = jobs.length - paidCount;

  return (
    <section className="mb-7 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>
          Payments received — Tick jobs paid ({pendingCount} pending · {paidCount} paid)
        </SectionTitle>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Filter by customer">
              <Select
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setSelectedJobIds([]);
                }}
                className="w-full sm:w-64"
              >
                <option value="">All customers ({jobs.length} jobs)</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-1.5 pb-0.5">
              {(
                [
                  { key: "all", label: `All jobs (${jobs.length})` },
                  { key: "pending", label: `Pending (${pendingCount})` },
                  { key: "paid", label: `Paid (${paidCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setViewFilter(tab.key)}
                  className={`rounded-lg px-3 py-1.5 text-[14px] font-medium transition ${
                    viewFilter === tab.key
                      ? "bg-ink text-white"
                      : "border border-line bg-white text-ink-2 hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {pendingInFilter.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton type="button" onClick={selectAllPendingVisible}>
                Tick all pending ({pendingInFilter.length})
              </SecondaryButton>
              {selectedJobIds.length > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-[13px] text-ink-3 underline hover:text-ink"
                >
                  Clear ({selectedJobIds.length})
                </button>
              )}
            </div>
          )}
        </div>

        <p className="text-[15px] text-ink-2">
          Tick every job the customer has paid for, then press <strong className="text-ink">Mark ticked jobs as Paid</strong>.
        </p>

        <form action={recordMultiJobPaymentAction} className="space-y-4">
          <input type="hidden" name="return_to" value="/invoices" />
          {customerId && <input type="hidden" name="customer_id" value={customerId} />}

          <div className="max-h-[420px] overflow-y-auto divide-y divide-line rounded-lg border border-line bg-white">
            {filteredJobs.map((j) => {
              const isChecked = j.is_paid || selectedJobIds.includes(j.job_id);
              return (
                <div
                  key={j.job_id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-[15px] ${
                    j.is_paid ? "bg-surface-2/40" : "hover:bg-surface-2"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 font-medium">
                      {j.is_paid ? (
                        <input
                          type="checkbox"
                          checked
                          disabled
                          className="h-4 w-4 rounded border-line accent-emerald-600"
                        />
                      ) : (
                        <input
                          type="checkbox"
                          name="job_ids"
                          value={j.job_id}
                          checked={isChecked}
                          onChange={() => toggleJob(j.job_id)}
                          className="h-4 w-4 rounded border-line"
                        />
                      )}
                      <span className="text-[13px] font-semibold text-ink">Paid</span>
                    </label>

                    <Link
                      href={`/jobs/${j.job_id}`}
                      className="font-mono text-[15px] font-semibold text-ink underline"
                    >
                      {j.job_no}
                    </Link>

                    {j.is_paid ? (
                      <Status tone="ok">Paid</Status>
                    ) : (
                      <Status tone="wait">Pending</Status>
                    )}

                    <span className="font-medium text-ink">{j.customer_name}</span>

                    {j.po_number && <Badge>PO {j.po_number}</Badge>}
                    {j.invoices.map((inv) => (
                      <span key={inv.id} className="inline-flex items-center gap-1 text-[13px] text-ink-2">
                        <Link href={`/invoices/${inv.id}`} className="font-mono underline">
                          {inv.invoice_no}
                        </Link>
                        {inv.days_since_invoice && inv.balance > 0 && (
                          <Badge>{inv.days_since_invoice}</Badge>
                        )}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-right">
                    {j.total_billed > 0 ? (
                      <div className="text-[13px] tabular-nums">
                        <span className="text-ink-3">Billed {formatINR(j.total_billed)}</span>
                        {j.outstanding_balance > 0 && (
                          <span className="ml-2 font-semibold text-ink">
                            · Due {formatINR(j.outstanding_balance)}
                          </span>
                        )}
                      </div>
                    ) : j.po_value ? (
                      <span className="text-[13px] text-ink-3 tabular-nums">
                        PO {formatINR(j.po_value)}
                      </span>
                    ) : (
                      <span className="text-[13px] text-ink-3">No issued invoice yet</span>
                    )}

                    {j.is_paid && j.paid_receipt_id && j.advice_path && (
                      <a
                        href={`/invoices/receipt-advice/${j.paid_receipt_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13px] font-medium text-ink underline"
                      >
                        Payment advice
                      </a>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredJobs.length === 0 && (
              <div className="px-4 py-6 text-center text-[15px] text-ink-3">
                No jobs match this filter.
              </div>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface-2/60 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13px] text-ink-2">
                Selected:{" "}
                <strong className="text-ink">
                  {selectedJobIds.length} job{selectedJobIds.length === 1 ? "" : "s"}
                </strong>
                {selectedBalanceSum > 0 && (
                  <span>
                    {" "}
                    · Total invoice balance:{" "}
                    <strong className="text-ink">{formatINR(selectedBalanceSum)}</strong>
                  </span>
                )}
              </div>
              <Button type="submit" disabled={selectedJobIds.length === 0}>
                Mark ticked jobs as Paid ({selectedJobIds.length})
              </Button>
            </div>

            <details className="border-t border-line pt-2.5">
              <summary className="cursor-pointer text-[13px] font-medium text-ink underline">
                Optional: Enter payment receipt details or upload customer payment advice / bank statement
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Payment date">
                  <Input type="date" name="received_on" defaultValue={today} />
                </Field>
                <Field
                  label="Amount received (INR, opt.)"
                  hint={
                    selectedBalanceSum > 0
                      ? `Defaults to ${formatINR(selectedBalanceSum)}`
                      : "Optional total amount"
                  }
                >
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    name="amount"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder={selectedBalanceSum > 0 ? String(selectedBalanceSum) : "0.00"}
                  />
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
                <div className="sm:col-span-2">
                  <Field label="Upload payment advice / bank statement (PDF, image, Excel)">
                    <Input
                      type="file"
                      name="advice_file"
                      accept=".pdf,image/*,.xlsx,.xls,.csv,.doc,.docx"
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Notes (optional)">
                    <Input
                      name="notes"
                      placeholder="e.g. Combined NEFT payment for 10 jobs"
                    />
                  </Field>
                </div>
              </div>
            </details>
          </div>
        </form>

        {receipts.length > 0 && (
          <div className="border-t border-line pt-3 space-y-2">
            <div className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">
              Recent multi-job payment receipts ({receipts.length})
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line bg-white text-[13px]">
              {receipts.slice(0, 10).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">
                      {shortDate(r.received_on)}
                    </span>
                    {r.customer_name && (
                      <span className="font-medium text-ink-2">
                        · {r.customer_name}
                      </span>
                    )}
                    <Badge>
                      {r.job_nos.length} job{r.job_nos.length === 1 ? "" : "s"}:{" "}
                      {r.job_nos.join(", ")}
                    </Badge>
                    {r.mode && <span className="text-ink-3">via {r.mode}</span>}
                    {r.reference && (
                      <span className="text-ink-3">· Ref: {r.reference}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {r.amount > 0 && (
                      <span className="font-semibold text-ink tabular-nums">
                        {formatINR(r.amount)}
                      </span>
                    )}
                    {r.advice_path && (
                      <a
                        href={`/invoices/receipt-advice/${r.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-ink underline"
                      >
                        Open payment advice
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}
