import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";

export type PushNotificationPayload = {
  to: string | string[];
  title?: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PushResult = {
  ok: boolean;
  count: number;
  error?: string;
};

/**
 * Validates an Expo push token format.
 */
export function isValidExpoPushToken(token: unknown): boolean {
  if (typeof token !== "string") return false;
  return /^(?:ExponentPushToken|ExpoPushToken)\[.+\]$/.test(token.trim());
}

/**
 * Sends push notifications through Expo's push service.
 * Free service, does not fail or crash if the network or push service is unreachable.
 */
export async function sendExpoPushNotification(
  payload: PushNotificationPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  const recipients = (Array.isArray(payload.to) ? payload.to : [payload.to])
    .map((t) => t.trim())
    .filter(isValidExpoPushToken);

  if (recipients.length === 0) {
    return { ok: true, count: 0 };
  }

  const messages = recipients.map((to) => ({
    to,
    sound: "default",
    title: payload.title || "BITA Field",
    body: payload.body,
    data: payload.data || {},
  }));

  try {
    const res = await fetchImpl("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        count: 0,
        error: `Expo push service returned HTTP ${res.status}: ${text}`,
      };
    }

    return { ok: true, count: recipients.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      count: 0,
      error: `Failed to contact Expo push service: ${message}`,
    };
  }
}

/**
 * Sends a push notification to all active (non-revoked) devices linked to a technician.
 */
export async function notifyTechnician(
  supabase: SupabaseClient<Database>,
  personId: string,
  notification: {
    title?: string;
    body: string;
    data?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  // Query all non-revoked devices with a push token for this technician
  const { data: devices, error } = await supabase
    .from("technician_devices")
    .select("push_token")
    .eq("person_id", personId)
    .is("revoked_at", null)
    .not("push_token", "is", null);

  if (error || !devices || devices.length === 0) {
    return { ok: true, count: 0 };
  }

  const tokens = devices
    .map((d) => d.push_token)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  if (tokens.length === 0) {
    return { ok: true, count: 0 };
  }

  return sendExpoPushNotification(
    {
      to: tokens,
      title: notification.title,
      body: notification.body,
      data: notification.data,
    },
    fetchImpl,
  );
}
