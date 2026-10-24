import type { Money } from "./schemas";

/** Currencies whose minor unit is not 1/100. Everything else defaults to 2 digits. */
const MINOR_DIGITS: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

const SYMBOL_TO_CURRENCY: Record<string, string> = {
  $: "USD",
  "US$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "C$": "CAD",
  "A$": "AUD",
  "₩": "KRW"
};

/**
 * Parse a human/retailer price string into integer minor units.
 * Handles "$1,299.99", "1.299,99 €", "1299", "USD 49.5" and numeric input.
 * Returns null when the value is not a confident price.
 */
export function parsePrice(input: unknown, fallbackCurrency = "USD"): Money | null {
  if (input === null || input === undefined) return null;
  let currency = fallbackCurrency.toUpperCase();

  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return { amountMinor: toMinor(input.toString(), currency), currency };
  }
  if (typeof input !== "string") return null;

  let s = input.trim();
  if (!s) return null;

  const code = s.match(/\b([A-Z]{3})\b/);
  if (code?.[1]) {
    currency = code[1];
    s = s.replace(code[0], "");
  } else {
    for (const [symbol, cur] of Object.entries(SYMBOL_TO_CURRENCY).sort((a, b) => b[0].length - a[0].length)) {
      if (s.includes(symbol)) {
        currency = cur;
        s = s.replace(symbol, "");
        break;
      }
    }
  }

  // Take the first number-like token (ignore "was $80 now $60" tails).
  const token = s.match(/\d[\d.,\s]*/)?.[0]?.replace(/\s/g, "");
  if (!token) return null;

  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever separator appears last is the decimal separator.
    normalized = lastDot > lastComma ? token.replace(/,/g, "") : token.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    const decimals = token.length - lastComma - 1;
    normalized = decimals === 3 || token.split(",").length > 2 ? token.replace(/,/g, "") : token.replace(",", ".");
  } else if (lastDot >= 0) {
    const decimals = token.length - lastDot - 1;
    normalized = token.split(".").length > 2 || (decimals === 3 && minorDigits(currency) !== 3) ? token.replace(/\./g, "") : token;
  } else {
    normalized = token;
  }
  normalized = normalized.replace(/[.,]$/, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return { amountMinor: toMinor(normalized, currency), currency };
}

/** Exact decimal-string → integer minor units, avoiding binary float drift. */
export function toMinor(decimal: string, currency: string): number {
  const digits = minorDigits(currency);
  const [whole = "0", frac = ""] = decimal.split(".");
  const padded = (frac + "0".repeat(digits + 1)).slice(0, digits + 1);
  let minor = Number(whole) * 10 ** digits + Number(padded.slice(0, digits) || "0");
  // Round half up on the next digit.
  if (Number(padded.charAt(digits)) >= 5) minor += 1;
  return minor;
}

export function addMoney(a: Money, b: Money | null | undefined): Money {
  if (!b) return { ...a };
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function formatMoney(m: Money, locale = "en-US"): string {
  const digits = minorDigits(m.currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: m.currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(m.amountMinor / 10 ** digits);
  } catch {
    return `${(m.amountMinor / 10 ** digits).toFixed(digits)} ${m.currency}`;
  }
}
