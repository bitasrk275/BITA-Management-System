import type { ReactNode } from "react";
import { AppShell, type NavCounts } from "@/components/app-shell";
import { requireStaff } from "@/lib/auth";

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const { supabase, person } = await requireStaff();

  if (!person) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <p className="rounded-lg border border-wait/30 bg-wait/5 px-3.5 py-2.5 text-[15px] text-ink">
          Your login works, but it isn&apos;t set up as BITA staff yet. Ask Naveen to add you.
        </p>
      </main>
    );
  }

  // Menu counts: what is waiting in each area.
  const [enquiries, quotations, jobs, reports] = await Promise.all([
    supabase.from("enquiries").select("id", { count: "exact", head: true }).in("status", ["new", "linked"]),
    supabase.from("quotations").select("id", { count: "exact", head: true }).eq("status", "draft"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).neq("status", "closed"),
    supabase.from("reports").select("id", { count: "exact", head: true }).in("status", ["draft", "in_review"]),
  ]);
  const counts: NavCounts = {
    enquiries: enquiries.count ?? 0,
    quotations: quotations.count ?? 0,
    jobs: jobs.count ?? 0,
    reports: reports.count ?? 0,
  };

  return (
    <AppShell person={person} counts={counts}>
      {children}
    </AppShell>
  );
}
