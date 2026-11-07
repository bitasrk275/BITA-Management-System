// Server-side environment variable validation (T41).
// Call these functions inside server routes, server actions, or service helpers where needed —
// never at module import time in client code.

export const REQUIRED_SERVER_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export const REQUIRED_ADMIN_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export const REQUIRED_REMINDERS_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REMINDERS_CRON_SECRET",
] as const;

export const REQUIRED_AI_ENV_VARS = ["ANTHROPIC_API_KEY"] as const;

export type EnvSource = Record<string, string | undefined>;

/**
 * Returns the names of any required environment variables that are unset or empty/whitespace.
 */
export function getMissingEnvVars(
  names: readonly string[],
  env: EnvSource = process.env,
): string[] {
  const missing: string[] = [];
  for (const name of names) {
    const val = env[name];
    if (typeof val !== "string" || val.trim().length === 0) {
      missing.push(name);
    }
  }
  return missing;
}

/**
 * Validates that every variable in `names` is set and non-empty in `env`.
 * Throws a descriptive Error listing all missing variable names if any are missing.
 */
export function requireEnvVars<K extends string>(
  names: readonly K[],
  env: EnvSource = process.env,
): Record<K, string> {
  const missing = getMissingEnvVars(names, env);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Set ${missing.length > 1 ? "them" : "it"} in .env.local or your hosting provider's environment settings.`,
    );
  }

  const out = {} as Record<K, string>;
  for (const name of names) {
    out[name] = env[name]!.trim();
  }
  return out;
}

/**
 * Validates and returns the required Supabase admin credentials (`NEXT_PUBLIC_SUPABASE_URL`
 * and `SUPABASE_SERVICE_ROLE_KEY`), needed by "Link a phone", `/api/field/*`, and payment reminders.
 */
export function requireSupabaseAdminEnv(env: EnvSource = process.env): {
  url: string;
  serviceRoleKey: string;
} {
  const vars = requireEnvVars(REQUIRED_ADMIN_ENV_VARS, env);
  return {
    url: vars.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: vars.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/**
 * Validates all core server environment variables (`NEXT_PUBLIC_SUPABASE_URL`,
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
 */
export function requireCoreServerEnv(env: EnvSource = process.env): {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
} {
  const vars = requireEnvVars(REQUIRED_SERVER_ENV_VARS, env);
  return {
    url: vars.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: vars.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: vars.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/**
 * Checks the environment variables needed by `/api/reminders/plan`.
 */
export function checkRemindersEnv(env: EnvSource = process.env): {
  missing: string[];
  url: string | null;
  serviceRoleKey: string | null;
  cronSecret: string | null;
} {
  const missing = getMissingEnvVars(REQUIRED_REMINDERS_ENV_VARS, env);
  return {
    missing,
    url: env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null,
    cronSecret: env.REMINDERS_CRON_SECRET?.trim() || null,
  };
}

/**
 * Checks the environment variables used by `lib/ai/extract-enquiry.ts`.
 */
export function checkAiEnv(env: EnvSource = process.env): {
  missing: string[];
  apiKey: string | null;
  model: string | null;
} {
  const missing = getMissingEnvVars(REQUIRED_AI_ENV_VARS, env);
  return {
    missing,
    apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    model: env.ANTHROPIC_MODEL?.trim() || null,
  };
}
