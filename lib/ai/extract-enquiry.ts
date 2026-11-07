import {
  isExtractedEnquiry,
  normalizeExtractedEnquiry,
  type ExtractedEnquiry,
  type RawEnquiryInput,
} from "./types";
import { checkAiEnv } from "../env";

export interface ExtractEnquiryOptions {
  apiKey?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_MODEL = "claude-sonnet-5-5";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `You are an AI assistant for BITA (Bangalore Inspection & Testing Agency), an NDT (Non-Destructive Testing) and inspection agency running since 1987.
Your task is to analyze an incoming customer enquiry (from email, WhatsApp, or phone) and extract structured details as JSON.

Valid NDT test methods are strictly:
- "UT" (Ultrasonic Testing)
- "MPT" (Magnetic Particle Testing, MPI, MT)
- "DPT" (Dye / Liquid Penetrant Testing, DP, PT, LPI)
- "RT" (Radiographic Testing, X-ray)
- "VT" (Visual Testing)
- "hardness" (Hardness Testing)
- "metallography" (Metallography)
- "RLA" (Remaining Life Assessment)
- "certification" (Certification)
- "general_inspection" (General Inspection)

Return a single JSON object with EXACTLY the following keys:
{
  "customer_hint": string or null (Company or organisation name if identified or hinted in the sender/text),
  "contact_name": string or null (Name of person sending or mentioned as contact),
  "component": string or null (Specific components, parts or equipment to test, e.g. "Rotor shafts", "Forged ring blanks"),
  "quantity": number or null (Integer quantity of parts if mentioned, otherwise null),
  "test_methods": array of valid method strings from the list above (e.g. ["UT", "MPT"]),
  "site": string or null (Testing site, plant location or city mentioned, e.g. "Dabaspet", "Peenya", or null),
  "urgency": "urgent" | "normal" | "low" | null (Urgency level based on requested dates, keywords like urgent/tomorrow/immediate),
  "summary": string or null (A concise 1-2 sentence summary of what is requested)
}

Respond ONLY with valid JSON. Do not include markdown fences, comments, or any conversational preamble or postscript.`;

/**
 * Strips markdown fences if wrapped in ```json ... ``` and parses JSON.
 */
function parseJsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

/**
 * Extracts structured enquiry fields from an email or WhatsApp enquiry using the Claude API.
 * Returns `null` if ANTHROPIC_API_KEY is not configured or if extraction fails.
 */
export async function extractEnquiry(
  input: RawEnquiryInput,
  options?: ExtractEnquiryOptions
): Promise<ExtractedEnquiry | null> {
  const subject = input.subject?.trim() || "";
  const body = input.body?.trim() || "";
  const sender = input.sender?.trim() || "";

  // If there is no content to extract from, return null immediately
  if (!subject && !body) {
    return null;
  }

  const aiEnv = checkAiEnv();
  const apiKey = options?.apiKey || aiEnv.apiKey;
  if (!apiKey) {
    return null;
  }

  const model = options?.model || aiEnv.model || DEFAULT_MODEL;
  const customFetch = options?.fetchFn || fetch;

  const userContent = [
    sender ? `Sender: ${sender}` : null,
    subject ? `Subject: ${subject}` : null,
    body ? `Body:\n${body}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const response = await customFetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.warn(`Claude API error (${response.status}): ${errorText}`);
      return null;
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const textBlock = data?.content?.find(
      (b) => b.type === "text" && typeof b.text === "string"
    );
    if (!textBlock?.text) {
      console.warn("Claude API response did not contain a text content block.");
      return null;
    }

    const parsedJson = parseJsonPayload(textBlock.text);
    const normalized = normalizeExtractedEnquiry(parsedJson);

    if (!normalized || !isExtractedEnquiry(normalized)) {
      console.warn("Claude API response failed ExtractedEnquiry type guard validation.");
      return null;
    }

    return normalized;
  } catch (err) {
    console.warn("Failed to extract enquiry details via Claude API:", err);
    return null;
  }
}
