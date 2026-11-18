// Read-only answers for the Telegram executive bot. Plain lookups over the same tables the
// dashboard and the technician app use; no AI. Every reply is Telegram "Markdown" (legacy).
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIST } from "../../dates";
import type { Database } from "../../db/types";
import { getFinanceOverview } from "../finance/service";

type DB = SupabaseClient<Database>;
type Row = Record<string, unknown>;

const MAX_LEN = 3900; // Telegram limit is 4096 characters per message
const LIST_LIMIT = 15;

/** Reply keyboard shown under the chat: each button sends its own text. */
export const TELEGRAM_MENU_KEYBOARD: string[][] = [
  ["Status", "Jobs", "Reports"],
  ["Invoices", "Overdue", "Payments"],
  ["Today", "Week", "Leave"],
  ["Enquiries", "Quotations", "Customers"],
  ["Finance", "Expenses", "Equipment"],
  ["Field app", "Problems", "Team"],
  ["Help"],
];

// ---------- formatting helpers ----------

/** Escape a dynamic value for Telegram legacy Markdown. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/([_*`[])/g, "\\$1");
}

/** A short id-like value (Job ID, invoice no.) shown as code; backticks removed. */
function code(value: unknown): string {
  return "`" + String(value ?? "—").replace(/`/g, "") + "`";
}

function inr(amount: unknown): string {
  return `₹${Math.round(Number(amount) || 0).toLocaleString("en-IN")}`;
}

function nice(status: unknown): string {
  return esc(String(status ?? "").replace(/_/g, " "));
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function clip(text: string): string {
  if (text.length <= MAX_LEN) return text;
  const cut = text.slice(0, MAX_LEN);
  return cut.slice(0, cut.lastIndexOf("\n")) + "\n… _(list shortened; open the website for the full list)_";
}

function more(total: number, shown: number): string[] {
  return total > shown ? [`… and ${total - shown} more on the website.`] : [];
}

// ---------- shared lookups ----------

interface Lookups {
  people: Map<string, string>;
  customers: Map<string, string>;
  jobs: Map<string, { job_no: string; customer_id: string | null; status: string; site: string | null }>;
}

async function loadLookups(supabase: DB): Promise<Lookups> {
  const [p, c, j] = await Promise.all([
    supabase.from("people").select("id, full_name"),
    supabase.from("customers").select("id, name"),
    supabase.from("jobs").select("id, job_no, customer_id, status, site").is("deleted_at", null),
  ]);
  return {
    people: new Map((p.data ?? []).map((r) => [r.id, r.full_name])),
    customers: new Map((c.data ?? []).map((r) => [r.id, r.name])),
    jobs: new Map(
      (j.data ?? []).map((r) => [
        r.id,
        { job_no: r.job_no, customer_id: r.customer_id, status: r.status, site: r.site },
      ]),
    ),
  };
}

function jobLabel(l: Lookups, jobId: unknown): string {
  const job = l.jobs.get(String(jobId));
  if (!job) return "—";
  const cust = job.customer_id ? l.customers.get(job.customer_id) : null;
  return `${code(job.job_no)}${cust ? ` · ${esc(cust)}` : ""}`;
}

function person(l: Lookups, id: unknown): string {
  return esc(l.people.get(String(id)) ?? "—");
}

function onDate(a: { work_date: string; end_date: string | null }, day: string): boolean {
  return a.work_date <= day && (a.end_date ?? a.work_date) >= day;
}

// ---------- commands ----------

export async function statusReply(supabase: DB, today = todayIST()): Promise<string> {
  const [l, inv, rep, eq, asg, msgs] = await Promise.all([
    loadLookups(supabase),
    supabase
      .from("invoices")
      .select("balance, due_date")
      .eq("kind", "tax_invoice")
      .in("status", ["issued", "partly_paid"])
      .gt("balance", 0),
    supabase.from("reports").select("id").in("status", ["draft", "in_review", "returned"]),
    supabase.from("equipment").select("calibration_due").is("deleted_at", null).eq("active", true),
    supabase.from("assignments").select("work_date, end_date").lte("work_date", today),
    supabase.from("technician_messages").select("id").gte("received_at", `${addDays(today, -7)}T00:00:00Z`).neq("kind", "acknowledgement").neq("kind", "completion"),
  ]);
  const openJobs = [...l.jobs.values()].filter((j) => j.status !== "closed").length;
  const invoices = inv.data ?? [];
  const outstanding = invoices.reduce((s, i) => s + Number(i.balance), 0);
  const overdue = invoices.filter((i) => i.due_date && i.due_date < today);
  const horizon = addDays(today, 30);
  const calib = (eq.data ?? []).filter((e) => e.calibration_due && e.calibration_due <= horizon).length;
  const onSite = (asg.data ?? []).filter((a) => onDate(a, today)).length;
  return [
    `*BITA summary – ${today}*`,
    "",
    `• Open jobs: *${openJobs}*`,
    `• Reports being prepared, returned or waiting for approval: *${(rep.data ?? []).length}*`,
    `• Outstanding: *${inr(outstanding)}* on ${invoices.length} tax invoice(s)`,
    `• Overdue: *${overdue.length}* (${inr(overdue.reduce((s, i) => s + Number(i.balance), 0))})`,
    `• On site today: *${onSite}* assignment(s)`,
    `• Calibration due within 30 days: *${calib}*`,
    `• Technician problems in the last 7 days: *${(msgs.data ?? []).length}*`,
    "",
    "Tap a button below or send /help.",
  ].join("\n");
}

export async function jobsReply(supabase: DB): Promise<string> {
  const l = await loadLookups(supabase);
  const open = [...l.jobs.values()].filter((j) => j.status !== "closed");
  const byStatus = new Map<string, number>();
  for (const j of open) byStatus.set(j.status, (byStatus.get(j.status) ?? 0) + 1);
  return [
    `*Open jobs (${open.length})*`,
    [...byStatus].map(([s, n]) => `${nice(s)}: ${n}`).join(" · "),
    "",
    ...open.slice(0, LIST_LIMIT).map(
      (j) =>
        `• ${code(j.job_no)} ${esc(j.customer_id ? l.customers.get(j.customer_id) ?? "" : "")} – _${nice(j.status)}_${j.site ? ` (${esc(j.site)})` : ""}`,
    ),
    ...more(open.length, LIST_LIMIT),
    "",
    "Details of one job: /job BITA/26-27/0001",
  ].join("\n");
}

export async function jobDetailReply(supabase: DB, query: string): Promise<string> {
  const q = query.trim().toUpperCase();
  if (!q) return "Send the Job ID, for example: /job BITA/26-27/0001";
  const { data: job } = await supabase
    .from("jobs")
    .select("id, job_no, status, site, scope, customer_id, po_number, po_value")
    .ilike("job_no", `%${q}%`)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!job) return `No job found matching ${code(q)}.`;
  const [l, asg, insp, reps, invs, exps] = await Promise.all([
    loadLookups(supabase),
    supabase.from("assignments").select("person_id, work_date, end_date, started_at, completed_at").eq("job_id", job.id),
    supabase.from("inspections").select("method, submitted_at").eq("job_id", job.id),
    supabase.from("reports").select("report_no, method, status, sent_at").eq("job_id", job.id),
    supabase.from("invoices").select("invoice_no, number, kind, status, total, balance").eq("job_id", job.id),
    supabase.from("job_expenses").select("amount").eq("job_id", job.id).is("deleted_at", null),
  ]);
  const j = job as unknown as Row;
  const lines = [
    `*Job ${code(j.job_no)}*`,
    `• Customer: ${esc(l.customers.get(String(j.customer_id)) ?? "—")}`,
    `• Status: _${nice(j.status)}_`,
    `• Site: ${esc(j.site ?? "—")}`,
    `• Scope: ${esc(j.scope ?? "—")}`,
    `• PO: ${j.po_number ? esc(j.po_number) : "no PO number"}${j.po_value ? `, value ${inr(j.po_value)}` : ""}`,
    "",
    "*Technicians*",
    ...((asg.data ?? []).length
      ? (asg.data ?? []).map(
          (a) =>
            `• ${person(l, a.person_id)}: ${a.work_date}${a.end_date && a.end_date !== a.work_date ? ` to ${a.end_date}` : ""}${a.completed_at ? " – done" : a.started_at ? " – started" : ""}`,
        )
      : ["• Not assigned yet"]),
    "",
    "*Field reports from phone*",
    ...((insp.data ?? []).length
      ? (insp.data ?? []).map((i) => `• ${esc(i.method)}: ${i.submitted_at ? `submitted ${i.submitted_at.slice(0, 10)}` : "draft"}`)
      : ["• None yet"]),
    "",
    "*Reports*",
    ...((reps.data ?? []).length
      ? (reps.data ?? []).map((r) => `• ${esc(r.report_no)} (${esc(r.method)}) – _${nice(r.status)}_`)
      : ["• None yet"]),
    "",
    "*Invoices*",
    ...((invs.data ?? []).length
      ? (invs.data ?? []).map(
          (i) =>
            `• ${code(i.invoice_no ?? i.number ?? "draft")} ${i.kind === "proforma" ? "proforma" : "tax"} – ${nice(i.status)}, total ${inr(i.total)}, balance ${inr(i.balance)}`,
        )
      : ["• Not billed yet"]),
    "",
    `Expenses booked: ${inr((exps.data ?? []).reduce((s, e) => s + Number(e.amount), 0))}`,
  ];
  return lines.join("\n");
}

export async function reportsReply(supabase: DB): Promise<string> {
  const [l, reps, insp, links, invByReport] = await Promise.all([
    loadLookups(supabase),
    supabase.from("reports").select("id, report_no, job_id, status, inspection_id"),
    supabase.from("inspections").select("id, job_id, method, submitted_at").not("submitted_at", "is", null),
    supabase.from("invoice_reports").select("report_id"),
    supabase.from("invoices").select("report_id").not("report_id", "is", null).neq("status", "cancelled"),
  ]);
  const reports = reps.data ?? [];
  const withReport = new Set(reports.map((r) => r.inspection_id).filter(Boolean));
  const toPrepare = (insp.data ?? []).filter((i) => !withReport.has(i.id));
  const billed = new Set([
    ...(links.data ?? []).map((r) => r.report_id),
    ...(invByReport.data ?? []).map((r) => r.report_id),
  ]);
  const group = (st: string[]) => reports.filter((r) => st.includes(r.status));
  const inReview = group(["in_review"]);
  const drafts = group(["draft", "returned"]);
  const approvedNotSent = group(["approved"]);
  const invoicePending = group(["approved", "sent"]).filter((r) => !billed.has(r.id));
  const list = (rows: Array<{ report_no: string; job_id: string; status: string }>) =>
    rows.slice(0, 8).map((r) => `• ${esc(r.report_no)} · ${jobLabel(l, r.job_id)}${r.status === "returned" ? " _(returned to technician)_" : ""}`);
  return [
    "*Reports*",
    "",
    `*Submitted from phone, report not prepared yet (${toPrepare.length})*`,
    ...toPrepare.slice(0, 8).map((i) => `• ${esc(i.method)} · ${jobLabel(l, i.job_id)} (${i.submitted_at?.slice(0, 10)})`),
    "",
    `*Waiting for approval (${inReview.length})*`,
    ...list(inReview),
    "",
    `*Being prepared or returned (${drafts.length})*`,
    ...list(drafts),
    "",
    `*Approved, not yet sent to customer (${approvedNotSent.length})*`,
    ...list(approvedNotSent),
    "",
    `*Invoice pending (${invoicePending.length})*`,
    ...list(invoicePending),
  ].join("\n");
}

export async function invoicesReply(supabase: DB, today = todayIST()): Promise<string> {
  const [l, inv] = await Promise.all([
    loadLookups(supabase),
    supabase
      .from("invoices")
      .select("invoice_no, number, kind, status, total, balance, due_date, job_id, converted_from_id")
      .neq("status", "cancelled"),
  ]);
  const rows = inv.data ?? [];
  const open = rows
    .filter((i) => i.kind === "tax_invoice" && ["issued", "partly_paid"].includes(i.status) && Number(i.balance) > 0)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const drafts = rows.filter((i) => i.status === "draft");
  return [
    `*Open tax invoices (${open.length}) – ${inr(open.reduce((s, i) => s + Number(i.balance), 0))} outstanding*`,
    "",
    ...open.slice(0, LIST_LIMIT).map(
      (i) =>
        `• ${code(i.invoice_no ?? i.number)} · ${jobLabel(l, i.job_id)} · bal *${inr(i.balance)}*${i.due_date ? ` · due ${i.due_date}${i.due_date < today ? " (overdue)" : ""}` : ""}`,
    ),
    ...more(open.length, LIST_LIMIT),
    "",
    `Draft invoices not issued: ${drafts.length} · Proformas not converted: /proformas`,
    "One invoice in detail: /invoice <number>",
  ].join("\n");
}

export async function invoiceDetailReply(supabase: DB, query: string): Promise<string> {
  const q = query.trim();
  if (!q) return "Send the invoice number, for example: /invoice 5388";
  const { data: rows } = await supabase
    .from("invoices")
    .select("id, invoice_no, number, kind, status, invoice_date, due_date, taxable_value, cgst, sgst, igst, total, balance, job_id, customer_po_number")
    .or(`invoice_no.ilike.%${q.replace(/[,()%]/g, "")}%,number.ilike.%${q.replace(/[,()%]/g, "")}%`)
    .limit(1);
  const inv = rows?.[0];
  if (!inv) return `No invoice found matching ${code(q)}.`;
  const [l, pays, cns] = await Promise.all([
    loadLookups(supabase),
    supabase.from("payments").select("paid_on, amount, tds_amount, mode, reference").eq("invoice_id", inv.id).order("paid_on"),
    supabase.from("credit_notes").select("credit_note_no, credit_date, total, status").eq("invoice_id", inv.id),
  ]);
  return [
    `*${inv.kind === "proforma" ? "Proforma" : "Tax invoice"} ${code(inv.invoice_no ?? inv.number ?? "draft")}*`,
    `• Job: ${jobLabel(l, inv.job_id)}`,
    `• Status: _${nice(inv.status)}_ · dated ${inv.invoice_date ?? "—"} · due ${inv.due_date ?? "—"}`,
    `• PO: ${esc(inv.customer_po_number ?? "—")}`,
    `• Taxable ${inr(inv.taxable_value)} + GST ${inr(Number(inv.cgst) + Number(inv.sgst) + Number(inv.igst))} = *${inr(inv.total)}*`,
    `• Balance due: *${inr(inv.balance)}*`,
    "",
    "*Payments*",
    ...((pays.data ?? []).length
      ? (pays.data ?? []).map((p) => `• ${p.paid_on}: ${inr(p.amount)} + TDS ${inr(p.tds_amount)}${p.mode ? ` (${esc(p.mode)})` : ""}`)
      : ["• None yet"]),
    "",
    "*Credit notes*",
    ...((cns.data ?? []).length
      ? (cns.data ?? []).map((c) => `• ${esc(c.credit_note_no ?? "draft")} ${c.credit_date}: ${inr(c.total)} (${nice(c.status)})`)
      : ["• None"]),
  ].join("\n");
}

export async function overdueReply(supabase: DB, today = todayIST()): Promise<string> {
  const ov = await getFinanceOverview(supabase, { asOfDate: today });
  const rows = ov.ageing.customers
    .flatMap((c) => c.invoices)
    .filter((i) => i.days_overdue > 0 && i.net_balance > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue);
  if (rows.length === 0) return `*No overdue tax invoices on ${today}.*`;
  return [
    `*Overdue invoices (${rows.length}) – ${inr(rows.reduce((s, i) => s + i.net_balance, 0))}*`,
    "",
    ...rows.slice(0, LIST_LIMIT).map(
      (i) => `• ${code(i.invoice_no)} · ${esc(i.customer_name)} · *${inr(i.net_balance)}* · ${i.days_overdue} days late`,
    ),
    ...more(rows.length, LIST_LIMIT),
  ].join("\n");
}

export async function paymentsReply(supabase: DB, month?: string, today = todayIST()): Promise<string> {
  const ov = await getFinanceOverview(supabase, { month: month || monthOf(today), asOfDate: today });
  const p = ov.monthly_payments;
  return [
    `*Payments received in ${p.month}*`,
    `Received ${inr(p.totals.amount_received)} + TDS ${inr(p.totals.tds_total)} = *${inr(p.totals.total_settled)}* (${p.totals.payment_count} payments)`,
    "",
    ...p.payments.slice(0, LIST_LIMIT).map(
      (r) => `• ${r.paid_on} · ${code(r.invoice_no)} · ${esc(r.customer_name)} · ${inr(r.amount)}${r.tds_amount ? ` + TDS ${inr(r.tds_amount)}` : ""}`,
    ),
    ...more(p.payments.length, LIST_LIMIT),
    "",
    "Another month: /payments 2026-10",
  ].join("\n");
}

export async function financeReply(supabase: DB, fy?: string, today = todayIST()): Promise<string> {
  const ov = await getFinanceOverview(supabase, { fy: fy || null, asOfDate: today });
  const a = ov.ageing.totals;
  const r = ov.customer_revenue.totals;
  const thisMonth = ov.monthly_income_vs_expenses.months.find((m) => m.month === monthOf(today));
  const top = [...ov.customer_revenue.customers].sort((x, y) => y.outstanding_balance - x.outstanding_balance).filter((c) => c.outstanding_balance > 0).slice(0, 5);
  return [
    `*Finance – FY ${esc(ov.fy)}*`,
    "",
    `• Net invoiced: *${inr(r.net_invoiced)}* (taxable ${inr(r.net_taxable_revenue)}, GST ${inr(r.gst_total)})`,
    `• Received: ${inr(r.paid_amount)} + TDS ${inr(r.tds_amount)}`,
    `• Outstanding: *${inr(a.total_outstanding)}*`,
    `  not due ${inr(a.not_due)} · 0–30 days ${inr(a.days_0_30)} · 31–60 ${inr(a.days_31_60)} · 61–90 ${inr(a.days_61_90)} · 90+ ${inr(a.days_90_plus)}`,
    ...(thisMonth
      ? [
          "",
          `*${esc(thisMonth.label)}*: income ${inr(thisMonth.net_income)}, expenses ${inr(thisMonth.expenses_total)}, surplus *${inr(thisMonth.net_operating_surplus)}*`,
        ]
      : []),
    `• FY totals: income ${inr(ov.monthly_income_vs_expenses.totals.net_income)}, expenses ${inr(ov.monthly_income_vs_expenses.totals.expenses_total)}`,
    `• Proformas not converted: ${ov.unconverted_proformas.totals.proforma_count} (${inr(ov.unconverted_proformas.totals.total_value)})`,
    "",
    "*Highest outstanding*",
    ...(top.length ? top.map((c) => `• ${esc(c.customer_name)}: ${inr(c.outstanding_balance)}`) : ["• Nothing outstanding"]),
    "",
    "Other year: /finance 2025-26 · /payments · /overdue · /proformas",
  ].join("\n");
}

export async function proformasReply(supabase: DB, today = todayIST()): Promise<string> {
  const ov = await getFinanceOverview(supabase, { asOfDate: today });
  const p = ov.unconverted_proformas;
  if (p.proformas.length === 0) return "*Every issued proforma has been converted to a tax invoice.*";
  return [
    `*Proformas not converted (${p.totals.proforma_count}) – ${inr(p.totals.total_value)}*`,
    "",
    ...p.proformas.slice(0, LIST_LIMIT).map(
      (r) => `• ${code(r.invoice_no)} · ${code(r.job_no)} · ${esc(r.customer_name)} · ${inr(r.total)} · ${r.age_days} days old`,
    ),
    ...more(p.proformas.length, LIST_LIMIT),
  ].join("\n");
}

export async function expensesReply(supabase: DB, month?: string, today = todayIST()): Promise<string> {
  const m = /^\d{4}-\d{2}$/.test(month ?? "") ? (month as string) : monthOf(today);
  const [l, ex] = await Promise.all([
    loadLookups(supabase),
    supabase
      .from("job_expenses")
      .select("expense_date, kind, amount, job_id, person_id, note")
      .is("deleted_at", null)
      .gte("expense_date", `${m}-01`)
      .lt("expense_date", addDays(`${m}-28`, 7).slice(0, 7) + "-01")
      .order("expense_date", { ascending: false }),
  ]);
  const rows = ex.data ?? [];
  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + Number(r.amount));
  return [
    `*Log book expenses – ${m}: ${inr(rows.reduce((s, r) => s + Number(r.amount), 0))}*`,
    [...byKind].map(([k, v]) => `${esc(k)} ${inr(v)}`).join(" · ") || "No expenses recorded.",
    "",
    ...rows.slice(0, LIST_LIMIT).map(
      (r) => `• ${r.expense_date} · ${inr(r.amount)} ${esc(r.kind)} · ${jobLabel(l, r.job_id)}${r.person_id ? ` · ${person(l, r.person_id)}` : ""}`,
    ),
    ...more(rows.length, LIST_LIMIT),
    "",
    "Another month: /expenses 2026-10",
  ].join("\n");
}

