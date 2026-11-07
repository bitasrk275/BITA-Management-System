import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";

/**
 * Returns a Supabase client with admin / service privileges.
 * Technicians have no login, so all server-side field routes run with the service role.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase credentials for field service client.");
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
