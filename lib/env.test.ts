import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_ADMIN_ENV_VARS,
  REQUIRED_REMINDERS_ENV_VARS,
  REQUIRED_SERVER_ENV_VARS,
  checkAiEnv,
  checkRemindersEnv,
  getMissingEnvVars,
  requireCoreServerEnv,
  requireEnvVars,
  requireSupabaseAdminEnv,
} from "./env";

describe("Server environment variable validation (lib/env.ts)", () => {
  it("identifies unset or whitespace-only environment variables", () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "   ",
    };

    expect(getMissingEnvVars(REQUIRED_SERVER_ENV_VARS, env)).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("throws an error naming all missing variables in requireEnvVars", () => {
    expect(() =>
      requireEnvVars(REQUIRED_ADMIN_ENV_VARS, {
        NEXT_PUBLIC_SUPABASE_URL: "",
      }),
    ).toThrow(
      /Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("returns trimmed values when all required variables are present", () => {
    const admin = requireSupabaseAdminEnv({
      NEXT_PUBLIC_SUPABASE_URL: " https://demo.supabase.co ",
      SUPABASE_SERVICE_ROLE_KEY: " service-secret-key ",
    });
    expect(admin).toEqual({
      url: "https://demo.supabase.co",
      serviceRoleKey: "service-secret-key",
    });

    const core = requireCoreServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-secret-key",
    });
    expect(core.anonKey).toBe("anon-key");
  });

  it("checks reminders and AI environment variables without throwing at import time", () => {
    const remMissing = checkRemindersEnv({});
    expect(remMissing.missing).toEqual([...REQUIRED_REMINDERS_ENV_VARS]);
    expect(remMissing.cronSecret).toBeNull();

    const remOk = checkRemindersEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-secret",
      REMINDERS_CRON_SECRET: "cron-secret-123",
    });
    expect(remOk.missing).toEqual([]);
    expect(remOk.cronSecret).toBe("cron-secret-123");

    const aiMissing = checkAiEnv({});
    expect(aiMissing.missing).toEqual(["ANTHROPIC_API_KEY"]);
    expect(aiMissing.apiKey).toBeNull();

    const aiOk = checkAiEnv({
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_MODEL: "claude-sonnet-5-5",
    });
    expect(aiOk.missing).toEqual([]);
    expect(aiOk.apiKey).toBe("sk-ant-test");
    expect(aiOk.model).toBe("claude-sonnet-5-5");
  });

  it("documents every required variable in .env.example with no secret values", () => {
    const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    for (const key of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "REMINDERS_CRON_SECRET",
      "EXPO_PUBLIC_API_URL",
      "ANTHROPIC_API_KEY",
    ]) {
      expect(envExample).toContain(`${key}=`);
    }

    // Ensure every assignment line in .env.example has an empty value (no committed secrets)
    const assignmentLines = envExample
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"));
    for (const line of assignmentLines) {
      expect(line).toMatch(/^[A-Z0-9_]+=$/);
    }
  });
});