async function scheduleBetween(supabase: DB, from: string, to: string) {
  const [l, asg, leave] = await Promise.all([
    loadLookups(supabase),
    supabase.from("assignments").select("job_id, person_id, work_date, end_date, started_at, completed_at").lte("work_date", to),
    supabase.from("leave_days").select("person_id, leave_date, reason").gte("leave_date", from).lte("leave_date", to).order("leave_date"),
  ]);
  const rows = (asg.data ?? []).filter((a) => (a.end_date ?? a.work_date) >= from);
  return { l, rows, leave: leave.data ?? [] };
}

export async function todayReply(supabase: DB, today = todayIST()): Promise<string> {
  const { l, rows, leave } = await scheduleBetween(supabase, today, today);
  const busy = new Set(rows.map((a) => a.person_id));
  const onLeave = new Set(leave.map((x) => x.person_id));
  const { data: techs } = await supabase.from("people").select("id, full_name, roles").eq("active", true).is("deleted_at", null);
  const free = (techs ?? []).filter((t) => t.roles.includes("technician") && !busy.has(t.id) && !onLeave.has(t.id));
  return [
    `*Today – ${today}*`,
    "",
    `*On site (${rows.length})*`,
    ...(rows.length
      ? rows.map((a) => `• ${person(l, a.person_id)} → ${jobLabel(l, a.job_id)}${a.completed_at ? " – done" : a.started_at ? " – started" : " – not started"}`)
      : ["• Nobody scheduled"]),
    "",
    `*On leave (${leave.length})*`,
    ...(leave.length ? leave.map((x) => `• ${person(l, x.person_id)}${x.reason ? ` (${esc(x.reason)})` : ""}`) : ["• Nobody"]),
    "",
    `*Free technicians:* ${free.length ? free.map((t) => esc(t.full_name)).join(", ") : "none"}`,
  ].join("\n");
}

