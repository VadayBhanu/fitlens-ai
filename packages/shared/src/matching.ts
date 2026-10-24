import type { MatchStatus, Money } from "./schemas";

/**
 * Exact-product identity engine.
 *
 * Principle: visual or textual resemblance is never enough to call two offers
 * the same product. "exact" requires an identifier match (GTIN, or brand +
 * style number) AND no conflicting variant attribute (color, size).
 */

export interface ProductIdentity {
  name: string;
  brand?: string | null;
  styleNumber?: string | null;
  gtin?: string | null;
  color?: string | null;
  size?: string | null;
}

export interface MatchResult {
  status: MatchStatus;
  score: number;
  evidence: string[];
}

const STOP_WORDS = new Set(["the", "a", "an", "and", "for", "with", "in", "of", "by", "mens", "men", "womens", "women", "unisex", "new"]);

export function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokens(s: string | null | undefined): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function normalizeStyleNumber(s: string | null | undefined): string {
  return normalizeText(s).replace(/\s+/g, "");
}

const COLOR_SYNONYMS: Record<string, string> = {
  blk: "black",
  jet: "black",
  onyx: "black",
  noir: "black",
  wht: "white",
  ivory: "white",
  cream: "white",
  "off white": "white",
  navy: "blue",
  "navy blue": "blue",
  cobalt: "blue",
  indigo: "blue",
  grey: "gray",
  heather: "gray",
  charcoal: "gray",
  burgundy: "red",
  maroon: "red",
  crimson: "red",
  olive: "green",
  khaki: "green",
  tan: "brown",
  camel: "brown",
  beige: "brown"
};

/** Coarse color family used to detect conflicts — not a perceptual match. */
export function normalizeColor(s: string | null | undefined): string | null {
  const n = normalizeText(s);
  if (!n) return null;
  if (COLOR_SYNONYMS[n]) return COLOR_SYNONYMS[n]!;
  const words = n.split(" ");
  for (const w of words.reverse()) {
    if (COLOR_SYNONYMS[w]) return COLOR_SYNONYMS[w]!;
    if (["black", "white", "blue", "gray", "red", "green", "brown", "pink", "purple", "yellow", "orange"].includes(w)) return w;
  }
  return n;
}

const SIZE_ALIASES: Record<string, string> = {
  "extra small": "xs",
  "x small": "xs",
  small: "s",
  medium: "m",
  med: "m",
  large: "l",
  "extra large": "xl",
  "x large": "xl",
  xxl: "2xl",
  "xx large": "2xl",
  xxxl: "3xl"
};

export function normalizeSize(s: string | null | undefined): string | null {
  const n = normalizeText(s);
  if (!n) return null;
  return SIZE_ALIASES[n] ?? n.replace(/\s+/g, "");
}

