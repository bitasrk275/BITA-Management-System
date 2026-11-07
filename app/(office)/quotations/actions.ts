"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { Constants, type Enums } from "@/lib/db/types";
import { friendlyError, text } from "@/lib/forms";
import { parseAcceptQuotationInput } from "@/lib/modules/po/schema";
import { acceptQuotationAndRecordPo } from "@/lib/modules/po/service";
import { DEFAULT_QUOTATION_TERMS } from "./labels";
import { buildQuotationStoragePath, validateQuotationFile } from "./upload";

type Supabase = Awaited<ReturnType<typeof requireStaff>>["supabase"];

function num(fd: FormData, name: string): number | null {
  const raw = text(fd, name);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumber(raw: FormDataEntryValue | undefined): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalText(raw: FormDataEntryValue | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function quotationFields(fd: FormData) {
  return {
    ref_no: text(fd, "ref_no"),
    customer_id: text(fd, "customer_id") ?? "",
    enquiry_id: text(fd, "enquiry_id"),
    quote_date: text(fd, "quote_date") ?? new Date().toISOString().slice(0, 10),
    attention: text(fd, "attention"),
    subject: text(fd, "subject"),
    terms: text(fd, "terms") ?? DEFAULT_QUOTATION_TERMS,
  };
}

// Stores an uploaded quotation file (PDF or Word, up to 6 MB) in the private documents bucket
// under quotations/<quotation id>/<file> and records its path in quotations.pdf_path.
async function saveQuotationFile(
  supabase: Supabase,
  quotationId: string,
  fd: FormData,
  requireFile = false,
): Promise<string | null> {
  const file = fd.get("pdf_file");
  if (!(file instanceof File) || file.size === 0) {
    return requireFile ? "Please choose a PDF or Word quotation file to upload." : null;
  }

  const check = validateQuotationFile(file);
  if (!check.ok) return check.error;

  const path = buildQuotationStoragePath(quotationId, file.name);
  const { error } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType: check.contentType, upsert: false });
  if (error) return error.message;

  const { error: updateError } = await supabase
    .from("quotations")
    .update({ pdf_path: path })
    .eq("id", quotationId);
  return updateError?.message ?? null;
}