export async function weekReply(supabase: DB, today = todayIST()): Promise<string> {
  const end = addDays(today, 6);
  const { l, rows, leave } = await scheduleBetween(supabase, today, end);
  const lines = [`*Next 7 days (${today} to ${end})*`];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(today, i);
    const jobs = rows.filter((a) => onDate(a, day));
    const off = leave.filter((x) => x.leave_date === day);
    if (!jobs.length && !off.length) continue;
    lines.push("", `*${day}*`);
    for (const a of jobs) lines.push(`• ${person(l, a.person_id)} → ${jobLabel(l, a.job_id)}`);
    for (const x of off) lines.push(`• ${person(l, x.person_id)} on leave`);
  }
  if (lines.length === 1) lines.push("", "Nothing scheduled.");
  return lines.join("\n");
}

export async function leaveReply(supabase: DB, today = todayIST()): Promise<string> {
  const end = addDays(today, 30);
  const [l, leave, hol] = await Promise.all([
    loadLookups(supabase),
    supabase.from("leave_days").select("person_id, leave_date, reason").gte("leave_date", today).lte("leave_date", end).order("leave_date"),
    supabase.from("settings").select("value").eq("key", "holidays").maybeSingle(),
  ]);
  const holidays = (Array.isArray(hol.data?.value) ? (hol.data?.value as Row[]) : [])
    .map((h) => ({ date: String(h.date ?? ""), name: String(h.name ?? h.label ?? "") }))
    .filter((h) => h.date >= today && h.date <= end);
  return [
    "*Leave in the next 30 days*",
    ...((leave.data ?? []).length
      ? (leave.data ?? []).map((x) => `• ${x.leave_date} · ${person(l, x.person_id)}${x.reason ? ` (${esc(x.reason)})` : ""}`)
      : ["• None recorded"]),
    "",
    "*Company holidays*",
    ...(holidays.length ? holidays.map((h) => `• ${h.date} ${esc(h.name)}`) : ["• None in the next 30 days"]),
  ].join("\n");
}

