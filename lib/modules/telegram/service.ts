import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIST } from "../../dates";
import type { Database, Json } from "../../db/types";

export interface TelegramConfig {
  bot_token: string;
  bot_username: string;
  enabled: boolean;
  notify_on_report: boolean;
  notify_on_invoice: boolean;
  notify_on_payment: boolean;
  notify_daily_digest: boolean;
}

export interface TelegramLinkedChat {
  chat_id: string;
  person_id: string;
  person_name: string;
  username: string | null;
  linked_at: string;
  active: boolean;
}

export interface TelegramPendingCode {
  code: string;
  person_id: string;
  person_name: string;
  expires_at: string;
}

export interface TelegramLinksState {
  chats: TelegramLinkedChat[];
  pending_codes: TelegramPendingCode[];
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  bot_token: "",
  bot_username: "",
  enabled: true,
  notify_on_report: true,
  notify_on_invoice: true,
  notify_on_payment: true,
  notify_daily_digest: true,
};

export function normalizeTelegramConfig(raw?: unknown): TelegramConfig {
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const envUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "";
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...DEFAULT_TELEGRAM_CONFIG,
      bot_token: envToken,
      bot_username: envUsername,
    };
  }
  const obj = raw as Record<string, unknown>;
  const savedToken = typeof obj.bot_token === "string" ? obj.bot_token.trim() : "";
  const savedUsername = typeof obj.bot_username === "string" ? obj.bot_username.trim() : "";
  return {
    bot_token: savedToken || envToken,
    bot_username: savedUsername || envUsername,
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : true,
    notify_on_report: typeof obj.notify_on_report === "boolean" ? obj.notify_on_report : true,
    notify_on_invoice: typeof obj.notify_on_invoice === "boolean" ? obj.notify_on_invoice : true,
    notify_on_payment: typeof obj.notify_on_payment === "boolean" ? obj.notify_on_payment : true,
    notify_daily_digest:
      typeof obj.notify_daily_digest === "boolean" ? obj.notify_daily_digest : true,
  };
}

export function normalizeTelegramLinksState(raw?: unknown): TelegramLinksState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { chats: [], pending_codes: [] };
  }
  const obj = raw as Record<string, unknown>;
  const rawChats = Array.isArray(obj.chats) ? obj.chats : [];
  const rawCodes = Array.isArray(obj.pending_codes) ? obj.pending_codes : [];

  const chats: TelegramLinkedChat[] = [];
  for (const c of rawChats) {
    if (!c || typeof c !== "object") continue;
    const rec = c as Record<string, unknown>;
    if (typeof rec.chat_id === "string" && rec.chat_id.trim()) {
      chats.push({
        chat_id: rec.chat_id.trim(),
        person_id: typeof rec.person_id === "string" ? rec.person_id : "",
        person_name: typeof rec.person_name === "string" ? rec.person_name : "Executive",
        username: typeof rec.username === "string" ? rec.username : null,
        linked_at: typeof rec.linked_at === "string" ? rec.linked_at : new Date().toISOString(),
        active: rec.active !== false,
      });
    }
  }

  const pending_codes: TelegramPendingCode[] = [];
  for (const p of rawCodes) {
    if (!p || typeof p !== "object") continue;
    const rec = p as Record<string, unknown>;
    if (typeof rec.code === "string" && rec.code.trim()) {
      pending_codes.push({
        code: rec.code.trim(),
        person_id: typeof rec.person_id === "string" ? rec.person_id : "",
        person_name: typeof rec.person_name === "string" ? rec.person_name : "Executive",
        expires_at: typeof rec.expires_at === "string" ? rec.expires_at : "",
      });
    }
  }

  return { chats, pending_codes };
}

export async function getTelegramConfig(
  supabase: SupabaseClient<Database>,
): Promise<TelegramConfig> {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "telegram_config")
      .maybeSingle();
    return normalizeTelegramConfig(data?.value);
  } catch {
    return normalizeTelegramConfig(null);
  }
}

export async function getTelegramLinksState(
  supabase: SupabaseClient<Database>,
): Promise<TelegramLinksState> {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "telegram_links")
      .maybeSingle();
    return normalizeTelegramLinksState(data?.value);
  } catch {
    return { chats: [], pending_codes: [] };
  }
}

