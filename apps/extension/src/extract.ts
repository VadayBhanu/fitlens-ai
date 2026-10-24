import { bestJsonLdProduct, cleanText, imageKey, inferCategory, parsePrice, type ExtractedProduct, type SelectedProductInput } from "@fitlens/shared";

/**
 * Turn a selected <img> into a structured product, in priority order:
 *   1. schema.org Product JSON-LD   2. Open Graph / product meta tags
 *   3. text near the image (product card)   4. image + page title fallback
 * Page content is untrusted data: it is parsed, cleaned and length-capped,
 * and never evaluated or inserted as HTML.
 */

export function bestImageUrl(img: HTMLImageElement): string | null {
  const candidates: { url: string; w: number }[] = [];
  const srcset = img.getAttribute("srcset") || img.closest("picture")?.querySelector("source")?.getAttribute("srcset") || "";
  for (const part of srcset.split(",")) {
    const [url, size] = part.trim().split(/\s+/);
    if (!url) continue;
    candidates.push({ url, w: size?.endsWith("w") ? Number.parseInt(size, 10) : size?.endsWith("x") ? Number.parseFloat(size) * 1000 : 0 });
  }
  candidates.sort((a, b) => b.w - a.w);
  const raw = candidates[0]?.url || img.currentSrc || img.src || img.getAttribute("data-src") || "";
  try {
    const u = new URL(raw, location.href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function jsonLdRoots(doc: Document): unknown[] {
  const roots: unknown[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    const text = s.textContent;
    if (!text || text.length > 500_000) return;
    try {
      roots.push(JSON.parse(text));
    } catch {
      /* malformed JSON-LD is common; skip it */
    }
  });
  return roots;
}

function meta(doc: Document, ...names: string[]): string | undefined {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
    const v = el?.getAttribute("content");
    if (v) return cleanText(v);
  }
  return undefined;
}

const PRICE_RE = /(?:[$€£¥₹]|USD|EUR|GBP|INR|CAD|AUD)\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£₹]|USD|EUR|GBP|INR)/;

/** Find the smallest ancestor that looks like a product card (has a heading/name and a price). */
function productCard(img: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = img;
  for (let i = 0; i < 6 && el; i++) {
    el = el.parentElement;
    if (!el) break;
    const text = el.innerText || "";
    if (text.length > 1500) break;
    if (PRICE_RE.test(text)) return el;
  }
  return null;
}

function nearbyProduct(img: HTMLImageElement): ExtractedProduct | null {
  const card = productCard(img);
  if (!card) return null;
  const heading = card.querySelector("h1, h2, h3, h4, [itemprop=name], [class*='title' i], [class*='name' i]") as HTMLElement | null;
  const name = cleanText(heading?.innerText) ?? cleanText(img.alt);
  const priceText = (card.innerText.match(PRICE_RE) ?? [])[0];
  const brandEl = card.querySelector("[itemprop=brand], [class*='brand' i]") as HTMLElement | null;
  const selectedSize = card.querySelector("[aria-pressed='true'][data-size], [aria-checked='true'][data-size], option:checked") as HTMLElement | null;
  return {
    name,
    brand: cleanText(brandEl?.innerText, 120),
    price: parsePrice(priceText) ?? undefined,
    size: cleanText(selectedSize?.getAttribute("data-size") ?? undefined, 30),
    images: []
  };
}

export function extractProduct(img: HTMLImageElement, doc: Document = document): SelectedProductInput | { error: string } {
  const imageUrl = bestImageUrl(img);
  if (!imageUrl) return { error: "This image can't be imported (it isn't a regular web image). Save it and upload it in FitLens instead." };

  const fromLd = bestJsonLdProduct(jsonLdRoots(doc), imageUrl);
  // Only trust page-level JSON-LD for this image if it plausibly describes it.
  const ldMatchesImage = !!fromLd && (fromLd.images.some((i) => imageKey(i) === imageKey(imageUrl)) || jsonLdProductCount(doc) === 1);
  const near = nearbyProduct(img);

  let method: SelectedProductInput["extractionMethod"] = "nearby-text";
  let confidence = 0.45;
  let p: ExtractedProduct = { images: [] };
  if (fromLd && ldMatchesImage) {
    p = { ...fromLd, size: fromLd.size ?? near?.size };
    method = "json-ld";
    confidence = fromLd.images.some((i) => imageKey(i) === imageKey(imageUrl)) ? 0.95 : 0.8;
  } else {
    const ogTitle = meta(doc, "og:title", "twitter:title");
    const ogPrice = meta(doc, "product:price:amount", "og:price:amount", "price");
    const ogCurrency = meta(doc, "product:price:currency", "og:price:currency", "priceCurrency") ?? "USD";
    const ogImage = meta(doc, "og:image");
    if (ogTitle && ogImage && imageKey(new URL(ogImage, location.href).toString()) === imageKey(imageUrl)) {
      p = { name: ogTitle, brand: meta(doc, "product:brand", "og:brand"), price: parsePrice(ogPrice, ogCurrency.toUpperCase()) ?? undefined, images: [] };
      method = "open-graph";
      confidence = 0.7;
    } else if (near?.name) {
      p = near;
    } else {
      p = { name: cleanText(img.alt) ?? cleanText(doc.title), images: [] };
      confidence = 0.3;
    }
  }

  const name = p.name ?? "Selected garment";
  const productUrl = p.url && /^https?:/.test(p.url) ? p.url : location.href;
  return {
    name: name.slice(0, 300),
    brand: p.brand,
    category: inferCategory(name, p.description, img.alt),
    color: p.color,
    size: p.size,
    styleNumber: p.styleNumber,
    gtin: p.gtin,
    sku: p.sku,
    description: p.description,
    imageUrl,
    productUrl: productUrl.slice(0, 2048),
    retailerDomain: location.hostname || "unknown",
    price: p.price,
    extractionMethod: method,
    extractionConfidence: confidence
  };
}

function jsonLdProductCount(doc: Document): number {
  let n = 0;
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    if (/"@type"\s*:\s*\[?\s*"Product"/.test(s.textContent ?? "")) n++;
  });
  return n;
}

export function isCandidateImage(img: HTMLImageElement): boolean {
  const r = img.getBoundingClientRect();
  if (r.width < 120 || r.height < 120) return false;
  if (img.naturalWidth && img.naturalWidth < 150) return false;
  const style = getComputedStyle(img);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1;
}