export async function enquiriesReply(supabase: DB): Promise<string> {
  const [l, enq] = await Promise.all([
    loadLookups(supabase),
    supabase
      .from("enquiries")
      .select("received_at, source, status, subject, from_name, customer_id")
      .is("deleted_at", null)
      .in("status", ["new", "linked", "quoted"])
      .order("received_at", { ascending: false }),
  ]);
  const rows = enq.data ?? [];
  return [
    `*Open enquiries (${rows.length})*`,
    "",
    ...rows.slice(0, LIST_LIMIT).map(
      (e) =>
        `• ${e.received_at.slice(0, 10)} · ${esc(e.customer_id ? l.customers.get(e.customer_id) ?? "" : e.from_name ?? "Unknown")} · ${esc(e.subject ?? "(no subject)")} – _${nice(e.status)}_ (${esc(e.source)})`,
    ),
    ...(rows.length ? more(rows.length, LIST_LIMIT) : ["No open enquiries."]),
  ].join("\n");
}

export async function quotationsReply(supabase: DB, today = todayIST()): Promise<string> {
  const [l, q] = await Promise.all([
    loadLookups(supabase),
    supabase
      .from("quotations")
      .select("ref_no, quote_date, status, subject, customer_id")
      .is("deleted_at", null)
      .order("quote_date", { ascending: false }),
  ]);
  const rows = q.data ?? [];
  const waiting = rows.filter((r) => ["draft", "approved", "sent"].includes(r.status));
  const acceptedThisMonth = rows.filter((r) => r.status === "accepted" && r.quote_date.startsWith(monthOf(today))).length;
  return [
    `*Quotations waiting for the customer or not sent (${waiting.length})*`,
    "",
    ...waiting.slice(0, LIST_LIMIT).map(
      (r) => `• ${esc(r.ref_no ?? "no ref")} · ${r.quote_date} · ${esc(l.customers.get(r.customer_id) ?? "")} – _${nice(r.status)}_${r.subject ? ` · ${esc(r.subject)}` : ""}`,
    ),
    ...more(waiting.length, LIST_LIMIT),
    "",
    `Accepted with quotation date this month: ${acceptedThisMonth}`,
  ].join("\n");
}

