import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Json } from "../../db/types";
import { todayIST } from "../../dates";
import {
  calculateInvoiceGst,
  sumTaxableValue,
  type BuiltInvoiceLine,
} from "../../invoices";
import {
  buildDraftInvoiceLinesFromPriceList,
  listPriceItems,
} from "../price-items/service";
import { METHOD_LABEL } from "../../../app/(office)/jobs/labels";
import type {
  CreateCreditNoteInput,
  CreateInvoiceFromReportsInput,
  RecordPaymentInput,
} from "./schema";

type AppSupabase = SupabaseClient<Database>;

export interface ReportInvoiceCandidate {
  id: string;
  report_no: string;
  report_date: string;
  method: Enums<"test_method">;
  status: Enums<"report_status">;
  approved_at: string | null;
  content?: Json | null;
  job_id: string;
  job_no: string;
  customer_id: string;
  customer_name: string;
  customer_gstin: string | null;
  customer_billing_address?: string | null;
  customer_po_number: string | null;
  po_value: number | null;
  payment_terms_days?: number;
}

export interface ActiveReportInvoiceLink {
  invoice_id: string;
  invoice_no: string;
  status: string;
  kind: Enums<"invoice_kind">;
}

/**
 * Returns true when a report is approved (`approved_at != null` or status in `approved`/`sent`)
 * and is NOT linked to any non-cancelled invoice (`invoice_reports` or `invoices.report_id`).
 */
export function isReportInvoicePending(
  report: { id: string; status: string; approved_at: string | null },
  activeInvoiceReportIds: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): boolean {
  const isApproved =
    Boolean(report.approved_at) ||
    report.status === "approved" ||
    report.status === "sent";
  if (!isApproved) return false;
  return !activeInvoiceReportIds.has(report.id);
}

/**
 * Normalizes a GSTIN string for comparison.
 */
export function normalizeGstin(gstin: string | null | undefined): string {
  return (gstin ?? "").trim().toUpperCase();
}

/**
 * Collects distinct non-empty PO numbers in insertion order and joins them with ", ".
 */
export function collectDistinctPoNumbers(
  poNumbers: readonly (string | null | undefined)[],
): string | null {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of poNumbers) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(trimmed);
    }
  }
  return ordered.length > 0 ? ordered.join(", ") : null;
}

export interface ValidatedReportGroup {
  customer_id: string;
  customer_name: string;
  customer_gstin: string | null;
  combined_po_number: string | null;
  distinct_po_numbers: string[];
  primary_job_id: string;
}

/**
 * Validates that one or more reports are all approved and belong to the same customer GSTIN
 * (or the same customer_id when both have blank GSTIN). Also combines all distinct PO numbers.
 */
export function validateReportsShareCustomerGstin(
  reports: readonly ReportInvoiceCandidate[],
): ValidatedReportGroup {
  if (reports.length === 0) {
    throw new Error("Select at least one approved report to prepare an invoice.");
  }

  for (const r of reports) {
    const approved =
      Boolean(r.approved_at) || r.status === "approved" || r.status === "sent";
    if (!approved) {
      throw new Error(
        `Report ${r.report_no} is not approved yet (${r.status}). Only approved reports can be invoiced.`,
      );
    }
  }

  const first = reports[0];
  const firstGstin = normalizeGstin(first.customer_gstin);

  for (const r of reports.slice(1)) {
    const gstin = normalizeGstin(r.customer_gstin);
    if (firstGstin !== "" || gstin !== "") {
      if (firstGstin !== gstin) {
        throw new Error(
          `All reports on one invoice must share the same customer GSTIN (${first.report_no} has ${firstGstin || "unregistered"} vs ${r.report_no} with ${gstin || "unregistered"}).`,
        );
      }
    } else if (r.customer_id !== first.customer_id) {
      throw new Error(
        `All reports on one invoice must belong to the same customer (${first.customer_name} vs ${r.customer_name}).`,
      );
    }
  }

  const combinedPo = collectDistinctPoNumbers(
    reports.map((r) => r.customer_po_number),
  );
  const distinctPos = combinedPo ? combinedPo.split(", ") : [];

  return {
    customer_id: first.customer_id,
    customer_name: first.customer_name,
    customer_gstin: firstGstin || null,
    combined_po_number: combinedPo,
    distinct_po_numbers: distinctPos,
    primary_job_id: first.job_id,
  };
}

/**
 * Loads a map of `report_id -> ActiveReportInvoiceLink` for all non-cancelled invoices.
 */
