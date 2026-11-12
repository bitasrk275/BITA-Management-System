import Link from "next/link";
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
  Mono,
  PageHeader,
  SavedNote,
  SecondaryButton,
  SectionTitle,
  Select,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { Enums } from "@/lib/db/types";
import { DEFAULT_BITA_INVOICE_PROFILE } from "@/lib/invoices";
import { PERMISSION_ACTIONS } from "@/lib/modules/settings/schema";
import {
  getPermissionsMatrix,
  listSettings,
  listSettingsOptions,
} from "@/lib/modules/settings/service";
import {
  normalizeTelegramConfig,
  normalizeTelegramLinksState,
} from "@/lib/modules/telegram/service";
import { normalizeReminderTimings } from "@/lib/reminders/schedule";
import {
  addDropdownOption,
  addHolidayAction,
  addReportTemplateFieldAction,
  createTelegramPairingCodeAction,
  registerTelegramWebhookAction,
  removeDropdownOption,
  removeHolidayAction,
  removeReportTemplateFieldAction,
  saveCompanyProfileAction,
  saveInvoiceNumberingAction,
  savePermissionsMatrixAction,
  saveReminderTimingsAction,
  saveTelegramConfigAction,
  sendTestTelegramDigestAction,
  toggleDropdownOption,
  unlinkTelegramChatAction,
} from "./actions";

export const metadata = { title: "Settings – BITA" };

const ALL_ROLES: readonly Enums<"app_role">[] = [
  "management",
  "office",
  "reviewer",
  "technician",
];