export async function customersReply(supabase: DB, today = todayIST()): Promise<string> {
  const [{ data: cust }, ov, l] = await Promise.all([
    supabase.from("customers").select("id, name").is("deleted_at", null).order("name"),
    getFinanceOverview(supabase, { asOfDate: today }),
    loadLookups(supabase),
  ]);
  const owed = new Map(ov.ageing.customers.map((c) => [c.customer_id, c.total_outstanding]));
  const openJobs = new Map<string, number>();
  for (const j of l.jobs.values()) if (j.customer_id && j.status !== "closed") openJobs.set(j.customer_id, (openJobs.get(j.customer_id) ?? 0) + 1);
  const rows = (cust ?? []).map((c) => ({ ...c, owed: owed.get(c.id) ?? 0, jobs: openJobs.get(c.id) ?? 0 })).sort((a, b) => b.owed - a.owed);
  return [
    `*Customers (${rows.length})*`,
    "",
    ...rows.slice(0, 20).map((c) => `• ${esc(c.name)} – ${c.jobs} open job(s)${c.owed ? `, owes *${inr(c.owed)}*` : ""}`),
    ...more(rows.length, 20),
    "",
    "One customer in detail: /customer <part of name>",
  ].join("\n");
}

export async function customerDetailReply(supabase: DB, query: string, today = todayIST()): Promise<string | null> {
  const q = query.trim().replace(/[,()%]/g, "");
  if (q.length < 3) return null;
  const { data: matches } = await supabase.from("customers").select("id, name, gstin, payment_terms_days, uses_proforma").is("deleted_at", null).ilike("name", `%${q}%`).limit(5);
  if (!matches || matches.length === 0) return null;
  if (matches.length > 1) return ["*Several customers match:*", ...matches.map((m) => `• ${esc(m.name)}`), "", "Send /customer with more of the name."].join("\n");
  const c = matches[0];
  const [contacts, l, ov, enq] = await Promise.all([
    supabase.from("customer_contacts").select("name, mobile, email, receives_invoices, receives_reports").eq("customer_id", c.id),
    loadLookups(supabase),
    getFinanceOverview(supabase, { asOfDate: today }),
    supabase.from("enquiries").select("id").eq("customer_id", c.id).is("deleted_at", null).in("status", ["new", "linked", "quoted"]),
  ]);
  const ageing = ov.ageing.customers.find((x) => x.customer_id === c.id);
  const revenue = ov.customer_revenue.customers.find((x) => x.customer_id === c.id);
  const jobs = [...l.jobs.values()].filter((j) => j.customer_id === c.id && j.status !== "closed");
  return [
    `*${esc(c.name)}*`,
    `GSTIN ${esc(c.gstin ?? "—")} · terms ${c.payment_terms_days} days${c.uses_proforma ? " · proforma first" : ""}`,
    "",
    `• Outstanding: *${inr(ageing?.total_outstanding ?? 0)}*${ageing && ageing.days_0_30 + ageing.days_31_60 + ageing.days_61_90 + ageing.days_90_plus > 0 ? ` (overdue ${inr(ageing.days_0_30 + ageing.days_31_60 + ageing.days_61_90 + ageing.days_90_plus)})` : ""}`,
    `• Invoiced this FY: ${inr(revenue?.net_invoiced ?? 0)}`,
    `• Open enquiries: ${(enq.data ?? []).length}`,
    "",
    `*Open jobs (${jobs.length})*`,
    ...(jobs.length ? jobs.slice(0, 10).map((j) => `• ${code(j.job_no)} – _${nice(j.status)}_`) : ["• None"]),
    "",
    "*Contacts*",
    ...((contacts.data ?? []).length
      ? (contacts.data ?? []).map(
          (p) => `• ${esc(p.name)}${p.mobile ? ` · ${esc(p.mobile)}` : ""}${p.email ? ` · ${esc(p.email)}` : ""}${p.receives_invoices ? " · invoices" : ""}${p.receives_reports ? " · reports" : ""}`,
        )
      : ["• None"]),
  ].join("\n");
}