export async function saveTelegramLinksState(
  supabase: SupabaseClient<Database>,
  state: TelegramLinksState,
  updatedBy?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("settings").upsert(
    {
      key: "telegram_links",
      value: state as unknown as Json,
      description: "Linked Telegram executive chat IDs and pairing codes",
      updated_at: new Date().toISOString(),
      ...(updatedBy ? { updated_by: updatedBy } : {}),
    },
    { onConflict: "key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function generateTelegramLinkCode(
  supabase: SupabaseClient<Database>,
  person: { id: string; name: string },
): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
  const state = await getTelegramLinksState(supabase);
  const now = Date.now();
  const validCodes = state.pending_codes.filter(
    (c) => new Date(c.expires_at).getTime() > now && c.person_id !== person.id,
  );
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();

  validCodes.push({
    code,
    person_id: person.id,
    person_name: person.name,
    expires_at: expiresAt,
  });

  const saved = await saveTelegramLinksState(
    supabase,
    {
      chats: state.chats,
      pending_codes: validCodes,
    },
    person.id,
  );

  if (!saved.ok) {
    return { ok: false, error: saved.error ?? "Failed to save link code." };
  }
  return { ok: true, code, expiresAt };
}

export async function redeemTelegramLinkCode(
  supabase: SupabaseClient<Database>,
  code: string,
  chatId: string,
  username?: string | null,
): Promise<{ ok: true; personName: string } | { ok: false; error: string }> {
  const cleanCode = code.trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, error: "Link code must be a 6-digit number from BITA Settings." };
  }

  const state = await getTelegramLinksState(supabase);
  const now = Date.now();
  const match = state.pending_codes.find(
    (p) => p.code === cleanCode && new Date(p.expires_at).getTime() > now,
  );

  if (!match) {
    return { ok: false, error: "Invalid or expired 6-digit link code. Generate a new one in BITA Settings." };
  }

  const remainingCodes = state.pending_codes.filter(
    (p) => p.code !== cleanCode && new Date(p.expires_at).getTime() > now,
  );

  const existingIdx = state.chats.findIndex((c) => c.chat_id === String(chatId));
  const linkedChat: TelegramLinkedChat = {
    chat_id: String(chatId),
    person_id: match.person_id,
    person_name: match.person_name,
    username: username ?? null,
    linked_at: new Date().toISOString(),
    active: true,
  };

  const nextChats = [...state.chats];
  if (existingIdx >= 0) {
    nextChats[existingIdx] = linkedChat;
  } else {
    nextChats.push(linkedChat);
  }

  const saved = await saveTelegramLinksState(supabase, {
    chats: nextChats,
    pending_codes: remainingCodes,
  });

  if (!saved.ok) {
    return { ok: false, error: saved.error ?? "Could not save Telegram link." };
  }

  return { ok: true, personName: match.person_name };
}

