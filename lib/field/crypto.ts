import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Computes sha256 hex digest of a UTF-8 string.
 */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Constant-time comparison of two strings to prevent timing side-channel attacks.
 * Returns true if both digests match.
 */
export function constantTimeCompare(given: string, expectedHash: string): boolean {
  try {
    const givenHash = sha256(given);
    const bufA = Buffer.from(givenHash, "hex");
    const bufB = Buffer.from(expectedHash, "hex");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Generates a cryptographically secure 32-byte secret encoded as hex.
 */
export function generateRandomSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Generates a 6-digit random pairing code string (e.g. "492104").
 */
export function generatePairingCode(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return num.toString();
}