export async function equipmentReply(supabase: DB, today = todayIST()): Promise<string> {
  const [l, eq, types] = await Promise.all([
    loadLookups(supabase),
    supabase.from("equipment").select("make, model, serial_no, status, current_location, current_job_id, calibration_due, equipment_type_id").is("deleted_at", null).eq("active", true),
    supabase.from("equipment_types").select("id, name"),
  ]);
  const typeName = new Map((types.data ?? []).map((t) => [t.id, t.name]));
  const rows = eq.data ?? [];
  const label = (e: (typeof rows)[number]) =>
    esc([e.equipment_type_id ? typeName.get(e.equipment_type_id) : null, e.make, e.model, e.serial_no ? `S/N ${e.serial_no}` : null].filter(Boolean).join(" "));
  const horizon = addDays(today, 30);
  const calib = rows.filter((e) => e.calibration_due && e.calibration_due <= horizon).sort((a, b) => String(a.calibration_due).localeCompare(String(b.calibration_due)));
  const away = rows.filter((e) => e.status !== "in_office");
  return [
    `*Equipment (${rows.length} active)*`,
    "",
    `*Calibration due within 30 days (${calib.length})*`,
    ...(calib.length ? calib.map((e) => `• ${label(e)}: ${e.calibration_due! < today ? "*EXPIRED*" : "due"} ${e.calibration_due}`) : ["• All valid"]),
    "",
    `*Out of the office (${away.length})*`,
    ...(away.length
      ? away.map((e) => `• ${label(e)} – ${nice(e.status)}${e.current_job_id ? ` · ${jobLabel(l, e.current_job_id)}` : ""}${e.current_location ? ` · ${esc(e.current_location)}` : ""}`)
      : ["• Everything is in the office"]),
  ].join("\n");
}

