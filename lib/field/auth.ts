import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";
import { constantTimeCompare } from "./crypto";

export type AuthenticatedFieldDevice = {
  deviceId: string;
  deviceName: string | null;
  pushToken: string | null;
  technician: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  };
};

export type DeviceAuthResult =
  | { ok: true; auth: AuthenticatedFieldDevice }
  | { ok: false; status: 401; error: string };

/**
 * Extracts deviceId and secret from Authorization header.
 * Expected format: `Bearer <deviceId>.<secret>`
 */
export function extractDeviceToken(
  authHeader: string | null,
): { deviceId: string; secret: string } | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/);
  if (!match) return null;
  return {
    deviceId: match[1],
    secret: match[2],
  };
}

/**
 * Authenticates a field app request using its device bearer token.
 * Verifies that the device exists, is not revoked, and that the secret matches.
 * Also touches `last_seen_at`.
 */
export async function authenticateDevice(
  supabase: SupabaseClient<Database>,
  authHeader: string | null,
): Promise<DeviceAuthResult> {
  const token = extractDeviceToken(authHeader);
  if (!token) {
    return { ok: false, status: 401, error: "Missing or invalid authorization header." };
  }

  // Look up device record
  const { data: device, error: deviceError } = await supabase
    .from("technician_devices")
    .select("id, person_id, device_name, secret_hash, push_token, revoked_at")
    .eq("id", token.deviceId)
    .maybeSingle();

  if (deviceError || !device) {
    return { ok: false, status: 401, error: "Unknown or invalid device." };
  }

  if (device.revoked_at) {
    return { ok: false, status: 401, error: "This device has been revoked by the office." };
  }

  // Constant-time compare secret against stored sha256 hash
  const isValidSecret = constantTimeCompare(token.secret, device.secret_hash);
  if (!isValidSecret) {
    return { ok: false, status: 401, error: "Invalid device credentials." };
  }

  // Update last_seen_at timestamp
  const now = new Date().toISOString();
  await supabase
    .from("technician_devices")
    .update({ last_seen_at: now })
    .eq("id", device.id);

  // Fetch technician person details
  const { data: person } = await supabase
    .from("people")
    .select("id, full_name, mobile, email")
    .eq("id", device.person_id)
    .maybeSingle();

  return {
    ok: true,
    auth: {
      deviceId: device.id,
      deviceName: device.device_name,
      pushToken: device.push_token,
      technician: {
        id: device.person_id,
        name: person?.full_name ?? "Technician",
        phone: person?.mobile ?? null,
        email: person?.email ?? null,
      },
    },
  };
}