function formatInrPlain(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

export interface ExecutiveSnapshot {
  today: string;
  activeJobsCount: number;
  jobsByStatus: Record<string, number>;
  recentJobs: Array<{
    job_no: string;
    status: string;
    customer_name: string;
    site: string | null;
  }>;
  unbilledDoneJobs: Array<{
    job_no: string;
    customer_name: string;
    status: string;
  }>;
  openInvoicesCount: number;
  openReceivablesTotal: number;
  overdueInvoices: Array<{
    invoice_no: string;
    customer_name: string;
    balance: number;
    due_date: string;
  }>;
  pendingReports: Array<{
    job_no: string;
    method: string;
    submitted_at: string | null;
  }>;
  calibrationAlerts: Array<{
    code: string;
    name: string;
    due_date: string;
    expired: boolean;
  }>;
  todayAssignments: Array<{
    job_no: string;
    technician_name: string;
    customer_name: string;
  }>;
}

export async function buildExecutiveSnapshot(
  supabase: SupabaseClient<Database>,
  today: string = todayIST(),
): Promise<ExecutiveSnapshot> {
  const [jobsRes, invRes, repRes, eqRes, assignRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, job_no, status, site, customers(name), invoices(id, kind, status)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("invoices")
      .select("id, invoice_no, number, kind, status, total, balance, due_date, jobs(job_no, customers(name))")
      .eq("kind", "tax_invoice")
      .in("status", ["issued", "partly_paid"])
      .gt("balance", 0)
      .order("due_date", { ascending: true }),
    supabase
      .from("reports")
      .select("id, report_no, status, created_at, jobs(job_no)")
      .in("status", ["draft", "in_review"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("equipment")
      .select("id, asset_code, name, calibration_due, status")
      .is("deleted_at", null)
      .not("calibration_due", "is", null)
      .order("calibration_due", { ascending: true }),
    supabase
      .from("assignments")
      .select("id, start_date, end_date, jobs(job_no, customers(name)), people!assignments_person_id_fkey(full_name)")
      .lte("start_date", today)
      .gte("end_date", today),
  ]);

  const jobs = (jobsRes.data ?? []) as Array<{
    id: string;
    job_no: string;
    status: string;
    site: string | null;
    customers?: { name?: string | null } | null;
    invoices?: Array<{ id: string; kind: string; status: string }> | null;
  }>;

  const jobsByStatus: Record<string, number> = {};
  let activeJobsCount = 0;
  const unbilledDoneJobs: ExecutiveSnapshot["unbilledDoneJobs"] = [];

  for (const j of jobs) {
    jobsByStatus[j.status] = (jobsByStatus[j.status] ?? 0) + 1;
    if (j.status !== "closed") {
      activeJobsCount += 1;
    }
    if (
      ["inspection_done", "report_in_review", "report_sent"].includes(j.status) &&
      !(j.invoices ?? []).some((inv) => inv.kind === "tax_invoice" && inv.status !== "cancelled")
    ) {
      unbilledDoneJobs.push({
        job_no: j.job_no,
        customer_name: j.customers?.name ?? "Customer",
        status: j.status,
      });
    }
  }

  const recentJobs = jobs.slice(0, 8).map((j) => ({
    job_no: j.job_no,
    status: j.status,
    customer_name: j.customers?.name ?? "Customer",
    site: j.site,
  }));

  const openInvoices = (invRes.data ?? []) as Array<{
    id: string;
    invoice_no: string | null;
    number: string | null;
    balance: number | null;
    due_date: string | null;
    jobs?: { job_no?: string; customers?: { name?: string | null } | null } | null;
  }>;

  let openReceivablesTotal = 0;
  const overdueInvoices: ExecutiveSnapshot["overdueInvoices"] = [];

  for (const inv of openInvoices) {
    const bal = Number(inv.balance) || 0;
    openReceivablesTotal += bal;
    if (inv.due_date && inv.due_date < today) {
      overdueInvoices.push({
        invoice_no: inv.invoice_no ?? inv.number ?? inv.id.slice(0, 8),
        customer_name: inv.jobs?.customers?.name ?? "Customer",
        balance: bal,
        due_date: inv.due_date,
      });
    }
  }

  const pendingReports = ((repRes.data ?? []) as unknown as Array<{
    report_no: string | null;
    status: string;
    created_at: string | null;
    jobs?: { job_no?: string } | null;
  }>).map((r) => ({
    job_no: r.jobs?.job_no ?? "Job",
    method: r.report_no ?? r.status,
    submitted_at: r.created_at,
  }));

  const alertHorizon = new Date(`${today}T00:00:00Z`);
  alertHorizon.setUTCDate(alertHorizon.getUTCDate() + 30);
  const horizonStr = alertHorizon.toISOString().slice(0, 10);

  const calibrationAlerts = ((eqRes.data ?? []) as unknown as Array<{
    asset_code: string;
    name: string;
    calibration_due: string | null;
  }>)
    .filter((e) => e.calibration_due && e.calibration_due <= horizonStr)
    .map((e) => ({
      code: e.asset_code,
      name: e.name,
      due_date: e.calibration_due!,
      expired: e.calibration_due! < today,
    }));

  const todayAssignments = ((assignRes.data ?? []) as unknown as Array<{
    jobs?: { job_no?: string; customers?: { name?: string | null } | null } | null;
    people?: { full_name?: string | null } | null;
  }>).map((a) => ({
    job_no: a.jobs?.job_no ?? "Job",
    technician_name: a.people?.full_name ?? "Technician",
    customer_name: a.jobs?.customers?.name ?? "Customer",
  }));

  return {
    today,
    activeJobsCount,
    jobsByStatus,
    recentJobs,
    unbilledDoneJobs,
    openInvoicesCount: openInvoices.length,
    openReceivablesTotal,
    overdueInvoices,
    pendingReports,
    calibrationAlerts,
    todayAssignments,
  };
}

export function formatExecutiveDigestMessage(snap: ExecutiveSnapshot): string {
  const lines: string[] = [
    `📊 *BITA Executive Dashboard (${snap.today})*`,
    "",
    `• *Active Jobs:* ${snap.activeJobsCount} (${snap.unbilledDoneJobs.length} completed & unbilled)`,
    `• *Open Receivables:* ${formatInrPlain(snap.openReceivablesTotal)} across ${snap.openInvoicesCount} invoice(s)`,
    `• *Overdue Invoices:* ${snap.overdueInvoices.length}`,
    `• *Reports Awaiting Approval:* ${snap.pendingReports.length}`,
    `• *Today's Site Assignments:* ${snap.todayAssignments.length}`,
    `• *Equipment Calibration Alerts:* ${snap.calibrationAlerts.length}`,
  ];

  if (snap.overdueInvoices.length > 0) {
    lines.push("", "⚠️ *Top Overdue Invoices:*");
    for (const inv of snap.overdueInvoices.slice(0, 5)) {
      lines.push(
        `  - \`${inv.invoice_no}\` · ${inv.customer_name} · *${formatInrPlain(inv.balance)}* (Due ${inv.due_date})`,
      );
    }
  }

  if (snap.unbilledDoneJobs.length > 0) {
    lines.push("", "📋 *Work Done — Invoice Pending:*");
    for (const j of snap.unbilledDoneJobs.slice(0, 5)) {
      lines.push(`  - \`${j.job_no}\` · ${j.customer_name} (${j.status.replace(/_/g, " ")})`);
    }
  }

  if (snap.calibrationAlerts.length > 0) {
    lines.push("", "🔧 *Equipment Calibration Alerts:*");
    for (const eq of snap.calibrationAlerts.slice(0, 5)) {
      lines.push(
        `  - \`${eq.code}\` ${eq.name}: ${eq.expired ? "🚨 EXPIRED" : "Due"} ${eq.due_date}`,
      );
    }
  }

  return lines.join("\n");
}

export async function answerTelegramExecutiveQuery(
  supabase: SupabaseClient<Database>,
  rawText: string,
): Promise<string> {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  if (lower === "/help" || lower === "help" || lower === "/start") {
    return [
      "🤖 *BITA Executive Assistant*",
      "",
      "Ask me anything in plain English or use a quick command:",
      "• `/status` or `/dashboard` — Live business & cashflow summary",
      "• `/jobs` — Active jobs & unbilled completed inspections",
      "• `/invoices` — Open receivables & unpaid tax invoices",
      "• `/overdue` — Overdue invoices needing follow-up",
      "• `/reports` — Inspection reports waiting for reviewer approval",
      "• `/equipment` — Calibration expiry alerts",
      "• `/schedule` — Today's technician site assignments",
      "• `/job BITA/26-27/0001` — Full 360° status of any Job ID",
      "",
      "_To link a new phone, run_ `/start <6-digit-code>` _generated from BITA Settings._",
    ].join("\n");
  }

  // Specific Job ID lookup (e.g. "/job BITA/26-27/0001" or message containing "BITA/")
  const jobMatch = /bita\/[\w-]+\/\d+/i.exec(text);
  if (lower.startsWith("/job ") || jobMatch) {
    const queryNo = (jobMatch ? jobMatch[0] : text.slice(5).trim()).toUpperCase();
    const { data: rawJob } = await supabase
      .from("jobs")
      .select(
        "job_no, status, site, customer_po_number, customers(name), inspections(method, draft, submitted_at), invoices(invoice_no, number, kind, status, total, balance)",
      )
      .ilike("job_no", `%${queryNo}%`)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    const job = rawJob as unknown as {
      job_no: string;
      status: string;
      site: string | null;
      customer_po_number: string | null;
      customers?: { name?: string } | null;
      inspections?: Array<{ method: string; draft: boolean; submitted_at: string | null }> | null;
      invoices?: Array<{
        invoice_no: string | null;
        number: string | null;
        kind: string;
        status: string;
        total: number;
        balance: number;
      }> | null;
    } | null;

    if (!job) {
      return `Could not find an active job matching \`${queryNo}\`.`;
    }

    const custName = job.customers?.name ?? "Customer";
    const reports = job.inspections ?? [];
    const invoices = job.invoices ?? [];

    return [
      `📁 *Job \`${job.job_no}\`*`,
      `• *Customer:* ${custName}`,
      `• *Status:* ${job.status.replace(/_/g, " ")}`,
      `• *Site:* ${job.site || "—"}`,
      `• *PO No:* ${job.customer_po_number || "Without PO"}`,
      `• *Reports (${reports.length}):* ${
        reports.length === 0
          ? "None yet"
          : reports
              .map((r) => `${r.method} (${r.draft ? "Draft" : "Submitted"})`)
              .join(", ")
      }`,
      `• *Invoices (${invoices.length}):* ${
        invoices.length === 0
          ? "Not billed yet"
          : invoices
              .map(
                (i) =>
                  `${i.invoice_no ?? i.number ?? i.kind} [${i.status}, Bal ${formatInrPlain(Number(i.balance) || 0)}]`,
              )
              .join(", ")
      }`,
    ].join("\n");
  }

  const snap = await buildExecutiveSnapshot(supabase);

  if (
    lower.startsWith("/overdue") ||
    lower.includes("overdue") ||
    lower.includes("not paid") ||
    lower.includes("unpaid")
  ) {
    if (snap.overdueInvoices.length === 0) {
      return `✅ *No overdue tax invoices as of ${snap.today}!*\nOpen receivables: ${formatInrPlain(snap.openReceivablesTotal)} across ${snap.openInvoicesCount} invoice(s).`;
    }
    const totalOverdue = snap.overdueInvoices.reduce((s, i) => s + i.balance, 0);
    return [
      `⚠️ *Overdue Tax Invoices (${snap.overdueInvoices.length}) — Total ${formatInrPlain(totalOverdue)}*`,
      "",
      ...snap.overdueInvoices.map(
        (inv) =>
          `• \`${inv.invoice_no}\` · *${inv.customer_name}* · Bal *${formatInrPlain(inv.balance)}* (Due ${inv.due_date})`,
      ),
    ].join("\n");
  }

  if (
    lower.startsWith("/invoices") ||
    lower.startsWith("/receivables") ||
    lower.includes("invoice") ||
    lower.includes("money") ||
    lower.includes("payment") ||
    lower.includes("receivable")
  ) {
    return [
      `💰 *Receivables & Billing Summary (${snap.today})*`,
      `• *Open Tax Invoices:* ${snap.openInvoicesCount}`,
      `• *Total Outstanding Balance:* ${formatInrPlain(snap.openReceivablesTotal)}`,
      `• *Overdue Invoices:* ${snap.overdueInvoices.length}`,
      `• *Completed Jobs Pending Invoice:* ${snap.unbilledDoneJobs.length}`,
      ...(snap.unbilledDoneJobs.length > 0
        ? [
            "",
            "*Unbilled Completed Jobs:*",
            ...snap.unbilledDoneJobs
              .slice(0, 8)
              .map((j) => `  - \`${j.job_no}\` · ${j.customer_name}`),
          ]
        : []),
    ].join("\n");
  }

  if (
    lower.startsWith("/jobs") ||
    lower.includes("active job") ||
    lower.includes("unbilled")
  ) {
    return [
      `📋 *Active Jobs (${snap.activeJobsCount})*`,
      "",
      ...snap.recentJobs.map(
        (j) =>
          `• \`${j.job_no}\` · *${j.customer_name}* — _${j.status.replace(/_/g, " ")}_${j.site ? ` (${j.site})` : ""}`,
      ),
      ...(snap.unbilledDoneJobs.length > 0
        ? [
            "",
            `⚠️ *${snap.unbilledDoneJobs.length} job(s) have inspection done/report sent but no tax invoice yet.*`,
          ]
        : []),
    ].join("\n");
  }

  if (
    lower.startsWith("/reports") ||
    lower.includes("report") ||
    lower.includes("approval") ||
    lower.includes("review")
  ) {
    if (snap.pendingReports.length === 0) {
      return "✅ *All submitted inspection reports have been reviewed!*";
    }
    return [
      `📝 *Reports Awaiting Technical Review (${snap.pendingReports.length})*`,
      "",
      ...snap.pendingReports.map(
        (r) =>
          `• \`${r.job_no}\` · Method *${r.method}* (Submitted ${r.submitted_at ? r.submitted_at.slice(0, 10) : "recently"})`,
      ),
    ].join("\n");
  }

  if (
    lower.startsWith("/equipment") ||
    lower.startsWith("/calibration") ||
    lower.includes("equipment") ||
    lower.includes("calibration")
  ) {
    if (snap.calibrationAlerts.length === 0) {
      return "✅ *All equipment calibrations are valid for the next 30 days!*";
    }
    return [
      `🔧 *Equipment Calibration Alerts (${snap.calibrationAlerts.length})*`,
      "",
      ...snap.calibrationAlerts.map(
        (e) =>
          `• \`${e.code}\` *${e.name}* — ${e.expired ? "🚨 *EXPIRED*" : "Expiring"} (${e.due_date})`,
      ),
    ].join("\n");
  }

  if (
    lower.startsWith("/schedule") ||
    lower.startsWith("/calendar") ||
    lower.includes("schedule") ||
    lower.includes("today") ||
    lower.includes("technician") ||
    lower.includes("site")
  ) {
    if (snap.todayAssignments.length === 0) {
      return `📅 *No technicians are scheduled on site for today (${snap.today}).*`;
    }
    return [
      `📅 *Today's Site Schedule (${snap.today})*`,
      "",
      ...snap.todayAssignments.map(
        (a) => `• *${a.technician_name}* → \`${a.job_no}\` (${a.customer_name})`,
      ),
    ].join("\n");
  }

  return formatExecutiveDigestMessage(snap);
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!botToken) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured." };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Telegram API HTTP ${res.status}: ${errText}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send Telegram message",
    };
  }
}