export async function loadActiveInvoiceReportMap(
  supabase: AppSupabase,
): Promise<Map<string, ActiveReportInvoiceLink>> {
  const map = new Map<string, ActiveReportInvoiceLink>();

  const [{ data: joinRows }, { data: directRows }] = await Promise.all([
    supabase
      .from("invoice_reports")
      .select("report_id, invoice_id, invoices!inner(id, invoice_no, number, status, kind)"),
    supabase
      .from("invoices")
      .select("id, report_id, invoice_no, number, status, kind")
      .neq("status", "cancelled")
      .not("report_id", "is", null),
  ]);

  for (const row of joinRows ?? []) {
    const inv = row.invoices as unknown as {
      id: string;
      invoice_no: string | null;
      number: string | null;
      status: string;
      kind: Enums<"invoice_kind">;
    } | null;
    if (!inv || inv.status === "cancelled") continue;
    const prev = map.get(row.report_id);
    if (prev && prev.kind === "tax_invoice" && inv.kind === "proforma") continue;
    map.set(row.report_id, {
      invoice_id: inv.id,
      invoice_no: inv.invoice_no ?? inv.number ?? (inv.kind === "proforma" ? "Draft Proforma" : "Draft"),
      status: inv.status,
      kind: inv.kind,
    });
  }

  for (const inv of directRows ?? []) {
    if (!inv.report_id || inv.status === "cancelled") continue;
    const prev = map.get(inv.report_id);
    if (!prev || (prev.kind === "proforma" && inv.kind === "tax_invoice")) {
      map.set(inv.report_id, {
        invoice_id: inv.id,
        invoice_no: inv.invoice_no ?? inv.number ?? (inv.kind === "proforma" ? "Draft Proforma" : "Draft"),
        status: inv.status,
        kind: inv.kind,
      });
    }
  }

  return map;
}

/**
 * Lists all approved reports that are currently "Invoice pending" (not on any non-cancelled invoice).
 */
export async function listInvoicePendingReports(
  supabase: AppSupabase,
): Promise<ReportInvoiceCandidate[]> {
  const [reportsRes, activeMap] = await Promise.all([
    supabase
      .from("reports")
      .select(
        "id, report_no, report_date, method, status, approved_at, content, job_id, jobs!inner(id, job_no, customer_id, po_number, po_value, deleted_at, customers!inner(id, name, gstin, billing_address, payment_terms_days))",
      )
      .in("status", ["approved", "sent"])
      .order("approved_at", { ascending: false }),
    loadActiveInvoiceReportMap(supabase),
  ]);

  if (reportsRes.error) {
    throw new Error(reportsRes.error.message);
  }

  const pending: ReportInvoiceCandidate[] = [];
  for (const r of reportsRes.data ?? []) {
    if (!isReportInvoicePending(r, activeMap)) continue;
    const job = r.jobs as unknown as {
      id: string;
      job_no: string;
      customer_id: string;
      po_number: string | null;
      po_value: number | null;
      deleted_at: string | null;
      customers: {
        id: string;
        name: string;
        gstin: string | null;
        billing_address: string | null;
        payment_terms_days: number;
      };
    };
    if (!job || job.deleted_at) continue;
    pending.push({
      id: r.id,
      report_no: r.report_no,
      report_date: r.report_date,
      method: r.method,
      status: r.status,
      approved_at: r.approved_at,
      content: r.content,
      job_id: job.id,
      job_no: job.job_no,
      customer_id: job.customer_id,
      customer_name: job.customers?.name ?? "Customer",
      customer_gstin: job.customers?.gstin ?? null,
      customer_billing_address: job.customers?.billing_address ?? null,
      customer_po_number: job.po_number ?? null,
      po_value: job.po_value !== null && job.po_value !== undefined ? Number(job.po_value) : null,
      payment_terms_days: job.customers?.payment_terms_days ?? 30,
    });
  }

  return pending;
}

/**
 * Creates a draft invoice covering one or more approved reports of the same customer GSTIN.
 */
