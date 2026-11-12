import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractEnquiry,
  type ExtractEnquiryOptions,
} from "../../ai/extract-enquiry";
import { matchCustomer } from "../../ai/match-customer";
import type { ExtractedEnquiry, TestMethod } from "../../ai/types";
import type { Database } from "../../db/types";

export interface ParsedEmailParts {
  sender: string | null;
  senderName: string | null;
  senderEmail: string | null;
  senderPhone: string | null;
  subject: string | null;
  body: string;
}

export interface EnquiryAiPrefill {
  customer_id: string | null;
  customer_hint: string | null;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  requirement: string | null;
  standard: string | null;
  component: string | null;
  quantity: number | null;
  site: string | null;
  test_methods: TestMethod[];
  urgency: ExtractedEnquiry["urgency"];
  notes: string;
}

const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
const PHONE_REGEX = /(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})\b/;
const STANDARD_REGEX =
  /\b((?:ASTM|ASME|IS|ISO|EN|AWS|API|BS|DIN)\s*(?:Sec(?:tion)?\s*[IdivxV0-9]+|[A-Z]?\s*\d+(?:[-:/]\d+)*(?:\s*Part\s*\d+)?))/i;

/**
 * Parses optional From/Subject headers and contact identifiers from a pasted customer email,
 * without persisting the raw email text.
 */
export function parsePastedEmail(rawEmail: string): ParsedEmailParts {
  const lines = rawEmail.replace(/\r\n/g, "\n").split("\n");
  let senderHeader: string | null = null;
  let subjectHeader: string | null = null;
  const bodyLines: string[] = [];
  let inHeaders = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inHeaders) {
      if (!trimmed && (senderHeader || subjectHeader)) {
        inHeaders = false;
        continue;
      }
      const fromMatch = trimmed.match(/^from\s*:\s*(.+)$/i);
      if (fromMatch) {
        senderHeader = fromMatch[1]!.trim();
        continue;
      }
      const subjMatch = trimmed.match(/^subject\s*:\s*(.+)$/i);
      if (subjMatch) {
        subjectHeader = subjMatch[1]!.trim();
        continue;
      }
      if (/^(to|cc|date|sent)\s*:/i.test(trimmed)) {
        continue;
      }
      inHeaders = false;
    }
    bodyLines.push(line);
  }

  const body = bodyLines.join("\n").trim() || rawEmail.trim();
  const emailMatch =
    (senderHeader && senderHeader.match(EMAIL_REGEX)) ||
    rawEmail.match(EMAIL_REGEX);
  const senderEmail = emailMatch ? emailMatch[1]!.trim() : null;

  const phoneMatch = rawEmail.match(PHONE_REGEX);
  const senderPhone = phoneMatch
    ? phoneMatch[1]!.replace(/\s+/g, "")
    : null;

  let senderName: string | null = null;
  if (senderHeader) {
    const cleaned = senderHeader
      .replace(/<[^>]*>/g, "")
      .replace(EMAIL_REGEX, "")
      .replace(/["']/g, "")
      .trim();
    if (cleaned) {
      senderName = cleaned;
    }
  }

  return {
    sender: senderHeader || senderEmail || senderPhone,
    senderName,
    senderEmail,
    senderPhone,
    subject: subjectHeader,
    body,
  };
}

/**
 * Extracts a testing standard/specification mention (e.g., "ASTM A388", "ASME Sec V", "IS 3664")
 * from text when present.
 */
export function extractStandardHint(text: string): string | null {
  const match = text.match(STANDARD_REGEX);
  return match ? match[1]!.replace(/\s+/g, " ").trim() : null;
}

/**
 * Formats extracted structured fields into concise enquiry notes (`body`),
 * without storing the raw customer email unless the office chooses to paste it.
 */
export function formatStructuredEnquiryNotes(fields: {
  requirement?: string | null;
  test_methods?: readonly string[] | null;
  standard?: string | null;
  component?: string | null;
  quantity?: number | string | null;
  site?: string | null;
}): string {
  const lines: string[] = [];
  if (fields.requirement?.trim()) {
    lines.push(`Requirement: ${fields.requirement.trim()}`);
  }
  if (fields.test_methods && fields.test_methods.length > 0) {
    lines.push(`Test method(s): ${fields.test_methods.join(", ")}`);
  }
  if (fields.standard?.trim()) {
    lines.push(`Standard: ${fields.standard.trim()}`);
  }
  if (fields.component?.trim()) {
    lines.push(`Component: ${fields.component.trim()}`);
  }
  if (
    fields.quantity !== null &&
    fields.quantity !== undefined &&
    String(fields.quantity).trim() !== ""
  ) {
    lines.push(`Quantity: ${String(fields.quantity).trim()}`);
  }
  if (fields.site?.trim()) {
    lines.push(`Site: ${fields.site.trim()}`);
  }
  return lines.join("\n");
}

/**
 * Calls `extractEnquiry` (Claude API, default model `claude-sonnet-5-5`) and `matchCustomer`
 * to prefill the `/enquiries/new` form from a pasted customer email.
 * Never stores the raw email in the database.
 */
export async function buildEnquiryPrefillFromEmail(
  supabase: SupabaseClient<Database>,
  rawEmail: string,
  options?: ExtractEnquiryOptions,
): Promise<{ ok: true; data: EnquiryAiPrefill } | { ok: false; error: string }> {
  const trimmed = rawEmail.trim();
  if (!trimmed) {
    return { ok: false, error: "Paste the customer's email text first." };
  }

  const parsed = parsePastedEmail(trimmed);
  const extracted = await extractEnquiry(
    {
      sender: parsed.sender,
      subject: parsed.subject,
      body: parsed.body,
    },
    options,
  );

  if (!extracted) {
    return {
      ok: false,
      error:
        "Could not extract enquiry details from the email. Check ANTHROPIC_API_KEY or fill the form manually.",
    };
  }

  const matchedCustomerId = await matchCustomer(supabase, {
    sender: parsed.sender,
    senderEmail: parsed.senderEmail,
    senderPhone: parsed.senderPhone,
    customerHint: extracted.customer_hint,
  });

  const standard = extractStandardHint(trimmed);
  const requirement =
    extracted.summary ||
    (extracted.test_methods.length > 0 && extracted.component
      ? `${extracted.test_methods.join(" / ")} inspection of ${extracted.quantity ? `${extracted.quantity} ` : ""}${extracted.component}`
      : null);

  const defaultSubject =
    parsed.subject ||
    (extracted.test_methods.length > 0 && extracted.component
      ? `${extracted.test_methods.join(" / ")} of ${extracted.quantity ? `${extracted.quantity} ` : ""}${extracted.component}`
      : extracted.summary);

  const notes = formatStructuredEnquiryNotes({
    requirement,
    test_methods: extracted.test_methods,
    standard,
    component: extracted.component,
    quantity: extracted.quantity,
    site: extracted.site,
  });

  return {
    ok: true,
    data: {
      customer_id: matchedCustomerId,
      customer_hint: extracted.customer_hint,
      from_name: extracted.contact_name || parsed.senderName,
      from_address: parsed.senderEmail || parsed.senderPhone,
      subject: defaultSubject,
      requirement,
      standard,
      component: extracted.component,
      quantity: extracted.quantity,
      site: extracted.site,
      test_methods: extracted.test_methods,
      urgency: extracted.urgency,
      notes,
    },
  };
}