export async function uploadQuotationFile(quotationId: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const fileError = await saveQuotationFile(supabase, quotationId, fd, true);
  if (fileError) {
    redirect(`/quotations/${quotationId}?error=` + encodeURIComponent(fileError));
  }
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${quotationId}?saved=file`);
}

export async function createQuotation(fd: FormData) {
  const { supabase } = await requireStaff();
  const fields = quotationFields(fd);
  if (!fields.customer_id) {
    redirect("/quotations/new?error=" + encodeURIComponent("Please choose a customer."));
  }

  // Validate uploaded file before creating the quotation row if a file was selected.
  const uploadedCandidate = fd.get("pdf_file");
  if (uploadedCandidate instanceof File && uploadedCandidate.size > 0) {
    const check = validateQuotationFile(uploadedCandidate);
    if (!check.ok) {
      redirect("/quotations/new?error=" + encodeURIComponent(check.error));
    }
  }

  const { data, error } = await supabase.from("quotations").insert(fields).select("id").single();
  if (error) redirect("/quotations/new?error=" + encodeURIComponent(friendlyError(error.message)));

  // Support one or more priced items entered directly on the new quotation screen.
  const descriptions = fd.getAll("item_description");
  const bases = fd.getAll("item_basis");
  const rates = fd.getAll("item_rate");
  const minCharges = fd.getAll("item_minimum_charge");
  const itemNotes = fd.getAll("item_notes");

  const itemsToInsert: Array<{
    quotation_id: string;
    position: number;
    description: string;
    basis: string | null;
    rate: number | null;
    minimum_charge: number | null;
    notes: string | null;
  }> = [];

  for (let i = 0; i < descriptions.length; i += 1) {
    const desc = parseOptionalText(descriptions[i]);
    if (!desc) continue;
    itemsToInsert.push({
      quotation_id: data.id,
      position: itemsToInsert.length + 1,
      description: desc,
      basis: parseOptionalText(bases[i]),
      rate: parseOptionalNumber(rates[i]),
      minimum_charge: parseOptionalNumber(minCharges[i]),
      notes: parseOptionalText(itemNotes[i]),
    });
  }

  if (itemsToInsert.length > 0) {
    await supabase.from("quotation_items").insert(itemsToInsert);
  }

  if (fields.enquiry_id) {
    await supabase
      .from("enquiries")
      .update({ status: "quoted" })
      .eq("id", fields.enquiry_id)
      .neq("status", "converted");
    revalidatePath(`/enquiries/${fields.enquiry_id}`);
    revalidatePath("/enquiries");
  }

  const fileError = await saveQuotationFile(supabase, data.id, fd, false);
  revalidatePath("/quotations");
  redirect(
    `/quotations/${data.id}` +
      (fileError ? "?error=" + encodeURIComponent("Quotation saved, but quotation file was not: " + fileError) : ""),
  );
}

export async function updateQuotation(id: string, fd: FormData) {
  const { supabase, person } = await requireStaff();
  const statusRaw = text(fd, "status");
  const status =
    statusRaw && (Constants.public.Enums.quotation_status as readonly string[]).includes(statusRaw)
      ? (statusRaw as Enums<"quotation_status">)
      : null;

  const { data: existing } = await supabase
    .from("quotations")
    .select("status, approved_at, approved_by")
    .eq("id", id)
    .maybeSingle();

  let approvalPatch: { approved_by?: string | null; approved_at?: string | null; superseded_by?: string | null } = {};
  if (status && ["approved", "sent", "accepted"].includes(status) && !existing?.approved_at) {
    if (!person || !person.roles.includes("management")) {
      redirect(`/quotations/${id}?error=` + encodeURIComponent("Only management can approve or send a quotation."));
    }
    approvalPatch = { approved_by: person.id, approved_at: new Date().toISOString() };
  } else if (status === "draft") {
    approvalPatch = { approved_by: null, approved_at: null, superseded_by: null };
  }

  const { error } = await supabase
    .from("quotations")
    .update({
      ...quotationFields(fd),
      ...(status ? { status } : {}),
      ...approvalPatch,
    })
    .eq("id", id);

  if (error) redirect(`/quotations/${id}?error=` + encodeURIComponent(friendlyError(error.message)));
  const fileError = await saveQuotationFile(supabase, id, fd, false);
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  redirect(
    `/quotations/${id}` +
      (fileError ? "?error=" + encodeURIComponent("Quotation file not saved: " + fileError) : "?saved=1"),
  );
}

// R10: Management approval helper.
export async function approveQuotation(id: string) {
  const { supabase, person } = await requireStaff();
  if (!person || !person.roles.includes("management")) {
    redirect(`/quotations/${id}?error=` + encodeURIComponent("Only management can approve a quotation (R10)."));
  }
  const { error } = await supabase
    .from("quotations")
    .update({
      status: "approved",
      approved_by: person.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) redirect(`/quotations/${id}?error=` + encodeURIComponent(friendlyError(error.message)));
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${id}?saved=approved`);
}

