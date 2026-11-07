"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { text as str } from "@/lib/forms";
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
import { createDraftInvoiceFromReports } from "@/lib/modules/invoices/service";
import { validUuid } from "@/lib/reports/review";
import { homeFor } from "@/lib/roles";
import {
  invoiceLinesTable,
  invoicesTable,
  paymentsTable,
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
): Promise<{ id?: string; error?: string }> {
  // 1. Check if an active tax_invoice already exists for this job
  const { data: existing } = (await invoicesTable(supabase)
    .select("id, status")
    .eq("job_id", jobId)
    .eq("kind", "tax_invoice")
    .neq("status", "cancelled")
    .maybeSingle()) as { data: { id: string; status: string } | null };

  if (existing?.id) {
    return { id: existing.id };
  }

  // 2. Load job + customer
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, job_no, customer_id, enquiry_id, quotation_id, po_number, po_date, scope, test_methods, customers(id, name, gstin, billing_address, payment_terms_days)",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !job) {
    return { error: jobErr?.message ?? "Job not found." };
  }

  // 3. Load approved report (preferredReportId if given, otherwise latest approved report on the job)
  let reportQuery = supabase
    .from("reports")
    .select("id, job_id, inspection_id, report_no, method, status, approved_at, content")
    .eq("job_id", jobId);

  if (preferredReportId) {
    reportQuery = reportQuery.eq("id", preferredReportId);
  } else {
    reportQuery = reportQuery.not("approved_at", "is", null).order("approved_at", { ascending: false }).limit(1);
  }

  const { data: reports } = await reportQuery;
  const report = reports?.[0] ?? null;

  if (preferredReportId && (!report || !report.approved_at)) {
    return { error: "Report must be approved by a technical reviewer before generating an invoice." };
  }

  // 4. Phase 2 (P3 / Map Change 3): Fill initial draft line from the price list (never from quotation rates).
  // The office picks services from the price list dropdown and can adjust rates per invoice.
  const quotationId = job.quotation_id;
  const { data: priceItems } = await listPriceItems(supabase, { activeOnly: true });
  const builtLines = buildDraftInvoiceLinesFromPriceList({
    priceItems,
    method: report?.method ?? job.test_methods?.[0] ?? null,
    reportNo: report?.report_no ?? null,
    fallbackDescription:
      job.scope || (report ? `${report.method} Inspection (${report.report_no})` : "NDT Inspection Services"),
  });

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
      kind: "tax_invoice",
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

export async function generateInvoiceFromReport(reportId: string) {
  if (!validUuid(reportId)) redirect("/review");
  const { supabase } = await requireBillingStaff();

  try {
    const res = await createDraftInvoiceFromReports(supabase, {
      report_ids: [reportId],
      kind: "tax_invoice",
    });
    revalidatePath("/invoices");
    revalidatePath("/review");
    revalidatePath(`/review/${reportId}`);
    redirect(`/invoices/${res.invoice_id}?saved=1`);
  } catch (err) {
    redirect(
      errUrl(
        `/review/${reportId}`,
        err instanceof Error ? err.message : "Could not generate invoice.",
      ),
    );
  }
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

export async function generateInvoiceFromJob(jobId: string) {
  if (!validUuid(jobId)) redirect("/jobs");
  const { supabase } = await requireBillingStaff();

  const res = await createDraftInvoiceForJobAndReport(supabase, jobId, null);
  if (res.error || !res.id) {
    redirect(errUrl(`/jobs/${jobId}`, res.error ?? "Could not generate invoice."));
  }

  redirect(`/invoices/${res.id}?saved=1`);
}

export async function updateDraftInvoice(invoiceId: string, formData: FormData) {
  if (!validUuid(invoiceId)) redirect("/invoices");
  const { supabase } = await requireBillingStaff();

  const { data: invoice } = (await invoicesTable(supabase)
    .select("id, job_id, status, jobs(customers(gstin, billing_address))")
    .eq("id", invoiceId)
    .maybeSingle()) as {
    data: {
      id: string;
      job_id: string;
      status: string;
      jobs?: { customers?: { gstin: string | null; billing_address: string | null } | null } | null;
    } | null;
  };

  if (!invoice) redirect("/invoices");
  if (invoice.status !== "draft") {
    redirect(errUrl(`/invoices/${invoiceId}`, "Issued or cancelled invoices cannot be edited."));
  }

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
    })
    .eq("id", invoiceId);

  if (updErr) {
    redirect(errUrl(`/invoices/${invoiceId}`, updErr.message));
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/jobs/${invoice.job_id}`);
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

  const amountRaw = Number(formData.get("amount"));
  const paidOn = str(formData, "paid_on") ?? todayIST();
  const mode = str(formData, "mode") ?? "NEFT";
  const reference = str(formData, "reference");

  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    redirect(errUrl(`/invoices/${invoiceId}`, "Enter a valid payment amount greater than zero."));
  }

  const amount = roundPaise(amountRaw);

  const { error } = await paymentsTable(supabase).insert({
    invoice_id: invoiceId,
    amount,
    paid_on: paidOn,
    mode,
    reference,
  });

  if (error) {
    redirect(errUrl(`/invoices/${invoiceId}`, error.message));
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
