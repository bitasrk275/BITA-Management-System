import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isStaff } from "@/lib/auth";
import type { Database, Enums } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export type ApiPerson = {
  id: string;
  full_name: string;
  roles: Enums<"app_role">[];
};

export type ApiAuthContext =
  | {
      ok: true;
      supabase: SupabaseClient<Database>;
      user: User;
      person: ApiPerson;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

/**
 * Authenticates `/api/v1/*` requests using the logged-in Supabase session (cookies)
 * and verifies that the caller is an active BITA staff member (management, office, or reviewer).
 * Row Level Security continues to enforce table-level permissions on `supabase`.
 */
export async function requireApiStaff(
  clientFactory: () => Promise<SupabaseClient<Database>> = createClient,
): Promise<ApiAuthContext> {
  const supabase = await clientFactory();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: apiError("Authentication required.", 401),
    };
  }

  const { data: person } = await supabase
    .from("people")
    .select("id, full_name, roles")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!person || !isStaff(person.roles)) {
    return {
      ok: false,
      response: apiError("Staff access required.", 403),
    };
  }

  return {
    ok: true,
    supabase,
    user,
    person,
  };
}
