import { parsePrice } from "./money";
import type { GarmentCategory, Money } from "./schemas";

/**
 * Product extraction from untrusted page data. Everything here treats page
 * content strictly as data: it is trimmed, length-capped and never evaluated.
 */

export interface ExtractedProduct {
  name?: string;
  brand?: string;
  color?: string;
  size?: string;
  styleNumber?: string;
  gtin?: string;
  sku?: string;
  description?: string;
  images: string[];
  price?: Money;
  url?: string;
  availability?: boolean | null;
}

export function cleanText(v: unknown, max = 300): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.slice(0, max) : undefined;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v === undefined || v === null ? [] : [v];
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  return asArray(node["@type"]).some((t) => typeof t === "string" && t.toLowerCase() === type.toLowerCase());
}

/** Depth-first walk over JSON-LD graphs collecting nodes of a given @type. */
export function collectJsonLdNodes(roots: unknown[], type: string, limit = 50): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const stack = [...roots];
  let visited = 0;
  while (stack.length && found.length < limit && visited < 5000) {
    visited++;
    const n = stack.pop();
    if (Array.isArray(n)) {
      stack.push(...n);
    } else if (n && typeof n === "object") {
      const obj = n as Record<string, unknown>;
      if (hasType(obj, type)) found.push(obj);
      for (const key of ["@graph", "hasVariant", "isVariantOf", "mainEntity", "itemListElement", "item"]) {
        if (obj[key]) stack.push(obj[key]);
      }
    }
  }
  return found;
}

function imageUrls(v: unknown): string[] {
  return asArray(v)
    .map((i) => (typeof i === "string" ? i : i && typeof i === "object" ? ((i as Record<string, unknown>).url ?? (i as Record<string, unknown>).contentUrl) : undefined))
    .filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
    .slice(0, 10);
}

function brandName(v: unknown): string | undefined {
  const b = asArray(v)[0];
  if (typeof b === "string") return cleanText(b, 120);
  if (b && typeof b === "object") return cleanText((b as Record<string, unknown>).name, 120);
  return undefined;
}

function offerInfo(v: unknown): { price?: Money; availability?: boolean | null } {
  for (const raw of asArray(v)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const currency = typeof o.priceCurrency === "string" ? o.priceCurrency.toUpperCase() : "USD";
    const priceRaw = o.price ?? o.lowPrice ?? (o.priceSpecification as Record<string, unknown> | undefined)?.price;
    const price = parsePrice(priceRaw as unknown, currency) ?? undefined;
    const avail = typeof o.availability === "string" ? o.availability : undefined;
    const availability = avail ? /InStock|LimitedAvailability|OnlineOnly|PreOrder/i.test(avail) : null;
    if (price) return { price, availability };
    if (o.offers) return offerInfo(o.offers);
  }
  return {};
}

export function productFromJsonLd(node: Record<string, unknown>): ExtractedProduct {
  const offers = offerInfo(node.offers);
  const gtin = cleanText(node.gtin14 ?? node.gtin13 ?? node.gtin12 ?? node.gtin8 ?? node.gtin, 14);
  return {
    name: cleanText(node.name),
    brand: brandName(node.brand ?? node.manufacturer),
    color: cleanText(node.color, 60),
    size: cleanText(node.size, 30),
    styleNumber: cleanText(node.mpn ?? node.productID ?? node.model, 80),
    gtin: gtin && /^\d{8,14}$/.test(gtin) ? gtin : undefined,
    sku: cleanText(node.sku, 80),
    description: cleanText(node.description, 2000),
    images: imageUrls(node.image),
    price: offers.price,
    availability: offers.availability ?? null,
    url: typeof node.url === "string" ? node.url : undefined
  };
}

/** Pick the JSON-LD product that best matches the selected image URL. */
export function bestJsonLdProduct(roots: unknown[], selectedImageUrl?: string): ExtractedProduct | null {
  const nodes = collectJsonLdNodes(roots, "Product");
  if (!nodes.length) return null;
  const products = nodes.map(productFromJsonLd).filter((p) => p.name);
  if (!products.length) return null;
  if (selectedImageUrl) {
    const key = imageKey(selectedImageUrl);
    const hit = products.find((p) => p.images.some((i) => imageKey(i) === key));
    if (hit) return hit;
  }
  return products[0]!;
}

/** Compare images ignoring query strings, protocol and common CDN size suffixes. */
export function imageKey(url: string): string {
  try {
    const u = new URL(url, "https://x.invalid");
    return (u.hostname + u.pathname).toLowerCase().replace(/[_-](\d{2,4}x\d{0,4}|small|medium|large|thumb)(?=\.\w+$)/, "");
  } catch {
    return url.toLowerCase();
  }
}

const CATEGORY_KEYWORDS: [GarmentCategory, RegExp][] = [
  ["dress", /\b(dress|gown|jumpsuit|romper|saree|sari|lehenga|kurta set|abaya)\b/i],
  ["outerwear", /\b(jacket|coat|blazer|parka|bomber|windbreaker|cardigan|gilet|vest|puffer|trench|overcoat|shacket)\b/i],
  ["bottom", /\b(jeans|trousers|pants|shorts|skirt|leggings|chinos|joggers|sweatpants|culottes)\b/i],
  ["top", /\b(t-?shirt|tee|shirt|blouse|top|polo|sweater|jumper|hoodie|sweatshirt|tank|camisole|henley|kurta|tunic|pullover|crewneck|jersey)\b/i]
];

export function inferCategory(...texts: (string | undefined | null)[]): GarmentCategory {
  const text = texts.filter(Boolean).join(" ");
  for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(text)) return cat;
  return "other";
}

/** Map our categories to FASHN's try-on categories. */
export function providerCategory(c: GarmentCategory): "tops" | "bottoms" | "one-pieces" | "auto" {
  switch (c) {
    case "top":
    case "outerwear":
      return "tops";
    case "bottom":
      return "bottoms";
    case "dress":
      return "one-pieces";
    default:
      return "auto";
  }
}

export function retailerFromDomain(domain: string): string {
  const host = domain.replace(/^www\./, "").split(".");
  const name = host.length > 2 ? host[host.length - 2]! : host[0]!;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
