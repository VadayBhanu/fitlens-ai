import { normalizeStyleNumber, normalizeText, parsePrice, retailerFromDomain, tokens, type Money } from "@fitlens/shared";
import type { Env } from "../env";

/** A raw offer from any source, before identity matching. */
export interface CandidateOffer {
  provider: string;
  offerKey: string;
  retailer: string;
  retailerDomain: string;
  title: string;
  brand: string | null;
  styleNumber: string | null;
  gtin: string | null;
  color: string | null;
  size: string | null;
  productUrl: string;
  imageUrl: string | null;
  price: Money;
  shipping: Money | null;
  available: boolean | null;
  returnPolicy: string | null;
  isDemo: boolean;
}

export interface OfferQuery {
  name: string;
  brand: string | null;
  styleNumber: string | null;
  gtin: string | null;
  color: string | null;
  size: string | null;
  currency: string;
}

export interface OfferProvider {
  readonly name: string;
  readonly configured: boolean;
  search(q: OfferQuery): Promise<CandidateOffer[]>;
}

/** Offers from authorized retailer feeds stored in D1 (see /v1/admin/catalog). */
export class CatalogProvider implements OfferProvider {
  readonly name = "retailer-feeds";
  readonly configured = true;
  constructor(private readonly env: Env) {}

  async search(q: OfferQuery): Promise<CandidateOffer[]> {
    const brand = q.brand ? normalizeText(q.brand) : null;
    const style = q.styleNumber ? normalizeStyleNumber(q.styleNumber) : null;
    const nameTokens = tokens(q.name).slice(0, 4);
    const clauses: string[] = [];
    const binds: unknown[] = [];
    if (q.gtin) {
      binds.push(q.gtin.replace(/\D/g, "").replace(/^0+/, ""));
      clauses.push(`LTRIM(c.gtin, '0') = ?${binds.length}`);
    }
    if (style) {
      binds.push(style);
      clauses.push(`REPLACE(REPLACE(LOWER(c.style_number), '-', ''), ' ', '') = ?${binds.length}`);
    }
    if (brand && nameTokens.length) {
      binds.push(brand);
      const b = binds.length;
      const likes = nameTokens.map((t) => {
        binds.push(`%${t}%`);
        return `LOWER(c.title) LIKE ?${binds.length}`;
      });
      clauses.push(`(LOWER(c.brand) = ?${b} AND (${likes.join(" OR ")}))`);
    } else if (nameTokens.length >= 2) {
      const likes = nameTokens.map((t) => {
        binds.push(`%${t}%`);
        return `LOWER(c.title) LIKE ?${binds.length}`;
      });
      clauses.push(`(${likes.join(" AND ")})`);
    }
    if (!clauses.length) return [];

    const { results } = await this.env.DB.prepare(
      `SELECT c.*, r.name AS retailer_name, r.domain AS retailer_domain, r.return_policy
         FROM catalog_items c JOIN retailers r ON r.id = c.retailer_id
        WHERE ${clauses.join(" OR ")}
        LIMIT 60`
    )
      .bind(...binds)
      .all<Record<string, unknown>>();

    return results.map((r) => ({
      provider: this.name,
      offerKey: String(r.id),
      retailer: String(r.retailer_name),
      retailerDomain: String(r.retailer_domain),
      title: String(r.title),
      brand: (r.brand as string | null) ?? null,
      styleNumber: (r.style_number as string | null) ?? null,
      gtin: (r.gtin as string | null) ?? null,
      color: (r.color as string | null) ?? null,
      size: (r.size as string | null) ?? null,
      productUrl: String(r.product_url),
      imageUrl: (r.image_url as string | null) ?? null,
      price: { amountMinor: Number(r.price_minor), currency: String(r.currency) },
      shipping: r.shipping_minor === null || r.shipping_minor === undefined ? null : { amountMinor: Number(r.shipping_minor), currency: String(r.currency) },
      available: r.available === null || r.available === undefined ? null : Number(r.available) === 1,
      returnPolicy: (r.return_policy as string | null) ?? null,
      isDemo: Number(r.is_demo) === 1
    }));
  }
}

/**
 * Live offer discovery through SerpApi's Google Shopping engine (optional,
 * free tier available). Shopping listings rarely carry variant identifiers, so
 * these results usually qualify only as "similar" unless identifiers line up.
 */
export class SerpApiShoppingProvider implements OfferProvider {
  readonly name = "google-shopping";
  constructor(private readonly apiKey: string | undefined) {}

  get configured(): boolean {
    return !!this.apiKey;
  }

  async search(q: OfferQuery): Promise<CandidateOffer[]> {
    if (!this.apiKey) return [];
    const query = [q.brand, q.styleNumber ?? q.name, q.color].filter(Boolean).join(" ");
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", query.slice(0, 200));
    url.searchParams.set("gl", q.currency === "GBP" ? "uk" : q.currency === "INR" ? "in" : q.currency === "EUR" ? "de" : "us");
    url.searchParams.set("hl", "en");
    url.searchParams.set("api_key", this.apiKey);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Shopping search responded ${res.status}`);
    const data = (await res.json()) as { shopping_results?: Record<string, unknown>[] };
    const out: CandidateOffer[] = [];
    for (const r of (data.shopping_results ?? []).slice(0, 20)) {
      const link = (r.product_link ?? r.link) as string | undefined;
      const title = r.title as string | undefined;
      const price = typeof r.extracted_price === "number" ? parsePrice(r.extracted_price, q.currency) : parsePrice(r.price, q.currency);
      if (!link || !title || !price) continue;
      const titleNorm = normalizeStyleNumber(title);
      const styleInTitle = q.styleNumber && titleNorm.includes(normalizeStyleNumber(q.styleNumber)) ? q.styleNumber : null;
      const brandInTitle = q.brand && normalizeText(title).includes(normalizeText(q.brand)) ? q.brand : null;
      let domain = "";
      try {
        domain = new URL(link).hostname.replace(/^www\./, "");
      } catch {
        continue;
      }
      const delivery = typeof r.delivery === "string" ? r.delivery : "";
      const shipping = /free/i.test(delivery) ? { amountMinor: 0, currency: price.currency } : parsePrice(delivery.match(/\$[\d.,]+/)?.[0], price.currency);
      out.push({
        provider: this.name,
        offerKey: String(r.product_id ?? link),
        retailer: typeof r.source === "string" ? r.source : retailerFromDomain(domain),
        retailerDomain: domain,
        title,
        brand: brandInTitle,
        styleNumber: styleInTitle,
        gtin: null,
        color: null,
        size: null,
        productUrl: link,
        imageUrl: typeof r.thumbnail === "string" ? r.thumbnail : null,
        price,
        shipping,
        available: null,
        returnPolicy: null,
        isDemo: false
      });
    }
    return out;
  }
}

export function offerProviders(env: Env): OfferProvider[] {
  return [new CatalogProvider(env), new SerpApiShoppingProvider(env.SERPAPI_KEY)];
}
