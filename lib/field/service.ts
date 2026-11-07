import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";
import { requireSupabaseAdminEnv } from "../env";

/**
 * Returns a Supabase client with admin / service privileges.
 * Technicians have no login, so all server-side field routes and "Link a phone"
 * run with the service role (SUPABASE_SERVICE_ROLE_KEY is required).
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  // No fallback to the anon key: it would hit RLS and fail with a misleading error.
  const { url, serviceRoleKey } = requireSupabaseAdminEnv();

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