export async function broadcastTelegramNotification(
  supabase: SupabaseClient<Database>,
  eventKind: "report" | "invoice" | "payment" | "digest" | "test",
  message: string,
): Promise<{ sent: number; skipped: boolean; errors: string[] }> {
  const [config, links] = await Promise.all([
    getTelegramConfig(supabase),
    getTelegramLinksState(supabase),
  ]);

  if (!config.enabled || !config.bot_token) {
    return { sent: 0, skipped: true, errors: [] };
  }

  if (eventKind === "report" && !config.notify_on_report) {
    return { sent: 0, skipped: true, errors: [] };
  }
  if (eventKind === "invoice" && !config.notify_on_invoice) {
    return { sent: 0, skipped: true, errors: [] };
  }
  if (eventKind === "payment" && !config.notify_on_payment) {
    return { sent: 0, skipped: true, errors: [] };
  }
  if (eventKind === "digest" && !config.notify_daily_digest) {
    return { sent: 0, skipped: true, errors: [] };
  }

  const activeChats = links.chats.filter((c) => c.active);
  if (activeChats.length === 0) {
    return { sent: 0, skipped: false, errors: ["No active linked Telegram chats."] };
  }

  let sent = 0;
  const errors: string[] = [];
  for (const chat of activeChats) {
    const res = await sendTelegramMessage(config.bot_token, chat.chat_id, message);
    if (res.ok) {
      sent += 1;
    } else if (res.error) {
      errors.push(res.error);
    }
  }

  return { sent, skipped: false, errors };
}