export async function createDraftInvoiceFromReports(
  supabase: AppSupabase,
  input: CreateInvoiceFromReportsInput,
): Promise<{
  invoice_id: string;
  created: boolean;
  report_ids: string[];
  combined_po_number: string | null;
}> {
  const uniqueReportIds = Array.from(new Set(input.report_ids));

  const [reportsRes, activeMap, priceItemsRes] = await Promise.all([
    supabase
      .from("reports")
      .select(
        "id, report_no, report_date, method, status, approved_at, content, job_id, jobs!inner(id, job_no, customer_id, po_number, po_value, quotation_id, customers!inner(id, name, gstin, billing_address, payment_terms_days))",
      )
      .in("id", uniqueReportIds),
    loadActiveInvoiceReportMap(supabase),
    listPriceItems(supabase, { activeOnly: true }),
  ]);
  const priceItems = priceItemsRes.data ?? [];

  if (reportsRes.error) {
    throw new Error(reportsRes.error.message);
  }

  const rows = reportsRes.data ?? [];
  if (rows.length !== uniqueReportIds.length) {
    throw new Error("One or more selected reports could not be found.");
  }

  // Keep the caller's order
  const byId = new Map(rows.map((r) => [r.id, r]));
  const orderedCandidates: (ReportInvoiceCandidate & { quotation_id: string | null })[] =
    uniqueReportIds.map((id) => {
      const r = byId.get(id)!;
      const job = r.jobs as unknown as {
        id: string;
        job_no: string;
        customer_id: string;
        po_number: string | null;
        po_value: number | null;
        quotation_id: string | null;
        customers: {
          id: string;
          name: string;
          gstin: string | null;
          billing_address: string | null;
          payment_terms_days: number;
        };
      };
      return {
        id: r.id,
        report_no: r.report_no,
        report_date: r.report_date,
        method: r.method,
        status: r.status,
        approved_at: r.approved_at,
        content: r.content,
        job_id: job.id,
        job_no: job.job_no,
        quotation_id: job.quotation_id ?? null,
        customer_id: job.customer_id,
        customer_name: job.customers?.name ?? "Customer",
        customer_gstin: job.customers?.gstin ?? null,
        customer_billing_address: job.customers?.billing_address ?? null,
        customer_po_number: job.po_number ?? null,
        po_value:
          job.po_value !== null && job.po_value !== undefined
            ? Number(job.po_value)
            : null,
        payment_terms_days: job.customers?.payment_terms_days ?? 30,
      };
    });

  // If a single report is requested and already has an active invoice, return it idempotently
  if (orderedCandidates.length === 1) {
    const existing = activeMap.get(orderedCandidates[0].id);
    if (existing) {
      return {
        invoice_id: existing.invoice_id,
        created: false,
        report_ids: [orderedCandidates[0].id],
        combined_po_number: orderedCandidates[0].customer_po_number,
      };
    }
  }

  // Ensure none of the selected reports is already on a live invoice
  for (const r of orderedCandidates) {
    const existing = activeMap.get(r.id);
    if (existing) {
      throw new Error(
        `Report ${r.report_no} is already on active invoice ${existing.invoice_no}. Cancel that invoice first before re-billing.`,
      );
    }
  }

  const group = validateReportsShareCustomerGstin(orderedCandidates);
  const primary = orderedCandidates[0];

  // Build initial lines from the price list across all selected reports
  const allLines: BuiltInvoiceLine[] = [];
  let pos = 1;
  for (const rep of orderedCandidates) {
    const methodLabel =
      METHOD_LABEL[rep.method as keyof typeof METHOD_LABEL] ?? rep.method;
    const built = buildDraftInvoiceLinesFromPriceList({
      priceItems,
      method: rep.method,
      reportNo: rep.report_no,
      fallbackDescription: `${methodLabel} inspection as per report ${rep.report_no} (${rep.job_no})`,
    });
    for (const line of built) {
      const descWithReport =
        orderedCandidates.length > 1 && !line.description.includes(rep.report_no)
          ? `${line.description} — Report ${rep.report_no} (${rep.job_no})`
          : line.description;
      allLines.push({
        ...line,
        position: pos++,
        description: descWithReport,
      });
    }
  }

  const gst = calculateInvoiceGst(sumTaxableValue(allLines), {
    gstin: primary.customer_gstin,
    billingAddress: primary.customer_billing_address,
  });

  const invoiceDate = todayIST();
  const dueDate = todayIST(primary.payment_terms_days ?? 30);

  const defaultNotes =
    input.notes?.trim() ||
    (orderedCandidates.length > 1
      ? `Covers approved reports: ${orderedCandidates.map((r) => `${r.report_no} (${r.job_no})`).join(", ")}.${group.combined_po_number ? ` Customer POs: ${group.combined_po_number}.` : ""}`
      : null);

  const { data: created, error: createError } = await supabase
    .from("invoices")
    .insert({
      job_id: primary.job_id,
      kind: input.kind ?? "tax_invoice",
      report_id: primary.id,
      quotation_id: primary.quotation_id,
      place_of_supply: gst.place_of_supply,
      invoice_date: invoiceDate,
      due_date: dueDate,
      customer_po_number: group.combined_po_number,
      taxable_value: gst.taxable_value,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      round_off: gst.round_off,
      total: gst.total,
      balance: gst.total,
      status: "draft",
      notes: defaultNotes,
    })
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(createError?.message ?? "Could not create draft invoice.");
  }

  // Link all selected reports in public.invoice_reports
  const joinPayload = orderedCandidates.map((r) => ({
    invoice_id: created.id,
    report_id: r.id,
  }));
  const { error: joinError } = await supabase
    .from("invoice_reports")
    .upsert(joinPayload, { onConflict: "invoice_id,report_id" });

  if (joinError) {
    // Rollback the draft invoice if linking any report fails (e.g., DB trigger violation)
    await supabase.from("invoices").delete().eq("id", created.id);
    throw new Error(joinError.message);
  }

  if (allLines.length > 0) {
    const { error: lineError } = await supabase.from("invoice_lines").insert(
      allLines.map((line) => ({
        invoice_id: created.id,
        position: line.position,
        description: line.description,
        sac: line.sac,
        qty: line.qty,
        unit: line.unit,
        rate: line.rate,
        amount: line.amount,
      })),
    );
    if (lineError) {
      throw new Error(lineError.message);
    }
  }

  return {
    invoice_id: created.id,
    created: true,
    report_ids: orderedCandidates.map((r) => r.id),
    combined_po_number: group.combined_po_number,
  };
}

