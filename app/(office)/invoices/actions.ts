"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import type { Database } from "@/lib/db/types";
import { text as str } from "@/lib/forms";
import type { ReportReadings } from "@/lib/reports/fields";
import {
  calculateInvoiceGst,
  computeLineAmount,
  roundPaise,
  sumTaxableValue,
} from "@/lib/invoices";
import {
  buildDraftInvoiceLinesFromPriceList,
  listPriceItems,
} from "@/lib/modules/price-items/service";
import {
  cancelCreditNoteById,
  convertProformaToTaxInvoice,
  createCreditNoteForInvoice,
  createDraftInvoiceFromReports,
  recordInvoicePayment,
} from "@/lib/modules/invoices/service";
import { recordMultiJobPaymentReceipt } from "@/lib/modules/invoices/payments-received";
import { loadBookedJobEquipmentForReport } from "@/lib/modules/reports/service";
import { buildJobReportPrefill, loadReportLookups, mergePrefill } from "@/lib/modules/reports/prefill";
import {
  parseCreateCreditNoteInput,
  parseRecordPaymentInput,
} from "@/lib/modules/invoices/schema";
import {
  buildReportContent,
  extractReadings,
  prefillReadingsFromBookedEquipment,
  validUuid,
} from "@/lib/reports/review";
import { homeFor } from "@/lib/roles";
import {
  invoiceLinesTable,
  invoicesTable,
  type InvoiceLineRow,
  type InvoiceRow,
} from "./db";

function errUrl(path: string, message: string): string {
  return `${path}?error=${encodeURIComponent(message)}`;
}

async function requireBillingStaff() {
  const ctx = await requireStaff();
  const isAllowed = ctx.person?.roles.some((r) => r === "management" || r === "office");
  if (!isAllowed) {
    redirect(homeFor(ctx.person?.roles));
  }
  return ctx;
}