// T30: Records that BITA has sent the quotation to the customer (draft -> sent).
export async function markQuotationSent(id: string) {
  const { supabase, person } = await requireStaff();
  const { data: existing } = await supabase
    .from("quotations")
    .select("approved_at, approved_by, enquiry_id")
    .eq("id", id)
    .maybeSingle();

  let approvalPatch: { approved_by?: string; approved_at?: string } = {};
  if (!existing?.approved_at) {
    if (!person || !person.roles.includes("management")) {
      redirect(`/quotations/${id}?error=` + encodeURIComponent("Only management can mark a quotation as sent."));
    }
    approvalPatch = {
      approved_by: person.id,
      approved_at: new Date().toISOString(),
    };
  }

  const { error } = await supabase
    .from("quotations")
    .update({
      status: "sent",
      superseded_by: null,
      ...approvalPatch,
    })
    .eq("id", id);

  if (error) redirect(`/quotations/${id}?error=` + encodeURIComponent(friendlyError(error.message)));

  if (existing?.enquiry_id) {
    await supabase
      .from("enquiries")
      .update({ status: "quoted" })
      .eq("id", existing.enquiry_id)
      .neq("status", "converted");
    revalidatePath(`/enquiries/${existing.enquiry_id}`);
    revalidatePath("/enquiries");
  }

  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${id}?saved=sent`);
}

// T30 + P2: Records that the customer accepted the quotation (sent -> accepted),
// optionally records the Customer PO (PO number, PO date, PO value, PO file) and creates the linked job in one step.
export async function acceptQuotation(id: string, fd?: FormData) {
  const { supabase, person } = await requireStaff();
  if (!person) {
    redirect(`/quotations/${id}?error=` + encodeURIComponent("You must be signed in."));
  }

  const parsed = parseAcceptQuotationInput(fd ?? null);
  if (!parsed.ok) {
    redirect(`/quotations/${id}?error=` + encodeURIComponent(parsed.error));
  }

  const poFileCandidate = fd?.get("po_file");
  const poFile = poFileCandidate instanceof File && poFileCandidate.size > 0 ? poFileCandidate : null;

  const result = await acceptQuotationAndRecordPo(
    supabase,
    id,
    { id: person.id, roles: person.roles },
    parsed.value,
    poFile,
  );

  if (!result.ok) {
    redirect(`/quotations/${id}?error=` + encodeURIComponent(friendlyError(result.error)));
  }

  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  if (result.jobId) {
    revalidatePath(`/jobs/${result.jobId}`);
    revalidatePath("/jobs");
    revalidatePath("/enquiries");
  }

  if (result.fileError) {
    redirect(
      `/quotations/${id}?error=` +
        encodeURIComponent("Quotation accepted, but PO file was not saved: " + result.fileError),
    );
  }

  redirect(`/quotations/${id}?saved=accepted`);
}

// T30: Records that the customer rejected the quotation (stored as status='superseded' with superseded_by=null).
export async function rejectQuotation(id: string) {
  const { supabase } = await requireStaff();
  const { error } = await supabase
    .from("quotations")
    .update({
      status: "superseded",
      superseded_by: null,
    })
    .eq("id", id);

  if (error) redirect(`/quotations/${id}?error=` + encodeURIComponent(friendlyError(error.message)));
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${id}?saved=rejected`);
}

export async function reopenQuotationDraft(id: string) {
  const { supabase } = await requireStaff();
  const { error } = await supabase
    .from("quotations")
    .update({
      status: "draft",
      approved_by: null,
      approved_at: null,
      superseded_by: null,
    })
    .eq("id", id);

  if (error) redirect(`/quotations/${id}?error=` + encodeURIComponent(friendlyError(error.message)));
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${id}?saved=draft`);
}

export async function setQuotationStatus(id: string, fd: FormData) {
  const { supabase, person } = await requireStaff();
  const statusRaw = text(fd, "status");
  if (!statusRaw) redirect(`/quotations/${id}`);

  if (statusRaw === "rejected") {
    return rejectQuotation(id);
  }
  if (!(Constants.public.Enums.quotation_status as readonly string[]).includes(statusRaw)) {
    redirect(`/quotations/${id}`);
  }
  const status = statusRaw as Enums<"quotation_status">;

  const { data: existing } = await supabase
    .from("quotations")
    .select("approved_at, approved_by")
    .eq("id", id)
    .maybeSingle();

  let approvalPatch: { approved_by?: string | null; approved_at?: string | null; superseded_by?: string | null } = {};
  if (["approved", "sent", "accepted"].includes(status) && !existing?.approved_at) {
    if (!person || !person.roles.includes("management")) {
      redirect(`/quotations/${id}?error=` + encodeURIComponent("Only management can approve a quotation (R10)."));
    }
    approvalPatch = { approved_by: person.id, approved_at: new Date().toISOString() };
  } else if (status === "draft") {
    approvalPatch = { approved_by: null, approved_at: null, superseded_by: null };
  }

  const { error } = await supabase
    .from("quotations")
    .update({ status, ...approvalPatch })
    .eq("id", id);

  if (error) redirect(`/quotations/${id}?error=` + encodeURIComponent(friendlyError(error.message)));
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${id}?saved=1`);
}