const PERMISSION_LABELS: Record<(typeof PERMISSION_ACTIONS)[number], string> = {
  delete: "Delete & restore records (Recycle bin)",
  view_salaries: "View employee salaries",
  view_finance: "View financial reports (Finance)",
  approve_reports: "Approve inspection reports",
  issue_invoices: "Issue tax invoices & credit notes",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    list?: string;
    tg_code?: string;
    tg_webhook?: string;
  }>;
}) {
  const { error, saved, list, tg_code, tg_webhook } = await searchParams;
  const { supabase, person } = await requireStaff();
  const isManagement = Boolean(person?.roles.includes("management"));

  const [{ data: settings, error: settingsErr }, { data: options, error: optionsErr }, permissions, staffRes] =
    await Promise.all([
      listSettings(supabase),
      listSettingsOptions(supabase, { listKey: list }),
      getPermissionsMatrix(supabase),
      supabase
        .from("people")
        .select("id, full_name, position, roles")
        .is("deleted_at", null)
        .eq("active", true)
        .order("full_name"),
    ]);

  const activeStaff = staffRes.data ?? [];

  const settingMap = new Map(settings.map((s) => [s.key, s.value]));
  const rawProfile =
    settingMap.get("company_profile") &&
    typeof settingMap.get("company_profile") === "object" &&
    !Array.isArray(settingMap.get("company_profile"))
      ? (settingMap.get("company_profile") as Record<string, unknown>)
      : {};
  const companyProfile = {
    name:
      typeof rawProfile.name === "string" && rawProfile.name.trim()
        ? rawProfile.name
        : DEFAULT_BITA_INVOICE_PROFILE.name,
    address:
      typeof rawProfile.address === "string" && rawProfile.address.trim()
        ? rawProfile.address
        : DEFAULT_BITA_INVOICE_PROFILE.address,
    phone:
      typeof rawProfile.phone === "string" && rawProfile.phone.trim()
        ? rawProfile.phone
        : DEFAULT_BITA_INVOICE_PROFILE.phone ?? "",
    email:
      typeof rawProfile.email === "string" && rawProfile.email.trim()
        ? rawProfile.email
        : DEFAULT_BITA_INVOICE_PROFILE.email ?? "",
    pan:
      typeof rawProfile.pan === "string" && rawProfile.pan.trim()
        ? rawProfile.pan
        : DEFAULT_BITA_INVOICE_PROFILE.pan ?? "",
    gstin:
      typeof rawProfile.gstin === "string" && rawProfile.gstin.trim()
        ? rawProfile.gstin
        : DEFAULT_BITA_INVOICE_PROFILE.gstin,
    defaultSac:
      typeof rawProfile.default_sac === "string" && rawProfile.default_sac.trim()
        ? rawProfile.default_sac
        : typeof rawProfile.defaultSac === "string" && rawProfile.defaultSac.trim()
          ? rawProfile.defaultSac
          : DEFAULT_BITA_INVOICE_PROFILE.defaultSac,
    bankName: typeof rawProfile.bank_name === "string" ? rawProfile.bank_name : "",
    bankBranch: typeof rawProfile.bank_branch === "string" ? rawProfile.bank_branch : "",
    bankAccountNo: typeof rawProfile.bank_account_no === "string" ? rawProfile.bank_account_no : "",
    bankIfsc: typeof rawProfile.bank_ifsc === "string" ? rawProfile.bank_ifsc : "",
    logoPath: typeof rawProfile.logo_path === "string" ? rawProfile.logo_path : "",
    sealPath: typeof rawProfile.seal_path === "string" ? rawProfile.seal_path : "",
    defaultSignatoryId:
      typeof rawProfile.default_signatory_id === "string"
        ? rawProfile.default_signatory_id
        : "",
  };

  const rawNumbering =
    settingMap.get("invoice_numbering") &&
    typeof settingMap.get("invoice_numbering") === "object" &&
    !Array.isArray(settingMap.get("invoice_numbering"))
      ? (settingMap.get("invoice_numbering") as Record<string, unknown>)
      : {};
  const invoiceNumbering = {
    tax_prefix: typeof rawNumbering.tax_prefix === "string" ? rawNumbering.tax_prefix : "",
    next_tax_no: Number(rawNumbering.next_tax_no) || 5388,
    proforma_prefix:
      typeof rawNumbering.proforma_prefix === "string" ? rawNumbering.proforma_prefix : "PI/",
    next_proforma_no: Number(rawNumbering.next_proforma_no) || 1,
    credit_note_prefix:
      typeof rawNumbering.credit_note_prefix === "string"
        ? rawNumbering.credit_note_prefix
        : "CN/",
    next_credit_note_no: Number(rawNumbering.next_credit_note_no) || 1,
    default_sac:
      typeof rawNumbering.default_sac === "string" ? rawNumbering.default_sac : "998393",
  };

  const reminderTimings = normalizeReminderTimings(settingMap.get("reminder_timings"));
  const telegramConfig = normalizeTelegramConfig(settingMap.get("telegram_config"));
  const telegramLinks = normalizeTelegramLinksState(settingMap.get("telegram_links"));

  const rawHolidays = settingMap.get("holidays");
  const holidays: Array<{ date: string; name: string }> = Array.isArray(rawHolidays)
    ? rawHolidays
        .filter((h): h is { date: string; name: string } =>
          Boolean(h && typeof h === "object" && "date" in h && "name" in h),
        )
        .map((h) => ({ date: String(h.date), name: String(h.name) }))
    : [];

  const rawReportTemplates =
    settingMap.get("report_templates") &&
    typeof settingMap.get("report_templates") === "object" &&
    !Array.isArray(settingMap.get("report_templates"))
      ? (settingMap.get("report_templates") as Record<
          string,
          Array<{ key: string; label: string; input?: string; required?: boolean }>
        >)
      : {};

  const listKeys = Array.from(new Set(options.map((o) => o.list_key))).sort();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Configure BITA invoice header & bank profile, invoice numbering, reminder timings, Telegram Executive Bot, report templates, permissions, and dropdowns."
        action={
          <>
            <ButtonLink href="/settings/users" variant="secondary">
              Users & logins
            </ButtonLink>
            <ButtonLink href="/recycle-bin" variant="secondary">
              Recycle bin
            </ButtonLink>
          </>
        }
      />

      <ErrorNote message={error ?? settingsErr ?? optionsErr ?? undefined} />
      {saved && <SavedNote />}

      {tg_webhook && (
        <div className="mb-5 rounded-lg border border-ok-line bg-ok-bg px-4 py-3 text-sm text-ink">
          <p className="font-semibold">
            Telegram Webhook Connected Successfully!
          </p>
          <p className="mt-1 text-xs text-ink-2">
            Your bot is now live and connected to{" "}
            <Mono>https://bita-management-system.vercel.app/api/telegram/webhook</Mono>. Click{" "}
            <strong>Generate 6-Digit Link Code</strong> below and send{" "}
            <Mono>/start &lt;code&gt;</Mono> to your bot in Telegram!
          </p>
        </div>
      )}

      {tg_code && (
        <div className="mb-5 rounded-lg border border-ok-line bg-ok-bg px-4 py-3 text-sm text-ink">
          <p className="font-semibold">
            Telegram Executive Bot Pairing Code: <Mono>{tg_code}</Mono> (valid for 15 minutes)
          </p>
          <p className="mt-1 text-xs text-ink-2">
            Open your BITA Telegram Bot on your phone and send:{" "}
            <Mono>/start {tg_code}</Mono>
          </p>
        </div>
      )}

      {!isManagement && (
        <div className="mb-5">
          <Status tone="wait">
            Only management can modify system settings. Office staff can manage dropdown options.
          </Status>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* 1. Company Profile & Invoice Sheet Details */}
          <Card>
            <SectionTitle>1. Company Profile & Invoice Header / Bank Details</SectionTitle>
            <p className="mb-3 text-xs text-ink-3">
              Printed on every BITA tax invoice, proforma invoice, and downloadable Word (.docx) invoice.
            </p>
            <form action={saveCompanyProfileAction} encType="multipart/form-data" className="space-y-3">
              <Field label="Company Name">
                <Input name="name" defaultValue={companyProfile.name} required />
              </Field>
              <Field label="Header Address Line">
                <Input name="address" defaultValue={companyProfile.address} required />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone">
                  <Input name="phone" defaultValue={companyProfile.phone} />
                </Field>
                <Field label="Email">
                  <Input name="email" defaultValue={companyProfile.email} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="PAN No.">
                  <Input name="pan" defaultValue={companyProfile.pan} />
                </Field>
                <Field label="GSTIN No.">
                  <Input name="gstin" defaultValue={companyProfile.gstin} />
                </Field>
                <Field label="Default SAC No.">
                  <Input name="default_sac" defaultValue={companyProfile.defaultSac} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bank Name">
                  <Input name="bank_name" defaultValue={companyProfile.bankName} />
                </Field>
                <Field label="Bank Branch">
                  <Input name="bank_branch" defaultValue={companyProfile.bankBranch} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bank A/C No.">
                  <Input name="bank_account_no" defaultValue={companyProfile.bankAccountNo} />
                </Field>
                <Field label="IFSC Code">
                  <Input name="bank_ifsc" defaultValue={companyProfile.bankIfsc} />
                </Field>
              </div>

              {/* Branding Section */}
              <div className="border-t border-line pt-3 mt-3 space-y-3">
                <SectionTitle>Branding: Logo, Seal & Default Signatory</SectionTitle>
                <p className="text-xs text-ink-3">
                  Logos, seals, and signatures are stored in private storage and embedded in reports and invoices only upon technical approval.
                </p>

                <input
                  type="hidden"
                  name="existing_logo_path"
                  value={companyProfile.logoPath}
                />
                <input
                  type="hidden"
                  name="existing_seal_path"
                  value={companyProfile.sealPath}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Company Logo (PNG / JPEG)"
                    hint={
                      companyProfile.logoPath
                        ? `Uploaded: ${companyProfile.logoPath.split("/").pop()}`
                        : "Using default BITA emblem"
                    }
                  >
                    <input
                      type="file"
                      name="logo_file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="w-full text-xs text-ink-2 file:mr-2 file:rounded file:border file:border-line file:bg-side file:px-2.5 file:py-1 file:text-xs file:text-ink"
                    />
                    {companyProfile.logoPath && (
                      <label className="mt-1 flex items-center gap-1.5 text-xs text-bad cursor-pointer">
                        <input type="checkbox" name="remove_logo" value="1" />
                        <span>Remove uploaded logo (revert to emblem)</span>
                      </label>
                    )}
                  </Field>

                  <Field
                    label="Company Seal (PNG / JPEG)"
                    hint={
                      companyProfile.sealPath
                        ? `Uploaded: ${companyProfile.sealPath.split("/").pop()}`
                        : "Using placeholder seal upon approval"
                    }
                  >
                    <input
                      type="file"
                      name="seal_file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="w-full text-xs text-ink-2 file:mr-2 file:rounded file:border file:border-line file:bg-side file:px-2.5 file:py-1 file:text-xs file:text-ink"
                    />
                    {companyProfile.sealPath && (
                      <label className="mt-1 flex items-center gap-1.5 text-xs text-bad cursor-pointer">
                        <input type="checkbox" name="remove_seal" value="1" />
                        <span>Remove uploaded seal (revert to placeholder)</span>
                      </label>
                    )}
                  </Field>
                </div>

                <Field
                  label="Default Signatory (Reports)"
                  hint="Used when an approved report's reviewer does not have a signature uploaded"
                >
                  <Select
                    name="default_signatory_id"
                    defaultValue={companyProfile.defaultSignatoryId}
                  >
                    <option value="">None (Current Approver / Technical Reviewer)</option>
                    {activeStaff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} {s.position ? `(${s.position})` : ""} [{s.roles.join(", ")}]
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {isManagement && <Button type="submit">Save company profile</Button>}
            </form>
          </Card>

          {/* 2. Invoice & Credit Note Numbering */}
          <Card>
            <SectionTitle>2. Invoice & Credit Note Numbering</SectionTitle>
            <p className="mb-3 text-xs text-ink-3">
              Reference invoice 5387 was dated 05.11.2026; default next tax invoice counter starts at 5388.
            </p>
            <form action={saveInvoiceNumberingAction} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tax Invoice Prefix" hint="Leave blank for plain number (e.g. 5388)">
                  <Input
                    name="tax_prefix"
                    defaultValue={invoiceNumbering.tax_prefix}
                    placeholder="e.g. 5388 (blank prefix)"
                  />
                </Field>
                <Field label="Next Tax Invoice Number">
                  <Input
                    name="next_tax_no"
                    type="number"
                    min={1}
                    defaultValue={invoiceNumbering.next_tax_no}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Proforma Prefix">
                  <Input
                    name="proforma_prefix"
                    defaultValue={invoiceNumbering.proforma_prefix}
                  />
                </Field>
                <Field label="Next Proforma Number">
                  <Input
                    name="next_proforma_no"
                    type="number"
                    min={1}
                    defaultValue={invoiceNumbering.next_proforma_no}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Credit Note Prefix">
                  <Input
                    name="credit_note_prefix"
                    defaultValue={invoiceNumbering.credit_note_prefix}
                  />
                </Field>
                <Field label="Next Credit Note Number">
                  <Input
                    name="next_credit_note_no"
                    type="number"
                    min={1}
                    defaultValue={invoiceNumbering.next_credit_note_no}
                  />
                </Field>
              </div>
              <Field label="Default SAC Code">
                <Input name="default_sac" defaultValue={invoiceNumbering.default_sac} />
              </Field>
              {isManagement && <Button type="submit">Save numbering counters</Button>}
            </form>
          </Card>

          {/* 3. Payment Reminders & Calibration Alert Timings */}
          <Card>
            <SectionTitle>3. Payment Reminders & Calibration Alert Timings</SectionTitle>
            <p className="mb-3 text-xs text-ink-3">
              Controls when automated email payment reminders and equipment calibration warnings fire.
            </p>
            <form action={saveReminderTimingsAction} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Days before due date">
                  <Input
                    name="before_due_days"
                    type="number"
                    min={0}
                    defaultValue={reminderTimings.before_due_days}
                  />
                </Field>
                <Field label="Overdue daily start (day +N)">
                  <Input
                    name="overdue_start_days"
                    type="number"
                    min={1}
                    defaultValue={reminderTimings.overdue_start_days}
                  />
                </Field>
                <Field label="Calibration alert (days)">
                  <Input
                    name="calibration_alert_days"
                    type="number"
                    min={1}
                    defaultValue={reminderTimings.calibration_alert_days ?? 30}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <input
                  type="checkbox"
                  name="on_due"
                  defaultChecked={reminderTimings.on_due}
                  className="h-4 w-4 rounded border-line"
                />
                Send payment reminder on the exact invoice due date
              </label>
              {isManagement && <Button type="submit">Save reminder timings</Button>}
            </form>
          </Card>

          {/* 4. Permissions Matrix */}
          <Card>
            <SectionTitle link={{ href: "/settings/users", label: "Manage users" }}>
              4. Role Permissions Matrix
            </SectionTitle>
            <p className="mb-3 text-xs text-ink-3">
              Enforced in both database triggers/RLS and application services.
            </p>
            <form action={savePermissionsMatrixAction} className="space-y-3">
              <div className="divide-y divide-line-2 text-sm">
                {PERMISSION_ACTIONS.map((action) => (
                  <div key={action} className="py-2.5">
                    <div className="mb-1.5 font-medium text-ink">{PERMISSION_LABELS[action]}</div>
                    <div className="flex flex-wrap gap-4">
                      {ALL_ROLES.map((role) => (
                        <label key={role} className="flex items-center gap-1.5 text-xs text-ink-2">
                          <input
                            type="checkbox"
                            name={`perm_${action}`}
                            value={role}
                            defaultChecked={permissions[action]?.includes(role)}
                            className="h-3.5 w-3.5 rounded border-line"
                          />
                          {role}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {isManagement && <Button type="submit">Save permissions matrix</Button>}
            </form>
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* 5. Telegram Executive Bot */}
          <Card>
            <SectionTitle>5. Telegram Executive Bot & Real-Time Alerts</SectionTitle>
            <p className="mb-3 text-xs text-ink-3">
              Allows BITA directors & office leads to ask live dashboard questions (<Mono>/status</Mono>,{" "}
              <Mono>/jobs</Mono>, <Mono>/invoices</Mono>, <Mono>/overdue</Mono>, <Mono>/reports</Mono>,{" "}
              <Mono>/equipment</Mono>, <Mono>/schedule</Mono>) and receive instant notifications on Telegram.
            </p>
            <form action={saveTelegramConfigAction} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Telegram Bot Token" hint="From @BotFather (or set TELEGRAM_BOT_TOKEN)">
                  <Input
                    name="bot_token"
                    type="password"
                    defaultValue={telegramConfig.bot_token}
                    placeholder="123456789:ABCdef..."
                  />
                </Field>
                <Field label="Bot Username" hint="e.g. bita_executive_bot">
                  <Input
                    name="bot_username"
                    defaultValue={telegramConfig.bot_username}
                    placeholder="bita_executive_bot"
                  />
                </Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 text-xs text-ink-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={telegramConfig.enabled}
                    className="h-4 w-4 rounded border-line"
                  />
                  Enable Telegram Executive Bot
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="notify_on_report"
                    defaultChecked={telegramConfig.notify_on_report}
                    className="h-4 w-4 rounded border-line"
                  />
                  Notify on field report submission
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="notify_on_invoice"
                    defaultChecked={telegramConfig.notify_on_invoice}
                    className="h-4 w-4 rounded border-line"
                  />
                  Notify when invoice is issued
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="notify_on_payment"
                    defaultChecked={telegramConfig.notify_on_payment}
                    className="h-4 w-4 rounded border-line"
                  />
                  Notify when payment is recorded
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="notify_daily_digest"
                    defaultChecked={telegramConfig.notify_daily_digest}
                    className="h-4 w-4 rounded border-line"
                  />
                  Send daily morning executive digest
                </label>
              </div>
              {isManagement && <Button type="submit">Save Telegram bot settings</Button>}
            </form>

            <div className="mt-4 border-t border-line-2 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">
                  Linked Executive Chats ({telegramLinks.chats.length})
                </span>
                <div className="flex flex-wrap gap-2">
                  <form action={registerTelegramWebhookAction}>
                    <SecondaryButton type="submit">Connect Webhook to Telegram</SecondaryButton>
                  </form>
                  <form action={createTelegramPairingCodeAction}>
                    <SecondaryButton type="submit">Generate 6-Digit Link Code</SecondaryButton>
                  </form>
                  {telegramLinks.chats.length > 0 && (
                    <form action={sendTestTelegramDigestAction}>
                      <SecondaryButton type="submit">Send Live Digest Now</SecondaryButton>
                    </form>
                  )}
                </div>
              </div>
              {telegramLinks.chats.length > 0 && (
                <ul className="mt-2 divide-y divide-line-2 text-xs">
                  {telegramLinks.chats.map((c) => (
                    <li
                      key={c.chat_id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <div>
                        <span className="font-medium text-ink">{c.person_name}</span>{" "}
                        {c.username && <span className="text-ink-3">(@{c.username})</span>}{" "}
                        <Mono>#{c.chat_id}</Mono>
                      </div>
                      <form action={unlinkTelegramChatAction.bind(null, c.chat_id)}>
                        <SecondaryButton type="submit">Unlink</SecondaryButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* 6. Custom Report Template Fields */}
          <Card>
            <SectionTitle>6. Custom Report Template Fields (UT / MPT / DPT)</SectionTitle>
            <p className="mb-3 text-xs text-ink-3">
              Add custom reading fields to any NDT method. They immediately appear in the technician app (
              <Mono>/api/field/report-template/[method]</Mono>).
            </p>
            <form action={addReportTemplateFieldAction} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Method">
                  <Select name="method" defaultValue="UT">
                    <option value="UT">UT</option>
                    <option value="MPT">MPT (MT)</option>
                    <option value="DPT">DPT</option>
                  </Select>
                </Field>
                <Field label="Field Key">
                  <Input name="field_key" placeholder="e.g. surface_temp" required />
                </Field>
                <Field label="Input Type">
                  <Select name="field_input" defaultValue="text">
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="textarea">Multiline Text</option>
                  </Select>
                </Field>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-[200px] flex-1">
                  <Field label="Field Label">
                    <Input name="field_label" placeholder="e.g. Surface temperature (°C)" required />
                  </Field>
                </div>
                <label className="flex items-center gap-2 pb-2 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    name="field_required"
                    className="h-4 w-4 rounded border-line"
                  />
                  Required
                </label>
                <Button type="submit">Add field</Button>
              </div>
            </form>

            {Object.keys(rawReportTemplates).length > 0 && (
              <div className="mt-4 border-t border-line-2 pt-3 space-y-2">
                {Object.entries(rawReportTemplates).map(([method, fields]) =>
                  Array.isArray(fields) && fields.length > 0 ? (
                    <div key={method} className="text-xs">
                      <div className="font-semibold text-ink mb-1">{method} Custom Fields:</div>
                      <ul className="divide-y divide-line-2">
                        {fields.map((f) => (
                          <li
                            key={`${method}-${f.key}`}
                            className="flex items-center justify-between py-1.5"
                          >
                            <span>
                              <Mono>{f.key}</Mono> — {f.label} ({f.input ?? "text"}
                              {f.required ? ", required" : ""})
                            </span>
                            <form
                              action={removeReportTemplateFieldAction.bind(null, method, f.key)}
                            >
                              <SecondaryButton type="submit">Remove</SecondaryButton>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </Card>

          {/* 7. Company Holidays */}
          <Card>
            <SectionTitle>7. Company Holidays ({holidays.length})</SectionTitle>
            <p className="mb-3 text-xs text-ink-3">
              Holidays are highlighted on the scheduling calendar and warn before scheduling technicians.
            </p>
            <form action={addHolidayAction} className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Field label="Date">
                  <Input type="date" name="holiday_date" required />
                </Field>
              </div>
              <div className="min-w-[180px] flex-1">
                <Field label="Holiday Name">
                  <Input name="holiday_name" placeholder="e.g. Kannada Rajyotsava" required />
                </Field>
              </div>
              <Button type="submit">Add holiday</Button>
            </form>
            {holidays.length > 0 && (
              <ul className="mt-3 divide-y divide-line-2 text-xs">
                {holidays.map((h) => (
                  <li key={h.date} className="flex items-center justify-between py-2">
                    <span>
                      <Mono>{h.date}</Mono> — <strong className="text-ink">{h.name}</strong>
                    </span>
                    <form action={removeHolidayAction.bind(null, h.date)}>
                      <SecondaryButton type="submit">Remove</SecondaryButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* 8. Dropdown Options */}
          <Card>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-ink">8. Add Dropdown Option</h2>
              <Link href="/equipment/types" className="text-xs text-ink-2 hover:text-ink underline">
                Equipment categories →
              </Link>
            </div>
            <p className="mb-3 text-xs text-ink-3">
              Dropdown options are used across report templates, equipment types, and forms.
            </p>
            <form action={addDropdownOption} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="List key" hint="e.g. couplant, surface_condition, equipment_type">
                  <Input
                    name="list_key"
                    required
                    defaultValue={list ?? "couplant"}
                    placeholder="couplant"
                  />
                </Field>
                <Field label="Display order">
                  <Input name="position" type="number" min={0} defaultValue={10} />
                </Field>
              </div>
              <Field label="Option value">
                <Input name="value" required placeholder="e.g. Ultrasonic gel" />
              </Field>
              <Button type="submit">Add option</Button>
            </form>
          </Card>

          <div>
            <SectionTitle>
              Dropdown options ({options.length})
              {listKeys.length > 0 ? ` · ${listKeys.join(", ")}` : ""}
            </SectionTitle>
            <List>
              {options.length === 0 ? (
                <EmptyRow>No dropdown options found.</EmptyRow>
              ) : (
                options.map((opt) => (
                  <li
                    key={opt.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 px-4 py-3 first:border-t-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>
                          <Mono>{opt.list_key}</Mono>
                        </Badge>
                        <span className="font-medium text-ink break-words">{opt.value}</span>
                        <Status tone={opt.active ? "ok" : "none"}>
                          {opt.active ? "Active" : "Inactive"}
                        </Status>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <form action={toggleDropdownOption.bind(null, opt.id, !opt.active)}>
                        <SecondaryButton type="submit">
                          {opt.active ? "Disable" : "Enable"}
                        </SecondaryButton>
                      </form>
                      <form action={removeDropdownOption.bind(null, opt.id)}>
                        <SecondaryButton type="submit">Remove</SecondaryButton>
                      </form>
                    </div>
                  </li>
                ))
              )}
            </List>
          </div>
        </div>
      </div>
    </>
  );
}
