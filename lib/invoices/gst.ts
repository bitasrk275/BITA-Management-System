// Pure GST calculation and rounding logic for BITA tax invoices (D-017).
// BITA is registered in Karnataka (state code 29).
// Standard NDT/inspection GST rate is 18%:
// - Intra-state (place of supply = 29, Karnataka): CGST 9% + SGST 9%
// - Inter-state (outside Karnataka): IGST 18%
// All calculations run in integer paise, with a whole-rupee round-off on the final total.

export const BITA_STATE_CODE = "29";
export const BITA_STATE_NAME = "Karnataka";
export const DEFAULT_SAC_CODE = "998393"; // Confirmed from BITA reference invoice (SAC No. : 998393).

export const INDIAN_STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

/**
 * Converts a rupee amount to integer paise without floating-point drift.
 */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) return 0;
  return Math.round((rupees + Number.EPSILON) * 100);
}

/**
 * Converts integer paise back to a 2-decimal rupee number.
 */
export function fromPaise(paise: number): number {
  const normalized = Math.round(paise) / 100;
  return Object.is(normalized, -0) ? 0 : normalized;
}

/**
 * Rounds a rupee number to 2 decimal places (exact paise).
 */
export function roundPaise(rupees: number): number {
  return fromPaise(toPaise(rupees));
}

/**
 * Extracts a 2-digit GST state code from a GSTIN (if valid 2-digit prefix).
 */
export function stateCodeFromGstin(gstin?: string | null): string | null {
  if (!gstin) return null;
  const trimmed = gstin.trim().toUpperCase();
  const match = /^(\d{2})[A-Z0-9]{13}$/.exec(trimmed) ?? /^(\d{2})/.exec(trimmed);
  if (!match) return null;
  return match[1];
}

/**
 * Infers a 2-digit GST state code from a free-text billing address or state name when no GSTIN is present.
 */
export function stateCodeFromAddress(address?: string | null): string | null {
  if (!address) return null;
  const text = address.trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  // Check explicit state names first
  for (const [code, stateName] of Object.entries(INDIAN_STATE_NAMES)) {
    if (lower.includes(stateName.toLowerCase())) {
      return code;
    }
  }

  // Common Karnataka cities/industrial areas and PIN prefix (56xxxx - 59xxxx)
  if (
    /\b(bengaluru|bangalore|mysuru|mysore|peenya|bommasandra|jigani|dabaspet|whitefield|hubballi|hubli|belagavi|belgaum|mangaluru|mangalore|tumakuru|tumkur|hoskote|bidadi|dodballapur)\b/i.test(
      text,
    ) ||
    /\b5[6-9]\d{4}\b/.test(text)
  ) {
    return "29";
  }

  // Common neighbouring industrial cities outside Karnataka
  if (/\b(chennai|hosur|coimbatore|tiruchirappalli|trichy|ambattur|sriperumbudur)\b/i.test(text) || /\b6[0-4]\d{4}\b/.test(text)) {
    return "33"; // Tamil Nadu
  }
  if (/\b(mumbai|pune|thane|nashik|nagpur|aurangabad|pimpri|chakan|bhosari)\b/i.test(text) || /\b4[0-4]\d{4}\b/.test(text)) {
    return "27"; // Maharashtra
  }
  if (/\b(hyderabad|secunderabad|medak|patancheru|jeedimetla)\b/i.test(text) || /\b50\d{4}\b/.test(text)) {
    return "36"; // Telangana
  }
  if (/\b(visakhapatnam|vizag|vijayawada|tirupati|nellore|sricity)\b/i.test(text) || /\b5[1-3]\d{4}\b/.test(text)) {
    return "37"; // Andhra Pradesh
  }
  if (/\b(ahmedabad|vadodara|baroda|surat|rajkot|vapi|bharuch|ankleshwar)\b/i.test(text) || /\b3[6-9]\d{4}\b/.test(text)) {
    return "24"; // Gujarat
  }
  if (/\b(kochi|cochin|thiruvananthapuram|trivandrum|kozhikode|palakkad)\b/i.test(text) || /\b6[7-9]\d{4}\b/.test(text)) {
    return "32"; // Kerala
  }
  if (/\b(new delhi|delhi|okhla)\b/i.test(text) || /\b11\d{4}\b/.test(text)) {
    return "07"; // Delhi
  }
  if (/\b(gurugram|gurgaon|faridabad|manesar|panipat)\b/i.test(text) || /\b1[23]\d{4}\b/.test(text)) {
    return "06"; // Haryana
  }
  if (/\b(noida|ghaziabad|kanpur|lucknow)\b/i.test(text) || /\b2[0-8]\d{4}\b/.test(text)) {
    return "09"; // Uttar Pradesh
  }
  if (/\b(kolkata|howrah|durgapur|haldia)\b/i.test(text) || /\b7[0-4]\d{4}\b/.test(text)) {
    return "19"; // West Bengal
  }

  return null;
}