const PROBLEM_KINDS = ["delay", "leave", "equipment_problem", "site_issue", "other"] as const;

export async function problemsReply(supabase: DB, today = todayIST()): Promise<string> {
  const [l, msgs] = await Promise.all([
    loadLookups(supabase),
    supabase
      .from("technician_messages")
      .select("kind, body, job_id, person_id, received_at")
      .in("kind", [...PROBLEM_KINDS])
      .gte("received_at", `${addDays(today, -14)}T00:00:00Z`)
      .order("received_at", { ascending: false }),
  ]);
  const rows = msgs.data ?? [];
  return [
    `*Problems reported from the phone app – last 14 days (${rows.length})*`,
    "",
    ...(rows.length
      ? rows.slice(0, LIST_LIMIT).map(
          (m) => `• ${m.received_at.slice(0, 10)} · ${person(l, m.person_id)} · *${nice(m.kind)}*${m.job_id ? ` · ${jobLabel(l, m.job_id)}` : ""}${m.body ? `\n   ${esc(m.body.slice(0, 200))}` : ""}`,
        )
      : ["None."]),
    ...more(rows.length, LIST_LIMIT),
  ].join("\n");
}

export async function fieldReply(supabase: DB, today = todayIST()): Promise<string> {
  const since = `${addDays(today, -7)}T00:00:00Z`;
  const [l, devices, insp, edits, msgs] = await Promise.all([
    loadLookups(supabase),
    supabase.from("technician_devices").select("person_id, device_name, last_seen_at").is("revoked_at", null),
    supabase.from("inspections").select("job_id, method, submitted_at, submitted_by").gte("submitted_at", since).order("submitted_at", { ascending: false }),
    supabase.from("inspection_edits").select("job_id, edited_by, edited_at").is("reviewed_at", null).order("edited_at", { ascending: false }),
    supabase.from("technician_messages").select("kind, person_id, job_id, received_at").gte("received_at", since).order("received_at", { ascending: false }),
  ]);
  return [
    "*Technician phone app*",
    "",
    `*Linked phones (${(devices.data ?? []).length})*`,
    ...(devices.data ?? []).map((d) => `• ${person(l, d.person_id)}${d.device_name ? ` · ${esc(d.device_name)}` : ""} · last seen ${d.last_seen_at ? d.last_seen_at.slice(0, 16).replace("T", " ") : "never"}`),
    "",
    `*Reports submitted in the last 7 days (${(insp.data ?? []).length})*`,
    ...(insp.data ?? []).slice(0, 10).map((i) => `• ${i.submitted_at?.slice(0, 10)} · ${esc(i.method)} · ${jobLabel(l, i.job_id)} · ${person(l, i.submitted_by)}`),
    "",
    `*Edits after submit, not yet reviewed (${(edits.data ?? []).length})*`,
    ...(edits.data ?? []).slice(0, 10).map((e) => `• ${e.edited_at.slice(0, 10)} · ${jobLabel(l, e.job_id)} · ${person(l, e.edited_by)}`),
    "",
    `*Updates from phones in the last 7 days (${(msgs.data ?? []).length})*`,
    ...(msgs.data ?? []).slice(0, 10).map((m) => `• ${m.received_at.slice(0, 10)} · ${person(l, m.person_id)} · ${nice(m.kind)}${m.job_id ? ` · ${jobLabel(l, m.job_id)}` : ""}`),
    "",
    "Problems only: /problems",
  ].join("\n");
}

export async function teamReply(supabase: DB, today = todayIST()): Promise<string> {
  const [people, asg, leave, quals] = await Promise.all([
    supabase.from("people").select("id, full_name, position, roles").eq("active", true).is("deleted_at", null).order("full_name"),
    supabase.from("assignments").select("person_id, work_date, end_date, job_id").lte("work_date", today),
    supabase.from("leave_days").select("person_id").eq("leave_date", today),
    supabase.from("qualifications").select("person_id, method, level, valid_until").not("valid_until", "is", null).lte("valid_until", addDays(today, 60)),
  ]);
  const l = await loadLookups(supabase);
  const todayJob = new Map((asg.data ?? []).filter((a) => onDate(a, today)).map((a) => [a.person_id, a.job_id]));
  const off = new Set((leave.data ?? []).map((x) => x.person_id));
  return [
    `*Team (${(people.data ?? []).length} active)*`,
    "",
    ...(people.data ?? []).map((p) => {
      const where = off.has(p.id) ? "on leave" : todayJob.has(p.id) ? `on site ${jobLabel(l, todayJob.get(p.id))}` : "free today";
      return `• ${esc(p.full_name)}${p.position ? ` – ${esc(p.position)}` : ""} · ${where}`;
    }),
    "",
    `*Certificates expiring within 60 days (${(quals.data ?? []).length})*`,
    ...((quals.data ?? []).length
      ? (quals.data ?? []).map((q) => `• ${person(l, q.person_id)} · ${esc(q.method)} ${esc(q.level)} · ${q.valid_until! < today ? "*EXPIRED*" : "valid until"} ${q.valid_until}`)
      : ["• None"]),
  ].join("\n");
}

