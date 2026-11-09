import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const STAFF_ROLES = ["management", "office", "reviewer"] as const;

const fetchAuthContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, person: null };

  const { data: person } = await supabase
    .from("people")
    .select("id, full_name, roles")
    .eq("user_id", user.id)
    .maybeSingle();

  return { supabase, user, person };
});

// The logged-in user and their BITA person record.
// Not logged in: go to /login. Logged in but not set up at BITA: person is null.
export async function requireUser() {
  const { supabase, user, person } = await fetchAuthContext();
  if (!user) redirect("/login");
  return { supabase, user, person };
}

export function isStaff(roles: readonly string[] | undefined) {
  return !!roles?.some((r) => (STAFF_ROLES as readonly string[]).includes(r));
}

// For office pages. Technicians are sent to their own area (D-015, D-016); the database hides office data from them anyway.
export async function requireStaff() {
  const ctx = await requireUser();
  if (ctx.person && !isStaff(ctx.person.roles) && ctx.person.roles.includes("technician")) redirect("/technician");
  return ctx;
}

// For the technician area. Office staff are sent back to the office screens.
export async function requireTechnician() {
  const ctx = await requireUser();
  if (!ctx.person) redirect("/login");
  if (!ctx.person.roles.includes("technician")) redirect("/");
  return { ...ctx, person: ctx.person };
}
