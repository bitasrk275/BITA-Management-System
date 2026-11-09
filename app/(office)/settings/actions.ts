"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import type { Enums, Json } from "@/lib/db/types";
import { friendlyError, text } from "@/lib/forms";
import {
  PERMISSION_ACTIONS,
  parseSettingsOptionInput,
} from "@/lib/modules/settings/schema";
import {
  createSettingsOption,
  deleteSettingsOption,
  getSetting,
  updateSettingsOption,
  upsertSetting,
} from "@/lib/modules/settings/service";
import {
  broadcastTelegramNotification,
  buildExecutiveSnapshot,
  formatExecutiveDigestMessage,
  generateTelegramLinkCode,
  getTelegramLinksState,
  saveTelegramLinksState,
} from "@/lib/modules/telegram/service";

export async function addDropdownOption(fd: FormData) {
  const { supabase } = await requireStaff();
  const parsed = parseSettingsOptionInput({
    list_key: text(fd, "list_key") ?? "",
    value: text(fd, "value") ?? "",
    position: text(fd, "position") ?? "0",
    active: true,
  });

  if (!parsed.ok) {
    redirect("/settings?error=" + encodeURIComponent(parsed.error));
  }

  const { error } = await createSettingsOption(supabase, parsed.value);
  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function toggleDropdownOption(id: string, nextActive: boolean) {
  const { supabase } = await requireStaff();
  const { error } = await updateSettingsOption(supabase, id, { active: nextActive });
  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function removeDropdownOption(id: string) {
  const { supabase } = await requireStaff();
  const res = await deleteSettingsOption(supabase, id);
  if (!res.ok) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(res.error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function saveCompanyProfileAction(fd: FormData) {
  const { supabase, person } = await requireStaff();
  const payload = {
    name: text(fd, "name") ?? "BANGALORE INSPECTION & TESTING AGENCY",
    address: text(fd, "address") ?? "",
    phone: text(fd, "phone") ?? "",
    email: text(fd, "email") ?? "",
    pan: text(fd, "pan") ?? "",
    gstin: text(fd, "gstin") ?? "",
    default_sac: text(fd, "default_sac") ?? "998393",
    bank_name: text(fd, "bank_name") ?? "",
    bank_branch: text(fd, "bank_branch") ?? "",
    bank_account_no: text(fd, "bank_account_no") ?? "",
    bank_ifsc: text(fd, "bank_ifsc") ?? "",
  };

  const { error } = await upsertSetting(
    supabase,
    "company_profile",
    payload as unknown as Json,
    "BITA company header, tax identifiers, default SAC 998393, and bank account details printed on invoices",
    person?.id ?? null,
  );

  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  revalidatePath("/invoices");
  redirect("/settings?saved=1");
}

export async function saveInvoiceNumberingAction(fd: FormData) {
  const { supabase, person } = await requireStaff();
  const payload = {
    tax_prefix: text(fd, "tax_prefix") ?? "",
    next_tax_no: Math.max(1, Number(text(fd, "next_tax_no") ?? "5388") || 5388),
    proforma_prefix: text(fd, "proforma_prefix") ?? "PI/",
    next_proforma_no: Math.max(1, Number(text(fd, "next_proforma_no") ?? "1") || 1),
    credit_note_prefix: text(fd, "credit_note_prefix") ?? "CN/",
    next_credit_note_no: Math.max(1, Number(text(fd, "next_credit_note_no") ?? "1") || 1),
    default_sac: text(fd, "default_sac") ?? "998393",
  };

  const { error } = await upsertSetting(
    supabase,
    "invoice_numbering",
    payload as unknown as Json,
    "Invoice, proforma, and credit note numbering counters and prefixes",
    person?.id ?? null,
  );

  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function saveReminderTimingsAction(fd: FormData) {
  const { supabase, person } = await requireStaff();
  const payload = {
    before_due_days: Math.max(0, Number(text(fd, "before_due_days") ?? "2") || 0),
    on_due: fd.get("on_due") === "on" || fd.get("on_due") === "true",
    overdue_start_days: Math.max(1, Number(text(fd, "overdue_start_days") ?? "5") || 5),
    calibration_alert_days: Math.max(1, Number(text(fd, "calibration_alert_days") ?? "30") || 30),
  };

  const { error } = await upsertSetting(
    supabase,
    "reminder_timings",
    payload as unknown as Json,
    "Payment reminder schedule intervals and equipment calibration alert window",
    person?.id ?? null,
  );

  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function savePermissionsMatrixAction(fd: FormData) {
  const { supabase, person } = await requireStaff();
  const validRoles: readonly Enums<"app_role">[] = [
    "management",
    "office",
    "reviewer",
    "technician",
  ];
  const matrix: Record<string, string[]> = {};

  for (const action of PERMISSION_ACTIONS) {
    const selected = fd
      .getAll(`perm_${action}`)
      .map((v) => String(v))
      .filter((r) => (validRoles as readonly string[]).includes(r));
    matrix[action] = selected.length > 0 ? selected : ["management"];
  }

  const { error } = await upsertSetting(
    supabase,
    "permissions",
    matrix as unknown as Json,
    "Role-based permission matrix for delete, salaries, report approval, and invoicing",
    person?.id ?? null,
  );

  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function addHolidayAction(fd: FormData) {
  const { supabase, person } = await requireStaff();
  const date = (text(fd, "holiday_date") ?? "").trim();
  const name = (text(fd, "holiday_name") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) {
    redirect("/settings?error=" + encodeURIComponent("Holiday date and name are required."));
  }

  const { data } = await getSetting(supabase, "holidays");
  const existing = Array.isArray(data?.value)
    ? (data.value as Array<{ date?: string; name?: string }>)
    : [];
  const filtered = existing.filter((h) => h?.date !== date);
  filtered.push({ date, name });
  filtered.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));

  const { error } = await upsertSetting(
    supabase,
    "holidays",
    filtered as unknown as Json,
    "Company holidays displayed on the scheduling calendar",
    person?.id ?? null,
  );

  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  revalidatePath("/calendar");
  redirect("/settings?saved=1");
}

export async function removeHolidayAction(date: string) {
  const { supabase, person } = await requireStaff();
  const { data } = await getSetting(supabase, "holidays");
  const existing = Array.isArray(data?.value)
    ? (data.value as Array<{ date?: string; name?: string }>)
    : [];
  const filtered = existing.filter((h) => h?.date !== date);

  const { error } = await upsertSetting(
    supabase,
    "holidays",
    filtered as unknown as Json,
    "Company holidays displayed on the scheduling calendar",
    person?.id ?? null,
  );

  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  revalidatePath("/calendar");
  redirect("/settings?saved=1");
}

export async function addReportTemplateFieldAction(fd: FormData) {
  const { supabase, person } = await requireStaff();
  const method = (text(fd, "method") ?? "UT").toUpperCase();
  const key = (text(fd, "field_key") ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  const label = (text(fd, "field_label") ?? "").trim();
  const input = (text(fd, "field_input") ?? "text").trim();
  const required = fd.get("field_required") === "on" || fd.get("field_required") === "true";

  if (!key || !label) {
    redirect("/settings?error=" + encodeURIComponent("Field key and label are required."));
  }

  const { data } = await getSetting(supabase, "report_templates");
  const current =
    data?.value && typeof data.value === "object" && !Array.isArray(data.value)
      ? ({ ...(data.value as Record<string, unknown>) } as Record<string, unknown[]>)
      : {};

  const methodFields = Array.isArray(current[method]) ? [...current[method]] : [];
  const filtered = methodFields.filter(
    (f) => !(f && typeof f === "object" && (f as { key?: string }).key === key),
  );
  filtered.push({ key, label, input, required });
  current[method] = filtered;

  const { error } = await upsertSetting(
    supabase,
    "report_templates",
    current as unknown as Json,
    "Dynamic custom report fields per NDT test method (UT, MPT, DPT)",
    person?.id ?? null,
  );

  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function removeReportTemplateFieldAction(method: string, fieldKey: string) {
  const { supabase, person } = await requireStaff();
  const { data } = await getSetting(supabase, "report_templates");
  const current =
    data?.value && typeof data.value === "object" && !Array.isArray(data.value)
      ? ({ ...(data.value as Record<string, unknown>) } as Record<string, unknown[]>)
      : {};

  const methodFields = Array.isArray(current[method]) ? [...current[method]] : [];
  current[method] = methodFields.filter(
    (f) => !(f && typeof f === "object" && (f as { key?: string }).key === fieldKey),
  );

  const { error } = await upsertSetting(
    supabase,
    "report_templates",
    current as unknown as Json,
    "Dynamic custom report fields per NDT test method (UT, MPT, DPT)",
    person?.id ?? null,
  );

  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function saveTelegramConfigAction(fd: FormData) {
  const { supabase, person } = await requireStaff();
  const payload = {
    bot_token: (text(fd, "bot_token") ?? "").trim(),
    bot_username: (text(fd, "bot_username") ?? "").trim().replace(/^@/, ""),
    enabled: fd.get("enabled") === "on" || fd.get("enabled") === "true",
    notify_on_report:
      fd.get("notify_on_report") === "on" || fd.get("notify_on_report") === "true",
    notify_on_invoice:
      fd.get("notify_on_invoice") === "on" || fd.get("notify_on_invoice") === "true",
    notify_on_payment:
      fd.get("notify_on_payment") === "on" || fd.get("notify_on_payment") === "true",
    notify_daily_digest:
      fd.get("notify_daily_digest") === "on" || fd.get("notify_daily_digest") === "true",
  };

  const { error } = await upsertSetting(
    supabase,
    "telegram_config",
    payload as unknown as Json,
    "Telegram Executive Bot configuration and notification preferences",
    person?.id ?? null,
  );

  if (error) {
    redirect("/settings?error=" + encodeURIComponent(friendlyError(error)));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function createTelegramPairingCodeAction() {
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");
  const res = await generateTelegramLinkCode(supabase, {
    id: person.id,
    name: person.full_name,
  });
  if (!res.ok) {
    redirect("/settings?error=" + encodeURIComponent(res.error));
  }
  revalidatePath("/settings");
  redirect(`/settings?tg_code=${encodeURIComponent(res.code)}`);
}

export async function unlinkTelegramChatAction(chatId: string) {
  const { supabase, person } = await requireStaff();
  const state = await getTelegramLinksState(supabase);
  const nextChats = state.chats.filter((c) => c.chat_id !== chatId);
  const res = await saveTelegramLinksState(
    supabase,
    { chats: nextChats, pending_codes: state.pending_codes },
    person?.id ?? null,
  );
  if (!res.ok) {
    redirect("/settings?error=" + encodeURIComponent(res.error ?? "Could not unlink chat."));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function sendTestTelegramDigestAction() {
  const { supabase } = await requireStaff();
  const snap = await buildExecutiveSnapshot(supabase);
  const msg = formatExecutiveDigestMessage(snap);
  const res = await broadcastTelegramNotification(supabase, "test", msg);
  if (res.errors.length > 0 && res.sent === 0) {
    redirect("/settings?error=" + encodeURIComponent(res.errors[0]));
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