export interface PlaceOfSupplyInput {
  gstin?: string | null;
  placeOfSupply?: string | null;
  billingState?: string | null;
  billingAddress?: string | null;
}

/**
 * Resolves the 2-digit GST state code for an invoice:
 * 1. Explicit placeOfSupply (if a 2-digit code or state name is given)
 * 2. Customer GSTIN's first 2 digits
 * 3. Billing state or billing address inference
 * 4. Defaults to '29' (Karnataka) when neither GSTIN nor non-Karnataka billing state is given.
 */
export function resolvePlaceOfSupplyCode(input: PlaceOfSupplyInput): string {
  if (input.placeOfSupply) {
    const trimmed = input.placeOfSupply.trim();
    const codeMatch = /^(\d{2})\b/.exec(trimmed);
    if (codeMatch) return codeMatch[1];
    const byName = stateCodeFromAddress(trimmed);
    if (byName) return byName;
  }

  const fromGstin = stateCodeFromGstin(input.gstin);
  if (fromGstin) return fromGstin;

  if (input.billingState) {
    const trimmedState = input.billingState.trim();
    const codeMatch = /^(\d{2})\b/.exec(trimmedState);
    if (codeMatch) return codeMatch[1];
    const byState = stateCodeFromAddress(trimmedState);
    if (byState) return byState;
    if (trimmedState.toLowerCase() !== "karnataka") {
      return "99"; // Outside Karnataka
    }
  }

  const fromAddr = stateCodeFromAddress(input.billingAddress);
  if (fromAddr) return fromAddr;

  return BITA_STATE_CODE;
}

/**
 * Formats a 2-digit state code for display on a tax invoice (e.g. "29 - Karnataka").
 */
export function formatPlaceOfSupply(codeOrText?: string | null): string {
  const code = resolvePlaceOfSupplyCode({ placeOfSupply: codeOrText });
  const name = INDIAN_STATE_NAMES[code];
  return name ? `${code} - ${name}` : codeOrText?.trim() || `${BITA_STATE_CODE} - ${BITA_STATE_NAME}`;
}

export interface GstBreakdown {
  place_of_supply: string;
  is_intra_state: boolean;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  gross_total: number;
  round_off: number;
  total: number;
}

/**
 * Calculates GST at 18% (CGST 9% + SGST 9% for Karnataka 29; IGST 18% otherwise)
 * and whole-rupee round-off on the final total.
 */
export function calculateInvoiceGst(
  taxableValue: number,
  supply: PlaceOfSupplyInput = {},
): GstBreakdown {
  const placeCode = resolvePlaceOfSupplyCode(supply);
  const isIntraState = placeCode === BITA_STATE_CODE;

  const taxablePaise = Math.max(0, toPaise(taxableValue));

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (isIntraState) {
    cgstPaise = Math.round(taxablePaise * 0.09);
    sgstPaise = Math.round(taxablePaise * 0.09);
  } else {
    igstPaise = Math.round(taxablePaise * 0.18);
  }

  const grossPaise = taxablePaise + cgstPaise + sgstPaise + igstPaise;
  const roundedRupees = Math.round(grossPaise / 100);
  const totalPaise = roundedRupees * 100;
  const roundOffPaise = totalPaise - grossPaise;

  return {
    place_of_supply: placeCode,
    is_intra_state: isIntraState,
    taxable_value: fromPaise(taxablePaise),
    cgst: fromPaise(cgstPaise),
    sgst: fromPaise(sgstPaise),
    igst: fromPaise(igstPaise),
    gross_total: fromPaise(grossPaise),
    round_off: fromPaise(roundOffPaise),
    total: fromPaise(totalPaise),
  };
}