/** Validate GTIN-8/12/13/14 check digit. */
export function isValidGtin(raw: string | null | undefined): boolean {
  const g = (raw ?? "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(g.length)) return false;
  const digits = g.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => {
    sum += d * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

export function normalizeGtin(raw: string | null | undefined): string | null {
  if (!isValidGtin(raw)) return null;
  return (raw ?? "").replace(/\D/g, "").padStart(14, "0");
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function matchProducts(source: ProductIdentity, candidate: ProductIdentity): MatchResult {
  const evidence: string[] = [];

  const sColor = normalizeColor(source.color);
  const cColor = normalizeColor(candidate.color);
  const sSize = normalizeSize(source.size);
  const cSize = normalizeSize(candidate.size);
  const colorConflict = !!(sColor && cColor && sColor !== cColor);
  const sizeConflict = !!(sSize && cSize && sSize !== cSize);
  if (colorConflict) evidence.push(`Color differs (${source.color} vs ${candidate.color})`);
  if (sizeConflict) evidence.push(`Size differs (${source.size} vs ${candidate.size})`);

  const sBrand = normalizeText(source.brand);
  const cBrand = normalizeText(candidate.brand);
  const brandConflict = !!(sBrand && cBrand && sBrand !== cBrand && !sBrand.includes(cBrand) && !cBrand.includes(sBrand));
  if (brandConflict) evidence.push(`Brand differs (${source.brand} vs ${candidate.brand})`);

  const sGtin = normalizeGtin(source.gtin);
  const cGtin = normalizeGtin(candidate.gtin);
  const gtinMatch = !!(sGtin && cGtin && sGtin === cGtin);
  const gtinConflict = !!(sGtin && cGtin && sGtin !== cGtin);
  if (gtinMatch) evidence.push("Same GTIN/UPC barcode");
  if (gtinConflict) evidence.push("Different GTIN/UPC barcode");

  const sStyle = normalizeStyleNumber(source.styleNumber);
  const cStyle = normalizeStyleNumber(candidate.styleNumber);
  const styleMatch = !!(sStyle && cStyle && sStyle === cStyle && !brandConflict);
  if (styleMatch) evidence.push("Same brand style number");

  const nameSim = jaccard(tokens(source.name), tokens(candidate.name));
  if (nameSim >= 0.5) evidence.push(`Similar title (${Math.round(nameSim * 100)}% token overlap)`);

  // A GTIN identifies a specific variant; a style number identifies a style
  // and therefore still needs variant attributes to be confirmed.
  if (gtinMatch && !colorConflict && !sizeConflict) {
    return { status: "exact", score: 1, evidence };
  }
  if (styleMatch && !gtinConflict && !colorConflict && !sizeConflict) {
    const variantConfirmed = (!sColor || !!cColor) && (!sSize || !!cSize);
    if (variantConfirmed) return { status: "exact", score: 0.95, evidence };
    evidence.push("Variant (color/size) not confirmed by this retailer");
    return { status: "similar", score: 0.8, evidence };
  }

  if (brandConflict || gtinConflict) {
    return { status: "mismatch", score: Math.min(0.3, nameSim), evidence };
  }

  let score = nameSim * 0.7 + (sBrand && sBrand === cBrand ? 0.2 : 0) + (sColor && sColor === cColor ? 0.1 : 0);
  if (colorConflict || sizeConflict) score *= 0.6;
  score = Math.round(score * 100) / 100;
  return { status: score >= 0.35 ? "similar" : "mismatch", score, evidence };
}

export interface RankableOffer {
  id: string;
  total: Money;
  available: boolean | null;
  returnPolicy: string | null;
  match: MatchResult;
}

/**
 * Recommend an offer among exact matches only. Cheapest available total wins,
 * but a free-returns offer within 5% of the cheapest is preferred.
 */
export function recommendOffer<T extends RankableOffer>(offers: T[]): { offer: T; reasons: string[] } | null {
  const candidates = offers.filter((o) => o.match.status === "exact" && o.available !== false);
  if (!candidates.length) return null;
  const currency = candidates[0]!.total.currency;
  const sameCurrency = candidates.filter((o) => o.total.currency === currency);
  sameCurrency.sort((a, b) => a.total.amountMinor - b.total.amountMinor);
  const cheapest = sameCurrency[0]!;
  const freeReturns = (o: T) => /free\s+returns?/i.test(o.returnPolicy ?? "");
  const alt = sameCurrency.find((o) => freeReturns(o) && o.total.amountMinor <= cheapest.total.amountMinor * 1.05);
  const pick = alt && !freeReturns(cheapest) ? alt : cheapest;
  const reasons = ["Verified exact match (same product and variant)"];
  if (pick === cheapest) reasons.push("Lowest total price including known shipping");
  else reasons.push("Free returns for under 5% more than the cheapest offer");
  if (pick.available === true) reasons.push("Reported in stock");
  if (pick.available === null) reasons.push("Stock not confirmed — check before buying");
  return { offer: pick, reasons };
}
