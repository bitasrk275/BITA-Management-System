// Shared PGlite test harness for running all Supabase migrations and executing queries
// as a specific authenticated user (with Row Level Security enforced) or as service_role.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

export const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects to authenticated, service_role;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  async function as<T>(userId: string | "service", sql: string, params: unknown[] = []) {
    await db.exec(
      userId === "service"
        ? "set role service_role; select set_config('request.jwt.claim.sub', '', false);"
        : `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`,
    );
    try {
      return await db.query<T>(sql, params);
    } finally {
      await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    }
  }

  return { db, as };
}
