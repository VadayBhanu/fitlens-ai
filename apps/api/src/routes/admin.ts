import { ErrorCode, HttpsUrl, Money } from "@fitlens/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { newId, sha256Hex, timingSafeEqual } from "../lib/crypto";
import { ApiError, nowIso, parseJson } from "../lib/http";

/**
 * Operator-only ingestion of authorized retailer feeds and reviews.
 * Protected by ADMIN_TOKEN; disabled entirely when the secret is unset.
 */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  const got = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/, "");
  if (!expected || expected.length < 16 || !timingSafeEqual(await sha256Hex(got), await sha256Hex(expected))) {
    throw new ApiError(ErrorCode.FORBIDDEN);
  }
  await next();
});

const Retailer = z.object({
  name: z.string().min(1).max(120),
  domain: z.string().min(3).max(253),
  returnPolicy: z.string().max(300).optional(),
  verificationStatus: z.enum(["unverified", "verified"]).default("unverified")
});

const CatalogFeed = z.object({
  retailer: Retailer,
  isDemo: z.boolean().default(false),
  items: z
    .array(
      z.object({
        externalId: z.string().min(1).max(120),
        title: z.string().min(1).max(300),
        brand: z.string().max(120).optional(),
        styleNumber: z.string().max(80).optional(),
        gtin: z.string().regex(/^\d{8,14}$/).optional(),
        color: z.string().max(60).optional(),
        size: z.string().max(30).optional(),
        productUrl: HttpsUrl,
        imageUrl: HttpsUrl.optional(),
        price: Money,
        shippingMinor: z.number().int().nonnegative().optional(),
        available: z.boolean().optional()
      })
    )
    .max(500)
});

async function upsertRetailer(env: AppEnv["Bindings"], r: z.infer<typeof Retailer>): Promise<string> {
  const domain = r.domain.toLowerCase().replace(/^www\./, "");
  const existing = await env.DB.prepare("SELECT id FROM retailers WHERE domain = ?1").bind(domain).first<{ id: string }>();
  const id = existing?.id ?? newId();
  await env.DB.prepare(
    `INSERT INTO retailers (id, name, domain, verification_status, return_policy, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(domain) DO UPDATE SET name = excluded.name, verification_status = excluded.verification_status, return_policy = excluded.return_policy`
  )
    .bind(id, r.name, domain, r.verificationStatus, r.returnPolicy ?? null, nowIso())
    .run();
  return id;
}

adminRoutes.post("/catalog", async (c) => {
  const feed = await parseJson(c, CatalogFeed);
  const retailerId = await upsertRetailer(c.env, feed.retailer);
  const now = nowIso();
  const stmts = feed.items.map((i) =>
    c.env.DB.prepare(
      `INSERT INTO catalog_items (id, retailer_id, external_id, title, brand, style_number, gtin, color, size, product_url, image_url,
                                  price_minor, currency, shipping_minor, available, is_demo, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
       ON CONFLICT(retailer_id, external_id) DO UPDATE SET title = excluded.title, brand = excluded.brand, style_number = excluded.style_number,
         gtin = excluded.gtin, color = excluded.color, size = excluded.size, product_url = excluded.product_url, image_url = excluded.image_url,
         price_minor = excluded.price_minor, currency = excluded.currency, shipping_minor = excluded.shipping_minor,
         available = excluded.available, is_demo = excluded.is_demo, updated_at = excluded.updated_at`
    ).bind(
      newId(),
      retailerId,
      i.externalId,
      i.title,
      i.brand ?? null,
      i.styleNumber ?? null,
      i.gtin ?? null,
      i.color ?? null,
      i.size ?? null,
      i.productUrl,
      i.imageUrl ?? null,
      i.price.amountMinor,
      i.price.currency,
      i.shippingMinor ?? null,
      i.available === undefined ? null : i.available ? 1 : 0,
      feed.isDemo ? 1 : 0,
      now
    )
  );
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return c.json({ retailerId, upserted: stmts.length });
});

const ReviewFeed = z.object({
  retailer: Retailer.optional(),
  isDemo: z.boolean().default(false),
  reviews: z
    .array(
      z.object({
        brand: z.string().max(120).optional(),
        styleNumber: z.string().max(80).optional(),
        gtin: z.string().regex(/^\d{8,14}$/).optional(),
        rating: z.number().min(1).max(5),
        title: z.string().max(200).optional(),
        body: z.string().min(1).max(5000),
        author: z.string().max(80).optional(),
        sourceUrl: HttpsUrl.optional(),
        publishedAt: z.string().datetime().optional()
      })
    )
    .max(1000)
});

adminRoutes.post("/reviews", async (c) => {
  const feed = await parseJson(c, ReviewFeed);
  const retailerId = feed.retailer ? await upsertRetailer(c.env, feed.retailer) : null;
  const now = nowIso();
  const stmts = feed.reviews.map((r) =>
    c.env.DB.prepare(
      `INSERT INTO reviews (id, retailer_id, brand, style_number, gtin, rating, title, body, author, source_url, is_demo, published_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
    ).bind(newId(), retailerId, r.brand ?? null, r.styleNumber ?? null, r.gtin ?? null, r.rating, r.title ?? null, r.body, r.author ?? null, r.sourceUrl ?? null, feed.isDemo ? 1 : 0, r.publishedAt ?? null, now)
  );
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return c.json({ inserted: stmts.length });
});
