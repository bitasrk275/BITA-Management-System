import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";

/**
 * Returns a Supabase client with admin / service privileges.
 * Technicians have no login, so all server-side field routes run with the service role.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // No fallback to the anon key: it would hit RLS and fail with a misleading error.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