/**
 * Converts a Proforma invoice (`kind = 'proforma'`) into a draft Tax Invoice (`kind = 'tax_invoice'`),
 * copying all lines and linked reports (`invoice_reports`) and recording `converted_from_id`.
 * If a non-cancelled tax invoice already exists for this proforma (or job), returns it idempotently.
 */
export async function convertProformaToTaxInvoice(
  supabase: AppSupabase,
  proformaId: string,
): Promise<{ invoice_id: string; created: boolean }> {
  const { data: proforma, error: pfErr } = await supabase
    .from("invoices")
    .select(
      "id, job_id, kind, status, report_id, quotation_id, place_of_supply, customer_po_number, taxable_value, cgst, sgst, igst, round_off, total, notes, invoice_no, number, jobs(customers(payment_terms_days))",
    )
    .eq("id", proformaId)
    .maybeSingle();

  if (pfErr || !proforma) {
    throw new Error(pfErr?.message ?? "Proforma invoice not found.");
  }
  if (proforma.kind !== "proforma") {
    throw new Error("Only a proforma invoice can be converted to a tax invoice.");
  }
  if (proforma.status === "cancelled") {
    throw new Error("Cannot convert a cancelled proforma invoice.");
  }

  // Check if a non-cancelled tax invoice was already converted from this proforma (or exists on the job)
  const { data: existingConverted } = await supabase
    .from("invoices")
    .select("id")
    .eq("converted_from_id", proforma.id)
    .neq("status", "cancelled")
    .maybeSingle();

  if (existingConverted?.id) {
    return { invoice_id: existingConverted.id, created: false };
  }

  const { data: existingJobTax } = await supabase
    .from("invoices")
    .select("id")
    .eq("job_id", proforma.job_id)
    .eq("kind", "tax_invoice")
    .neq("status", "cancelled")
    .maybeSingle();

  if (existingJobTax?.id) {
    return { invoice_id: existingJobTax.id, created: false };
  }

  const [linesRes, joinRes] = await Promise.all([
    supabase
      .from("invoice_lines")
      .select("position, description, sac, qty, unit, rate, amount")
      .eq("invoice_id", proforma.id)
      .order("position", { ascending: true }),
    supabase
      .from("invoice_reports")
      .select("report_id")
      .eq("invoice_id", proforma.id),
  ]);

  const jobCustomer = (
    proforma.jobs as unknown as { customers?: { payment_terms_days?: number } | null } | null
  )?.customers;
  const termsDays = jobCustomer?.payment_terms_days ?? 30;
  const invoiceDate = todayIST();
  const dueDate = todayIST(termsDays);
  const proformaRef = proforma.invoice_no ?? proforma.number ?? proforma.id.slice(0, 8);
  const convertedNotes = proforma.notes
    ? `${proforma.notes} (Converted from Proforma ${proformaRef})`
    : `Converted from Proforma ${proformaRef}.`;

  const { data: created, error: createErr } = await supabase
    .from("invoices")
    .insert({
      job_id: proforma.job_id,
      kind: "tax_invoice",
      converted_from_id: proforma.id,
      report_id: proforma.report_id,
      quotation_id: proforma.quotation_id,
      place_of_supply: proforma.place_of_supply,
      invoice_date: invoiceDate,
      due_date: dueDate,
      customer_po_number: proforma.customer_po_number,
      taxable_value: proforma.taxable_value,
      cgst: proforma.cgst,
      sgst: proforma.sgst,
      igst: proforma.igst,
      round_off: proforma.round_off,
      total: proforma.total,
      balance: proforma.total,
      status: "draft",
      notes: convertedNotes,
    })
    .select("id")
    .single();

  if (createErr || !created) {
    throw new Error(createErr?.message ?? "Could not create tax invoice from proforma.");
  }

  const reportIds = Array.from(
    new Set(
      [
        ...(joinRes.data ?? []).map((r) => r.report_id),
        ...(proforma.report_id ? [proforma.report_id] : []),
      ],
    ),
  );

  if (reportIds.length > 0) {
    const { error: joinError } = await supabase.from("invoice_reports").upsert(
      reportIds.map((reportId) => ({
        invoice_id: created.id,
        report_id: reportId,
      })),
      { onConflict: "invoice_id,report_id" },
    );
    if (joinError) {
      await supabase.from("invoices").delete().eq("id", created.id);
      throw new Error(joinError.message);
    }
  }

  const lines = linesRes.data ?? [];
  if (lines.length > 0) {
    const { error: lineError } = await supabase.from("invoice_lines").insert(
      lines.map((l, idx) => ({
        invoice_id: created.id,
        position: l.position ?? idx + 1,
        description: l.description,
        sac: l.sac,
        qty: l.qty,
        unit: l.unit,
        rate: l.rate,
        amount: l.amount,
      })),
    );
    if (lineError) {
      throw new Error(lineError.message);
    }
  }

  return { invoice_id: created.id, created: true };
}