async function createDraftInvoiceForJobAndReport(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  jobId: string,
  preferredReportId?: string | null,
  preferredKind?: "proforma" | "tax_invoice" | null,
): Promise<{ id?: string; error?: string }> {
  // 1. Load job + customer + quotation items
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, job_no, customer_id, enquiry_id, quotation_id, po_number, po_date, po_value, scope, test_methods, customers(id, name, gstin, billing_address, payment_terms_days, uses_proforma), quotations(id, ref_no, quotation_items(position, description, basis, rate, minimum_charge))",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !job) {
    return { error: jobErr?.message ?? "Job not found." };
  }

  const targetKind: "proforma" | "tax_invoice" =
    preferredKind === "proforma" || preferredKind === "tax_invoice"
      ? preferredKind
      : job.customers?.uses_proforma
        ? "proforma"
        : "tax_invoice";

  // 2. Check if an active invoice of this kind already exists for this job
  const { data: existingList } = (await invoicesTable(supabase)
    .select("id, status, kind")
    .eq("job_id", jobId)
    .eq("kind", targetKind)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)) as { data: Array<{ id: string; status: string; kind: string }> | null };

  const existing = existingList?.[0] ?? null;
  if (existing?.id) {
    return { id: existing.id };
  }

  // 3. Load approved reports (preferredReportId if given, otherwise all approved reports on the job)
  let reportQuery = supabase
    .from("reports")
    .select("id, job_id, inspection_id, report_no, method, status, approved_at, content")
    .eq("job_id", jobId);

  if (preferredReportId) {
    reportQuery = reportQuery.eq("id", preferredReportId);
  } else {
    reportQuery = reportQuery
      .or("approved_at.not.is.null,status.in.(approved,sent)")
      .order("approved_at", { ascending: false });
  }

  const { data: reports } = await reportQuery;
  const approvedReports = (reports ?? []).filter(
    (r) => Boolean(r.approved_at) || r.status === "approved" || r.status === "sent",
  );
  const report = approvedReports[0] ?? null;

  if (preferredReportId && !report) {
    return { error: "Report must be approved by a technical reviewer before generating an invoice." };
  }

  // 4. Fill initial draft line from the price list (or fallback to quotation items / PO value if price list rate is 0)
  const quotationId = job.quotation_id;
  const { data: priceItems } = await listPriceItems(supabase, { activeOnly: true });
  let builtLines = buildDraftInvoiceLinesFromPriceList({
    priceItems,
    method: report?.method ?? job.test_methods?.[0] ?? null,
    reportNo: report?.report_no ?? null,
    fallbackDescription:
      job.scope || (report ? `${report.method} Inspection (${report.report_no})` : `Inspection services (${job.job_no})`),
  });

  const quotationObj = job.quotations as unknown as {
    id: string;
    ref_no: string | null;
    quotation_items?: Array<{
      position: number;
      description: string;
      basis: string | null;
      rate: number | null;
      minimum_charge: number | null;
    }>;
  } | null;

  if (
    sumTaxableValue(builtLines) === 0 &&
    quotationObj?.quotation_items &&
    quotationObj.quotation_items.some((qi) => (Number(qi.rate) || 0) > 0)
  ) {
    const defaultSac = priceItems[0]?.sac ?? "998393";
    builtLines = quotationObj.quotation_items
      .filter((qi) => qi.description?.trim())
      .map((qi, idx) => {
        const rate = roundPaise(Number(qi.rate) || 0);
        const minCharge = qi.minimum_charge ? Number(qi.minimum_charge) : null;
        const calc = computeLineAmount(1, rate, minCharge);
        return {
          position: idx + 1,
          description: qi.description.trim(),
          sac: defaultSac,
          qty: calc.qty,
          unit: qi.basis?.trim() || "nos",
          rate: calc.rate,
          amount: calc.amount,
          minimum_charge: calc.minimum_charge,
          minimum_charge_applied: calc.minimum_charge_applied,
        };
      });
  }

  const taxableValue = sumTaxableValue(builtLines);
  const customer = job.customers;
  const gst = calculateInvoiceGst(taxableValue, {
    gstin: customer?.gstin,
    billingAddress: customer?.billing_address,
  });

  const invoiceDate = todayIST();
  const dueDate = todayIST(customer?.payment_terms_days ?? 30);

  const { data: created, error: createErr } = (await invoicesTable(supabase)
    .insert({
      job_id: job.id,
      kind: targetKind,
      report_id: report?.id ?? null,
      quotation_id: quotationId,
      place_of_supply: gst.place_of_supply,
      invoice_date: invoiceDate,
      due_date: dueDate,
      customer_po_number: job.po_number,
      taxable_value: gst.taxable_value,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      round_off: gst.round_off,
      total: gst.total,
      balance: gst.total,
      status: "draft",
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (createErr || !created) {
    return { error: createErr?.message ?? "Failed to create draft invoice." };
  }

  if (approvedReports.length > 0) {
    await supabase
      .from("invoice_reports")
      .upsert(
        approvedReports.map((r) => ({
          invoice_id: created.id,
          report_id: r.id,
        })),
        { onConflict: "invoice_id,report_id" },
      );
  }

  const linePayloads = builtLines.map((line, index) => ({
    invoice_id: created.id,
    position: index + 1,
    description: line.description,
    sac: line.sac,
    qty: line.qty,
    unit: line.unit,
    rate: line.rate,
    amount: line.amount,
  }));

  if (linePayloads.length > 0) {
    const { error: lineErr } = await invoiceLinesTable(supabase).insert(linePayloads);
    if (lineErr) {
      return { error: lineErr.message };
    }
  }

  revalidatePath("/invoices");
  revalidatePath(`/jobs/${job.id}`);
  if (report?.id) revalidatePath(`/review/${report.id}`);

  return { id: created.id };
}

export async function generateInvoiceFromReport(reportId: string, formData?: FormData) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase } = await requireBillingStaff();

  const kindRaw = formData ? str(formData, "kind") : null;
  const kind = kindRaw === "proforma" ? "proforma" : "tax_invoice";

  let invoiceId: string;
  try {
    const res = await createDraftInvoiceFromReports(supabase, {
      report_ids: [reportId],
      kind,
    });
    invoiceId = res.invoice_id;
  } catch (err) {
    redirect(
      errUrl(
        `/review/${reportId}`,
        err instanceof Error ? err.message : "Could not generate invoice.",
      ),
    );
  }

  revalidatePath("/invoices");
  revalidatePath("/review");
  revalidatePath(`/review/${reportId}`);
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function convertProformaAction(proformaId: string) {
  if (!validUuid(proformaId)) redirect("/invoices");
  const { supabase } = await requireBillingStaff();

  let taxInvoiceId: string;
  try {
    const res = await convertProformaToTaxInvoice(supabase, proformaId);
    taxInvoiceId = res.invoice_id;
  } catch (err) {
    redirect(
      errUrl(
        `/invoices/${proformaId}`,
        err instanceof Error ? err.message : "Could not convert proforma to tax invoice.",
      ),
    );
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${proformaId}`);
  revalidatePath(`/invoices/${taxInvoiceId}`);
  revalidatePath("/review");
  redirect(`/invoices/${taxInvoiceId}?saved=1`);
}

export async function generateInvoiceFromSelectedReports(formData: FormData) {
  const { supabase } = await requireBillingStaff();
  const returnTo = str(formData, "return_to") ?? "/invoices";
  const rawIds = formData
    .getAll("report_ids")
    .map((v) => String(v ?? "").trim())
    .filter((v) => validUuid(v));

  if (rawIds.length === 0) {
    redirect(errUrl(returnTo, "Select at least one Invoice pending report."));
  }

  const kindRaw = str(formData, "kind");
  const kind = kindRaw === "proforma" ? "proforma" : "tax_invoice";

  let invoiceId: string;
  try {
    const res = await createDraftInvoiceFromReports(supabase, {
      report_ids: rawIds,
      kind,
    });
    invoiceId = res.invoice_id;
  } catch (err) {
    redirect(
      errUrl(
        returnTo,
        err instanceof Error ? err.message : "Could not prepare draft invoice.",
      ),
    );
  }

  revalidatePath("/invoices");
  revalidatePath("/review");
  revalidatePath("/dashboard");
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function generateInvoiceFromJob(jobId: string, formData?: FormData) {
  if (!validUuid(jobId)) redirect("/jobs");
  const { supabase } = await requireBillingStaff();

  const kindRaw = formData ? str(formData, "kind") : null;
  const preferredKind: "proforma" | "tax_invoice" | null =
    kindRaw === "proforma" || kindRaw === "tax_invoice" ? kindRaw : null;

  const res = await createDraftInvoiceForJobAndReport(supabase, jobId, null, preferredKind);
  if (res.error || !res.id) {
    redirect(errUrl(`/jobs/${jobId}`, res.error ?? "Could not generate invoice."));
  }

  redirect(`/invoices/${res.id}?saved=1`);
}

export async function generateInvoiceForSelectedJob(formData: FormData) {
  const { supabase } = await requireBillingStaff();
  const returnTo = str(formData, "return_to") ?? "/invoices";
  const jobId = str(formData, "job_id") ?? "";
  if (!validUuid(jobId)) {
    redirect(errUrl(returnTo, "Select a job to generate an invoice."));
  }

  const kindRaw = str(formData, "kind");
  const preferredKind: "proforma" | "tax_invoice" | null =
    kindRaw === "proforma" || kindRaw === "tax_invoice" ? kindRaw : null;

  const res = await createDraftInvoiceForJobAndReport(supabase, jobId, null, preferredKind);
  if (res.error || !res.id) {
    redirect(errUrl(returnTo, res.error ?? "Could not generate invoice."));
  }

  redirect(`/invoices/${res.id}?saved=1`);
}

export async function generateReportFromJob(jobId: string, formData?: FormData) {
  if (!validUuid(jobId)) redirect("/jobs");
  const { supabase, person } = await requireStaff();
  if (!person) redirect("/login");

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, job_no, site, scope, test_methods, customers(name), reports(id, report_no, method), inspections(id, method, readings, observations, submitted_at, missing_fields)",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (!job) {
    redirect(errUrl("/jobs", "Job not found."));
  }

  const requestedMethodRaw = formData ? str(formData, "method") : null;
  const method = (requestedMethodRaw || job.test_methods?.[0] || "UT") as Database["public"]["Enums"]["test_method"];

  const existingReports = (job.reports ?? []) as Array<{
    id: string;
    report_no: string;
    method: string;
  }>;

  // If a report already exists for this method and no custom report_no was entered, open it
  const typedReportNo = formData ? str(formData, "report_no")?.trim() : null;
  if (!typedReportNo) {
    const existingForMethod = existingReports.find((r) => r.method === method) ?? existingReports[0];
    if (existingForMethod) {
      redirect(`/review/${existingForMethod.id}`);
    }
  }

  const nextIndex = existingReports.length + 1;
  const defaultReportNo =
    nextIndex === 1
      ? `${job.job_no}/R-01`
      : `${job.job_no}/R-${String(nextIndex).padStart(2, "0")}`;
  const reportNo = typedReportNo || defaultReportNo;
  const reportDate = (formData ? str(formData, "report_date") : null) || todayIST();

  const inspections = (job.inspections ?? []) as Array<{
    id: string;
    method: string;
    readings: Database["public"]["Tables"]["inspections"]["Row"]["readings"];
    observations: string | null;
    submitted_at: string | null;
    missing_fields: string[];
  }>;

  const readyInspection =
    inspections.find(
      (i) => i.method === method && i.submitted_at && (i.missing_fields?.length ?? 0) === 0,
    ) ?? null;

  const bookedEquipment = await loadBookedJobEquipmentForReport(supabase, job.id);
  const custName = (job.customers as unknown as { name?: string } | null)?.name ?? "";
  const baseReadings: ReportReadings = readyInspection
    ? extractReadings(readyInspection.readings)
    : {
        client: custName,
        inspection_site: job.site ?? "",
        inspection_date: reportDate,
      };

  // Same autofill as every other way of creating a report: technicians with certificates,
  // equipment with serial and calibration, and the customer's last settings. Blanks only.
  const [jobPrefill, lookups] = await Promise.all([
    buildJobReportPrefill(supabase, job.id, method),
    loadReportLookups(supabase, method),
  ]);
  const prefilledReadings = mergePrefill(
    prefillReadingsFromBookedEquipment(baseReadings, bookedEquipment),
    jobPrefill,
    lookups.technicians,
  );
  const content = buildReportContent(
    prefilledReadings,
    readyInspection?.observations ?? job.scope ?? null,
    readyInspection?.submitted_at ?? null,
  );

  const { data: created, error: insertErr } = await supabase
    .from("reports")
    .insert({
      job_id: job.id,
      inspection_id: readyInspection?.id ?? null,
      method,
      report_no: reportNo,
      report_date: reportDate,
      content,
      status: "draft",
      prepared_by: person.id,
    })
    .select("id")
    .single();

  if (insertErr || !created) {
    redirect(
      errUrl(
        `/jobs/${job.id}`,
        insertErr?.message ?? "Could not create report for this job.",
      ),
    );
  }

  revalidatePath(`/jobs/${job.id}`);
  revalidatePath("/review");
  redirect(`/review/${created.id}?saved=1`);
}

export async function updateDraftInvoice(invoiceId: string, formData: FormData) {
  if (!validUuid(invoiceId)) redirect("/invoices");
  const { supabase } = await requireBillingStaff();

  const { data: invoice } = (await invoicesTable(supabase)
    .select("id, job_id, status, jobs(id, status, customers(gstin, billing_address))")
    .eq("id", invoiceId)
    .maybeSingle()) as {
    data: {
      id: string;
      job_id: string;
      status: string;
      jobs?: {
        id: string;
        status: string;
        customers?: { gstin: string | null; billing_address: string | null } | null;
      } | null;
    } | null;
  };

  if (!invoice) redirect("/invoices");
  if (invoice.status !== "draft") {
    redirect(errUrl(`/invoices/${invoiceId}`, "Issued or cancelled invoices cannot be edited."));
  }

  const intent = str(formData, "intent");
  const shouldIssueNow = intent === "save_and_issue";

  const invoiceDate = str(formData, "invoice_date") ?? todayIST();
  const dueDate = str(formData, "due_date");
  const placeOfSupplyInput = str(formData, "place_of_supply");
  const customerPoNumber = str(formData, "customer_po_number");
  const notes = str(formData, "notes");
  const defaultSac = str(formData, "default_sac") ?? "";

  const descriptions = formData.getAll("line_description").map((v) => String(v ?? "").trim());
  const sacs = formData.getAll("line_sac").map((v) => String(v ?? "").trim());
  const qtys = formData.getAll("line_qty").map((v) => Number(v));
  const units = formData.getAll("line_unit").map((v) => String(v ?? "").trim());
  const rates = formData.getAll("line_rate").map((v) => Number(v));
  const minCharges = formData.getAll("line_min_charge").map((v) => String(v ?? "").trim());

  const newLines: Array<{
    invoice_id: string;
    position: number;
    description: string;
    sac: string;
    qty: number;
    unit: string | null;
    rate: number;
    amount: number;
  }> = [];

  for (let i = 0; i < descriptions.length; i++) {
    const desc = descriptions[i];
    if (!desc) continue;
    const qty = Number.isFinite(qtys[i]) && qtys[i] > 0 ? qtys[i] : 1;
    const rate = Number.isFinite(rates[i]) && rates[i] >= 0 ? roundPaise(rates[i]) : 0;
    const minCharge = minCharges[i] ? Number(minCharges[i]) : null;
    const calc = computeLineAmount(qty, rate, minCharge);

    newLines.push({
      invoice_id: invoiceId,
      position: newLines.length + 1,
      description: desc,
      sac: sacs[i] || defaultSac,
      qty: calc.qty,
      unit: units[i] || "nos",
      rate: calc.rate,
      amount: calc.amount,
    });
  }

  if (newLines.length === 0) {
    redirect(errUrl(`/invoices/${invoiceId}`, "An invoice must have at least one line item."));
  }

  const taxableValue = sumTaxableValue(newLines);
  const customer = invoice.jobs?.customers;
  const gst = calculateInvoiceGst(taxableValue, {
    placeOfSupply: placeOfSupplyInput,
    gstin: customer?.gstin,
    billingAddress: customer?.billing_address,
  });

  // Replace lines
  const { error: delErr } = await invoiceLinesTable(supabase).delete().eq("invoice_id", invoiceId);
  if (delErr) {
    redirect(errUrl(`/invoices/${invoiceId}`, delErr.message));
  }

  const { error: insErr } = await invoiceLinesTable(supabase).insert(newLines);
  if (insErr) {
    redirect(errUrl(`/invoices/${invoiceId}`, insErr.message));
  }

  const { error: updErr } = await invoicesTable(supabase)
    .update({
      invoice_date: invoiceDate,
      due_date: dueDate,
      place_of_supply: gst.place_of_supply,
      customer_po_number: customerPoNumber,
      notes,
      taxable_value: gst.taxable_value,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      round_off: gst.round_off,
      total: gst.total,
      balance: gst.total,
      ...(shouldIssueNow ? { status: "issued" } : {}),
    })
    .eq("id", invoiceId);

  if (updErr) {
    redirect(errUrl(`/invoices/${invoiceId}`, updErr.message));
  }

  if (shouldIssueNow && invoice.jobs && invoice.jobs.status !== "closed" && invoice.jobs.status !== "invoiced") {
    await supabase.from("jobs").update({ status: "invoiced" }).eq("id", invoice.job_id);
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/jobs/${invoice.job_id}`);
  revalidatePath("/dashboard");
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function issueInvoice(invoiceId: string) {
  if (!validUuid(invoiceId)) redirect("/invoices");
  const { supabase } = await requireBillingStaff();

  const { data: invoice } = (await invoicesTable(supabase)
    .select("*, jobs(id, status, customers(gstin, billing_address, payment_terms_days))")
    .eq("id", invoiceId)
    .maybeSingle()) as {
    data:
      | (InvoiceRow & {
          jobs?: {
            id: string;
            status: string;
            customers?: { gstin: string | null; billing_address: string | null; payment_terms_days: number } | null;
          } | null;
        })
      | null;
  };

  if (!invoice) redirect("/invoices");
  if (invoice.status !== "draft") {
    redirect(errUrl(`/invoices/${invoiceId}`, "This invoice has already been issued or cancelled."));
  }

  const { data: lines } = (await invoiceLinesTable(supabase)
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("position", { ascending: true })) as { data: InvoiceLineRow[] | null };

  const lineList = lines ?? [];
  if (lineList.length === 0) {
    redirect(errUrl(`/invoices/${invoiceId}`, "Add at least one line item before issuing the invoice."));
  }

  const taxableValue = sumTaxableValue(lineList);
  const customer = invoice.jobs?.customers;
  const gst = calculateInvoiceGst(taxableValue, {
    placeOfSupply: invoice.place_of_supply,
    gstin: customer?.gstin,
    billingAddress: customer?.billing_address,
  });

  const { error: issueErr } = await invoicesTable(supabase)
    .update({
      place_of_supply: gst.place_of_supply,
      taxable_value: gst.taxable_value,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      round_off: gst.round_off,
      total: gst.total,
      status: "issued",
    })
    .eq("id", invoiceId);

  if (issueErr) {
    redirect(errUrl(`/invoices/${invoiceId}`, issueErr.message));
  }

  // Advance job status to 'invoiced' unless already closed
  if (invoice.jobs && invoice.jobs.status !== "closed" && invoice.jobs.status !== "invoiced") {
    await supabase.from("jobs").update({ status: "invoiced" }).eq("id", invoice.job_id);
  }

  try {
    const { broadcastTelegramNotification } = await import("@/lib/modules/telegram/service");
    await broadcastTelegramNotification(
      supabase,
      "invoice",
      `🧾 *Invoice Issued*\n• *Amount:* ₹${Math.round(gst.total).toLocaleString("en-IN")}\n• *Status:* Issued`,
    );
  } catch {
    // Non-blocking
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/jobs/${invoice.job_id}`);
  revalidatePath("/dashboard");
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function cancelInvoice(invoiceId: string) {
  if (!validUuid(invoiceId)) redirect("/invoices");
  const { supabase } = await requireBillingStaff();

  const { data: invoice } = (await invoicesTable(supabase)
    .select("id, job_id, status")
    .eq("id", invoiceId)
    .maybeSingle()) as { data: { id: string; job_id: string; status: string } | null };

  if (!invoice) redirect("/invoices");
  if (invoice.status === "cancelled") {
    redirect(`/invoices/${invoiceId}`);
  }

  const { error } = await invoicesTable(supabase)
    .update({ status: "cancelled" })
    .eq("id", invoiceId);

  if (error) {
    redirect(errUrl(`/invoices/${invoiceId}`, error.message));
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/jobs/${invoice.job_id}`);
  revalidatePath("/dashboard");
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function recordPayment(invoiceId: string, formData: FormData) {
  if (!validUuid(invoiceId)) redirect("/invoices");
  const { supabase } = await requireBillingStaff();

  const parsed = parseRecordPaymentInput(
    {
      amount: formData.get("amount"),
      tds_amount: formData.get("tds_amount"),
      paid_on: str(formData, "paid_on"),
      mode: str(formData, "mode"),
      reference: str(formData, "reference"),
    },
    todayIST(),
  );

  if (!parsed.ok) {
    redirect(errUrl(`/invoices/${invoiceId}`, parsed.error));
  }

  try {
    await recordInvoicePayment(supabase, invoiceId, parsed.value);
  } catch (err) {
    redirect(
      errUrl(
        `/invoices/${invoiceId}`,
        err instanceof Error ? err.message : "Could not record payment.",
      ),
    );
  }

  try {
    const { broadcastTelegramNotification } = await import("@/lib/modules/telegram/service");
    await broadcastTelegramNotification(
      supabase,
      "payment",
      `💰 *Payment Recorded*\n• *Received:* ₹${Math.round(parsed.value.amount).toLocaleString("en-IN")}${
        parsed.value.tds_amount ? ` (+ ₹${Math.round(parsed.value.tds_amount).toLocaleString("en-IN")} TDS)` : ""
      }\n• *Mode:* ${parsed.value.mode ?? "bank_transfer"}`,
    );
  } catch {
    // Non-blocking
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/dashboard");
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function issueCreditNoteAction(invoiceId: string, formData: FormData) {
  if (!validUuid(invoiceId)) redirect("/invoices");
  const { supabase } = await requireBillingStaff();

  const parsed = parseCreateCreditNoteInput(
    {
      invoice_id: invoiceId,
      reason: str(formData, "reason"),
      taxable_value: formData.get("taxable_value"),
      credit_date: str(formData, "credit_date"),
      notes: str(formData, "notes"),
      issue_immediately: true,
    },
    todayIST(),
  );

  if (!parsed.ok) {
    redirect(errUrl(`/invoices/${invoiceId}`, parsed.error));
  }

  try {
    await createCreditNoteForInvoice(supabase, parsed.value);
  } catch (err) {
    redirect(
      errUrl(
        `/invoices/${invoiceId}`,
        err instanceof Error ? err.message : "Could not issue credit note.",
      ),
    );
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/dashboard");
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function cancelCreditNoteAction(invoiceId: string, creditNoteId: string) {
  if (!validUuid(invoiceId) || !validUuid(creditNoteId)) redirect("/invoices");
  const { supabase } = await requireBillingStaff();

  try {
    await cancelCreditNoteById(supabase, creditNoteId);
  } catch (err) {
    redirect(
      errUrl(
        `/invoices/${invoiceId}`,
        err instanceof Error ? err.message : "Could not cancel credit note.",
      ),
    );
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/dashboard");
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function toggleInvoiceReminders(invoiceId: string, pause: boolean) {
  if (!validUuid(invoiceId)) redirect("/invoices");
  const { supabase } = await requireBillingStaff();

  const { error } = await invoicesTable(supabase)
    .update({ reminders_paused: pause })
    .eq("id", invoiceId);

  if (error) {
    redirect(errUrl(`/invoices/${invoiceId}`, error.message));
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function recordMultiJobPaymentAction(formData: FormData) {
  const { supabase, person } = await requireBillingStaff();
  const returnTo = str(formData, "return_to") ?? "/invoices";

  const jobIds = formData
    .getAll("job_ids")
    .map((v) => String(v ?? "").trim())
    .filter((v) => validUuid(v));

  if (jobIds.length === 0) {
    redirect(errUrl(returnTo, "Tick at least one Job ID checkbox to mark as paid."));
  }

  const receivedOn = str(formData, "received_on") ?? todayIST();
  const amountRaw = str(formData, "amount");
  const amountNum = amountRaw && amountRaw.trim() !== "" ? Number(amountRaw) : null;
  const mode = str(formData, "mode") ?? "NEFT";
  const reference = str(formData, "reference");
  const customerId = str(formData, "customer_id");
  const notes = str(formData, "notes");

  const tdsByJobId: Record<string, number> = {};
  for (const jobId of jobIds) {
    const rawTds = str(formData, `tds_${jobId}`);
    if (rawTds && Number.isFinite(Number(rawTds)) && Number(rawTds) > 0) {
      tdsByJobId[jobId] = Number(rawTds);
    }
  }

  let advicePath: string | null = null;
  const adviceFile = formData.get("advice_file");
  if (adviceFile instanceof File && adviceFile.size > 0) {
    const safeName = adviceFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `payment-advice/${Date.now()}-${safeName}`;
    const bytes = Buffer.from(await adviceFile.arrayBuffer());
    const { error: uploadErr } = await supabase.storage
      .from("documents")
      .upload(storagePath, bytes, {
        contentType: adviceFile.type || "application/octet-stream",
        upsert: true,
      });
    if (!uploadErr) {
      advicePath = storagePath;
    }
  }

  try {
    await recordMultiJobPaymentReceipt(supabase, {
      job_ids: jobIds,
      customer_id: customerId && validUuid(customerId) ? customerId : null,
      received_on: receivedOn,
      amount: amountNum,
      mode,
      reference,
      advice_path: advicePath,
      tds_by_job_id: tdsByJobId,
      notes,
      created_by: person?.id ?? null,
    });
  } catch (err) {
    redirect(
      errUrl(
        returnTo,
        err instanceof Error ? err.message : "Could not record payment receipt.",
      ),
    );
  }

  revalidatePath("/invoices");
  revalidatePath("/jobs");
  revalidatePath("/finance");
  revalidatePath("/dashboard");
  for (const jobId of jobIds) {
    revalidatePath(`/jobs/${jobId}`);
  }
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}saved=1`);
}