// R11: Quotations have no expiry date. Management decides when a quotation is to be revised.
export async function reviseQuotation(id: string) {
  const { supabase, person } = await requireStaff();
  if (!person || !person.roles.includes("management")) {
    redirect(`/quotations/${id}?error=` + encodeURIComponent("Only management can revise a quotation (R11)."));
  }

  const { data: original } = await supabase
    .from("quotations")
    .select("*, quotation_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (!original) redirect("/quotations");

  const { data: created, error } = await supabase
    .from("quotations")
    .insert({
      customer_id: original.customer_id,
      enquiry_id: original.enquiry_id,
      quote_date: new Date().toISOString().slice(0, 10),
      attention: original.attention,
      subject: original.subject,
      terms: original.terms ?? DEFAULT_QUOTATION_TERMS,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) redirect(`/quotations/${id}?error=` + encodeURIComponent(friendlyError(error.message)));

  if (original.quotation_items.length > 0) {
    await supabase.from("quotation_items").insert(
      original.quotation_items.map((item) => ({
        quotation_id: created.id,
        position: item.position,
        description: item.description,
        basis: item.basis,
        rate: item.rate,
        minimum_charge: item.minimum_charge,
        notes: item.notes,
      })),
    );
  }

  await supabase
    .from("quotations")
    .update({ status: "superseded", superseded_by: created.id })
    .eq("id", id);

  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${created.id}?saved=revised`);
}

export async function addQuotationItem(quotationId: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const description = text(fd, "description");
  if (!description) {
    redirect(`/quotations/${quotationId}?error=` + encodeURIComponent("Item description is required."));
  }
  const position = num(fd, "position") ?? 1;
  const { error } = await supabase.from("quotation_items").insert({
    quotation_id: quotationId,
    position,
    description,
    basis: text(fd, "basis"),
    rate: num(fd, "rate"),
    minimum_charge: num(fd, "minimum_charge"),
    notes: text(fd, "notes"),
  });
  if (error) redirect(`/quotations/${quotationId}?error=` + encodeURIComponent(friendlyError(error.message)));
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${quotationId}?saved=item`);
}

export async function updateQuotationItem(quotationId: string, itemId: string, fd: FormData) {
  const { supabase } = await requireStaff();
  const description = text(fd, "description");
  if (!description) {
    redirect(`/quotations/${quotationId}?error=` + encodeURIComponent("Item description is required."));
  }
  const { error } = await supabase
    .from("quotation_items")
    .update({
      position: num(fd, "position") ?? 1,
      description,
      basis: text(fd, "basis"),
      rate: num(fd, "rate"),
      minimum_charge: num(fd, "minimum_charge"),
      notes: text(fd, "notes"),
    })
    .eq("id", itemId)
    .eq("quotation_id", quotationId);
  if (error) redirect(`/quotations/${quotationId}?error=` + encodeURIComponent(friendlyError(error.message)));
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${quotationId}?saved=item`);
}

export async function deleteQuotationItem(quotationId: string, itemId: string) {
  const { supabase } = await requireStaff();
  const { error } = await supabase
    .from("quotation_items")
    .delete()
    .eq("id", itemId)
    .eq("quotation_id", quotationId);
  if (error) redirect(`/quotations/${quotationId}?error=` + encodeURIComponent(friendlyError(error.message)));
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${quotationId}?saved=item`);
}
