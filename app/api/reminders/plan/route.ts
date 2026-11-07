import { todayIST } from "../../../../lib/dates";
import type { Database } from "../../../../lib/db/types";
import { planAndInsertReminders } from "../../../../lib/reminders/plan";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

function authenticateCronRequest(req: Request): NextResponse | null {
  const expectedSecret = process.env.REMINDERS_CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "REMINDERS_CRON_SECRET is not configured on the server" },
      { status: 500 },
    );
  }

  const authHeader =
    req.headers.get("x-reminders-cron-secret") ||
    req.headers.get("authorization");

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (!token || !sameSecret(token, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(req: Request) {
  const authError = authenticateCronRequest(req);
  if (authError) return authError;

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase service role credentials not configured" },
      { status: 500 },
    );
  }

  // Parse optional target date from body (defaulting to today in IST)
  let targetDate = todayIST();
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      targetDate = body.date;
    }
  } catch {
    // Body optional
  }

  try {
    const result = await planAndInsertReminders(supabaseAdmin, targetDate);

    return NextResponse.json({
      ok: true,
      channel: "email",
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Marks a planned payment reminder as sent (`sent_at`) after n8n delivers the email
 * to the customer's `receives_invoices = true` contacts.
 */
export async function PATCH(req: Request) {
  const authError = authenticateCronRequest(req);
  if (authError) return authError;

  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  const reminderId =
    body && typeof body.reminder_id === "string" ? body.reminder_id.trim() : "";
  const invoiceId =
    body && typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";
  const scheduledFor =
    body && typeof body.scheduled_for === "string" ? body.scheduled_for.trim() : "";

  if (!reminderId && (!invoiceId || !scheduledFor)) {
    return NextResponse.json(
      { error: "Provide reminder_id or (invoice_id and scheduled_for)" },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase service role credentials not configured" },
      { status: 500 },
    );
  }

  const sentAt =
    body && typeof body.sent_at === "string" && body.sent_at.trim()
      ? body.sent_at.trim()
      : new Date().toISOString();

  try {
    let query = supabaseAdmin
      .from("payment_reminders")
      .update({ sent_at: sentAt });

    if (reminderId) {
      query = query.eq("id", reminderId);
    } else {
      query = query
        .eq("invoice_id", invoiceId)
        .eq("scheduled_for", scheduledFor);
    }

    const { error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      reminder_id: reminderId || null,
      invoice_id: invoiceId || null,
      scheduled_for: scheduledFor || null,
      sent_at: sentAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// Compares secrets in constant time, so response timing reveals nothing about the secret.
function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