export function helpReply(): string {
  return [
    "*BITA bot – what you can ask*",
    "Tap a button below, or send:",
    "",
    "/status – summary of everything",
    "/jobs – open jobs · /job BITA/26-27/0001 – one job",
    "/reports – reports to prepare, approve, send or invoice",
    "/invoices – open invoices · /invoice 5388 – one invoice",
    "/overdue – late payments · /payments – this month's receipts and TDS",
    "/finance – year totals and ageing · /proformas – not converted",
    "/expenses – log book this month",
    "/today – who is where · /week – next 7 days · /leave – leave and holidays",
    "/enquiries · /quotations",
    "/customers · /customer <name> – one customer",
    "/equipment – calibration and what is out of office",
    "/field – phone app activity · /problems – problems from technicians",
    "/team – staff today and certificates expiring",
    "",
    "You can also type a few words, for example _overdue invoices_, _who is on leave_, or a customer name.",
  ].join("\n");
}

// ---------- routing ----------

type Handler = (supabase: DB, arg: string) => Promise<string | null>;

const COMMANDS: Record<string, Handler> = {
  status: (s) => statusReply(s),
  dashboard: (s) => statusReply(s),
  summary: (s) => statusReply(s),
  jobs: (s) => jobsReply(s),
  job: (s, a) => jobDetailReply(s, a),
  reports: (s) => reportsReply(s),
  invoices: (s) => invoicesReply(s),
  receivables: (s) => invoicesReply(s),
  invoice: (s, a) => invoiceDetailReply(s, a),
  overdue: (s) => overdueReply(s),
  payments: (s, a) => paymentsReply(s, a),
  finance: (s, a) => financeReply(s, a),
  proformas: (s) => proformasReply(s),
  expenses: (s, a) => expensesReply(s, a),
  logbook: (s, a) => expensesReply(s, a),
  today: (s) => todayReply(s),
  schedule: (s) => todayReply(s),
  calendar: (s) => weekReply(s),
  week: (s) => weekReply(s),
  leave: (s) => leaveReply(s),
  enquiries: (s) => enquiriesReply(s),
  quotations: (s) => quotationsReply(s),
  customers: (s) => customersReply(s),
  customer: async (s, a) => (await customerDetailReply(s, a)) ?? `No customer matches ${code(a || "?")}. Send /customers for the list.`,
  equipment: (s) => equipmentReply(s),
  calibration: (s) => equipmentReply(s),
  field: (s) => fieldReply(s),
  fieldapp: (s) => fieldReply(s),
  phone: (s) => fieldReply(s),
  problems: (s) => problemsReply(s),
  team: (s) => teamReply(s),
  staff: (s) => teamReply(s),
  employees: (s) => teamReply(s),
  help: async () => helpReply(),
  start: async () => helpReply(),
};

// Plain words → command, checked in order (more specific first).
const KEYWORDS: Array<[RegExp, string]> = [
  [/overdue|not paid|unpaid|late pay|pending pay/, "overdue"],
  [/proforma/, "proformas"],
  [/payment|received|receipt|\btds\b|collection/, "payments"],
  [/financ|revenue|ageing|aging|profit|income|turnover/, "finance"],
  [/invoice|bill|receivable|outstanding|owe/, "invoices"],
  [/expense|log ?book|fuel|travel|spent/, "expenses"],
  [/leave|holiday|absent|off day/, "leave"],
  [/week|tomorrow|upcoming|next \d+ days/, "week"],
  [/today|schedule|on site|who is where|calendar/, "today"],
  [/enquir|inquir/, "enquiries"],
  [/quotation|quote/, "quotations"],
  [/calibrat|equipment|instrument|machine|probe|yoke/, "equipment"],
  [/problem|issue|delay|complain/, "problems"],
  [/phone|field app|\bapp\b|submitted|device/, "field"],
  [/team|employee|staff|technician|certificate|qualification/, "team"],
  [/report|review|approv/, "reports"],
  [/customer|client/, "customers"],
  [/\bjobs?\b|work order/, "jobs"],
  [/help|menu|command/, "help"],
];

export function resolveCommand(rawText: string): { command: string | null; arg: string } {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const jobId = /bita\/\d{2}-\d{2}\/\d+/i.exec(text);
  if (text.startsWith("/")) {
    const [head, ...rest] = text.split(/\s+/);
    const name = head.slice(1).split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
    if (COMMANDS[name]) return { command: name, arg: rest.join(" ") };
  }
  const button = lower.replace(/[^a-z ]/g, "").trim().replace(/\s+/g, "");
  if (COMMANDS[button]) return { command: button, arg: "" };
  if (jobId) return { command: "job", arg: jobId[0] };
  for (const [re, cmd] of KEYWORDS) if (re.test(lower)) return { command: cmd, arg: "" };
  return { command: null, arg: text };
}

export async function answerBotQuery(supabase: DB, rawText: string): Promise<string> {
  const { command, arg } = resolveCommand(rawText);
  if (command) {
    const reply = await COMMANDS[command](supabase, arg);
    return clip(reply ?? helpReply());
  }
  // Unknown words: try them as a customer name, else show the summary.
  const customer = await customerDetailReply(supabase, arg);
  if (customer) return clip(customer);
  return clip(`I did not understand that, so here is the summary.\n\n${await statusReply(supabase)}`);
}