/**
 * Records a payment (including optional TDS deducted) against an issued invoice.
 * The database trigger verifies (amount + tds_amount) <= balance and updates the invoice balance and status.
 */
export async function recordInvoicePayment(
  supabase: AppSupabase,
  invoiceId: string,
  input: RecordPaymentInput,
) {
  const { data, error } = await supabase
    .from("payments")
    .insert({
      invoice_id: invoiceId,
      amount: input.amount,
      tds_amount: input.tds_amount,
      paid_on: input.paid_on,
      mode: input.mode,
      reference: input.reference,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not record payment.");
  }
  return data;
}

/**
 * Creates (and optionally issues with BITA/YY-YY/CN-0001 number) a credit note against an issued tax invoice.
 * Automatically calculates CGST/SGST or IGST matching the invoice's place of supply.
 */
export async function createCreditNoteForInvoice(
  supabase: AppSupabase,
  input: CreateCreditNoteInput,
) {
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select(
      "id, kind, status, balance, place_of_supply, jobs(customers(gstin, billing_address))",
    )
    .eq("id", input.invoice_id)
    .maybeSingle();

  if (invErr || !invoice) {
    throw new Error(invErr?.message ?? "Target invoice not found.");
  }
  if (invoice.kind !== "tax_invoice") {
    throw new Error("Credit notes can only be issued against a tax invoice.");
  }
  if (invoice.status === "draft" || invoice.status === "cancelled") {
    throw new Error("Credit notes can only be created against an issued tax invoice.");
  }

  const customer = (
    invoice.jobs as unknown as {
      customers?: { gstin: string | null; billing_address: string | null } | null;
    } | null
  )?.customers;

  const gst = calculateInvoiceGst(input.taxable_value, {
    gstin: customer?.gstin,
    billingAddress: customer?.billing_address,
    placeOfSupply: invoice.place_of_supply,
  });

  const { data, error } = await supabase
    .from("credit_notes")
    .insert({
      invoice_id: invoice.id,
      credit_date: input.credit_date,
      reason: input.reason,
      taxable_value: gst.taxable_value,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      round_off: gst.round_off,
      total: gst.total,
      status: input.issue_immediately ? "issued" : "draft",
      notes: input.notes,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create credit note.");
  }
  return data;
}

/**
 * Cancels a credit note (restoring its amount to the linked invoice's balance).
 */
export async function cancelCreditNoteById(
  supabase: AppSupabase,
  creditNoteId: string,
) {
  const { data, error } = await supabase
    .from("credit_notes")
    .update({ status: "cancelled" })
    .eq("id", creditNoteId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not cancel credit note.");
  }
  return data;
}
