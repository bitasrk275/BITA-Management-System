import { createClient as createSupabaseAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";
import { listInvoicesModifiedSince, type ZohoConfig, type ZohoDocumentMirror } from "./client";

function getServiceRoleClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Zoho invoice sync.");
  }
  return createSupabaseAdminClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SyncInvoicesResult = {
  fetched: number;
  synced: number;
  skippedUnmatched: string[];
};

/**
 * Mirrors Zoho Books invoices (`number`, `invoice_date`, `due_date`, `total`, `balance`, `status`)
 * into `public.invoices` using the service role. Never calculates GST or keeps a ledger (AGENTS.md rule 4).
 */
export async function syncInvoices(options?: {
  since?: string | Date;
  supabase?: SupabaseClient<Database>;
  zoho?: Partial<ZohoConfig>;
  prefetchedInvoices?: readonly ZohoDocumentMirror[];
}): Promise<SyncInvoicesResult> {
  const supabase = options?.supabase ?? getServiceRoleClient();
  const since = options?.since ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const remoteInvoices =
    options?.prefetchedInvoices ?? (await listInvoicesModifiedSince(since, options?.zoho));

  if (remoteInvoices.length === 0) {
    return { fetched: 0, synced: 0, skippedUnmatched: [] };
  }

  const refNumbers = [
    ...new Set(
      remoteInvoices
        .map((inv) => inv.reference_number?.trim())
        .filter((r): r is string => !!r)
    ),
  ];

  const { data: matchedJobs, error: jobsError } = refNumbers.length
    ? await supabase.from("jobs").select("id, job_no, status").in("job_no", refNumbers)
    : { data: [], error: null };

  if (jobsError) {
    throw new Error(`Failed to look up jobs for Zoho sync: ${jobsError.message}`);
  }

  const jobByNo = new Map((matchedJobs ?? []).map((j) => [j.job_no, j]));
  const nowIso = new Date().toISOString();
  let synced = 0;
  const skippedUnmatched: string[] = [];

  for (const inv of remoteInvoices) {
    const ref = inv.reference_number?.trim();
    const job = ref ? jobByNo.get(ref) : undefined;
    if (!job) {
      skippedUnmatched.push(inv.zoho_id);
      continue;
    }

    const { error: upsertErr } = await supabase.from("invoices").upsert(
      {
        job_id: job.id,
        kind: inv.kind,
        zoho_id: inv.zoho_id,
        number: inv.number,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        total: inv.total ?? 0,
        balance: inv.balance ?? 0,
        // In-app invoice statuses (D-017); Zoho's draft/sent/overdue map onto them.
        status:
          inv.status === "draft"
            ? "draft"
            : inv.balance === 0 && (inv.total ?? 0) > 0
              ? "paid"
              : (inv.balance ?? 0) < (inv.total ?? 0)
                ? "partly_paid"
                : "issued",
        last_synced_at: nowIso,
      },
      { onConflict: "zoho_id" }
    );

    if (upsertErr) {
      throw new Error(`Failed to upsert Zoho invoice ${inv.zoho_id}: ${upsertErr.message}`);
    }

    if (inv.kind === "tax_invoice" && job.status === "report_sent") {
      await supabase.from("jobs").update({ status: "invoiced" }).eq("id", job.id);
    }

    synced += 1;
  }

  return {
    fetched: remoteInvoices.length,
    synced,
    skippedUnmatched,
  };
}
