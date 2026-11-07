import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";
import { generatePairingCode, generateRandomSecret, sha256 } from "./crypto";

// In-memory rate limiting: 5 failed attempts per minute per IP
const failedAttemptsByIp = new Map<string, number[]>();

const MAX_FAILED_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export function isRateLimited(ip: string, now = Date.now()): boolean {
  const attempts = failedAttemptsByIp.get(ip) || [];
  const validAttempts = attempts.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  failedAttemptsByIp.set(ip, validAttempts);
  return validAttempts.length >= MAX_FAILED_ATTEMPTS;
}

export function recordFailedAttempt(ip: string, now = Date.now()): void {
  const attempts = failedAttemptsByIp.get(ip) || [];
  const validAttempts = attempts.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  validAttempts.push(now);
  failedAttemptsByIp.set(ip, validAttempts);
}

export function resetRateLimitsForTesting(): void {
  failedAttemptsByIp.clear();
}

export type RedeemResult =
  | {
      ok: true;
      deviceId: string;
      secret: string;
      technician: {
        id: string;
        name: string;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

/**
 * Creates a fresh 6-digit pairing code valid for 15 minutes.
 * Used by the office dashboard ("Link a phone" on technician row).
 */
export async function createPairingCode(
  supabase: SupabaseClient<Database>,
  params: {
    personId: string;
    createdBy?: string | null;
  },
): Promise<{ code: string; expiresAt: string; id: string }> {
  const code = generatePairingCode();
  const codeHash = sha256(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("pairing_codes")
    .insert({
      person_id: params.personId,
      code_hash: codeHash,
      expires_at: expiresAt,
      created_by: params.createdBy ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create pairing code: ${error?.message || "Unknown error"}`);
  }

  return {
    id: data.id,
    code,
    expiresAt,
  };
}

/**
 * Redeems a 6-digit pairing code from the Android app.
 * Enforces rate limiting, single-use, and expiration.
 */
export async function redeemPairingCode(
  supabase: SupabaseClient<Database>,
  params: {
    code: string;
    deviceName?: string | null;
    pushToken?: string | null;
    ip: string;
  },
): Promise<RedeemResult> {
  const ip = params.ip || "127.0.0.1";

  // Check rate limit
  if (isRateLimited(ip)) {
    return {
      ok: false,
      status: 429,
      error: "Too many failed pairing attempts. Please wait a minute before trying again.",
    };
  }

  const cleanCode = (params.code || "").trim();
  if (!cleanCode || !/^\d{6}$/.test(cleanCode)) {
    recordFailedAttempt(ip);
    return {
      ok: false,
      status: 400,
      error: "Pairing code must be 6 numeric digits.",
    };
  }

  const codeHash = sha256(cleanCode);
  const now = new Date().toISOString();

  // Find unused, unexpired code row
  const { data: codeRow, error: codeError } = await supabase
    .from("pairing_codes")
    .select("id, person_id, expires_at, used_at")
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();

  if (codeError || !codeRow) {
    recordFailedAttempt(ip);
    return {
      ok: false,
      status: 400,
      error: "Invalid or expired pairing code.",
    };
  }

  // Claim the code atomically: only one request can flip used_at from null, so two phones
  // racing with the same code cannot both pair.
  const { data: claimed, error: updateError } = await supabase
    .from("pairing_codes")
    .update({ used_at: now })
    .eq("id", codeRow.id)
    .is("used_at", null)
    .select("id");

  if (updateError) {
    return {
      ok: false,
      status: 500,
      error: "Failed to process pairing code.",
    };
  }
  if (!claimed || claimed.length === 0) {
    recordFailedAttempt(ip);
    return {
      ok: false,
      status: 400,
      error: "Invalid or expired pairing code.",
    };
  }

  // Generate device secret & secret hash
  const secret = generateRandomSecret();
  const secretHash = sha256(secret);

  const { data: device, error: deviceError } = await supabase
    .from("technician_devices")
    .insert({
      person_id: codeRow.person_id,
      device_name: params.deviceName || null,
      push_token: params.pushToken || null,
      secret_hash: secretHash,
    })
    .select("id")
    .single();

  if (deviceError || !device) {
    return {
      ok: false,
      status: 500,
      error: "Failed to register technician device.",
    };
  }

  // Fetch technician name
  const { data: person } = await supabase
    .from("people")
    .select("id, full_name")
    .eq("id", codeRow.person_id)
    .maybeSingle();

  return {
    ok: true,
    deviceId: device.id,
    secret,
    technician: {
      id: codeRow.person_id,
      name: person?.full_name ?? "Technician",
    },
  };
}
