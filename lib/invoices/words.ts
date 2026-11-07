// Converts an INR amount into words using the Indian numbering system
// (Crore, Lakh, Thousand, Hundred), e.g.:
// 47200 -> "Rupees Forty-Seven Thousand Two Hundred only"

import { toPaise } from "./gst";

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const;

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
] as const;

function twoDigitsToWords(n: number): string {
  if (n <= 0) return "";
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const unit = n % 10;
  return unit > 0 ? `${TENS[ten]}-${ONES[unit]}` : TENS[ten];
}

function integerToIndianWords(num: number): string {
  if (num <= 0) return "Zero";

  const parts: string[] = [];
  let rem = Math.floor(num);

  const crores = Math.floor(rem / 10_000_000);
  rem %= 10_000_000;
  if (crores > 0) {
    parts.push(`${integerToIndianWords(crores)} Crore`);
  }

  const lakhs = Math.floor(rem / 100_000);
  rem %= 100_000;
  if (lakhs > 0) {
    parts.push(`${twoDigitsToWords(lakhs)} Lakh`);
  }

  const thousands = Math.floor(rem / 1_000);
  rem %= 1_000;
  if (thousands > 0) {
    parts.push(`${twoDigitsToWords(thousands)} Thousand`);
  }

  const hundreds = Math.floor(rem / 100);
  rem %= 100;
  if (hundreds > 0) {
    parts.push(`${ONES[hundreds]} Hundred`);
  }

  if (rem > 0) {
    parts.push(twoDigitsToWords(rem));
  }

  return parts.join(" ");
}

/**
 * Formats an INR rupee amount in Indian words, e.g.
 * `amountInWordsINR(47200)` -> `"Rupees Forty-Seven Thousand Two Hundred only"`.
 */
export function amountInWordsINR(amount: number): string {
  const totalPaise = Math.max(0, toPaise(amount));
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  if (rupees === 0 && paise === 0) {
    return "Rupees Zero only";
  }

  const rupeeWords = integerToIndianWords(rupees);
  if (paise === 0) {
    return `Rupees ${rupeeWords} only`;
  }

  const paiseWords = twoDigitsToWords(paise);
  return `Rupees ${rupeeWords} and ${paiseWords} Paise only`;
}
