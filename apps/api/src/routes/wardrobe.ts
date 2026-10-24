import { CreateWardrobeItemInput, ErrorCode, type WardrobeItemDTO } from "@fitlens/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getOwnedAsset } from "../lib/assets";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { ApiError, nowIso, parseJson } from "../lib/http";
import { getOwnedProduct } from "../lib/products";
import { apiOrigin, signedAssetUrl } from "../lib/signing";

export const wardrobeRoutes = new Hono<AppEnv>();
wardrobeRoutes.use("*", requireAuth);

wardrobeRoutes.get("/", async (c) => {
  const user = c.get("user");
  const origin = apiOrigin(c.env, c.req.url);
  const { results } = await c.env.DB.prepare(
    `SELECT w.*, p.name AS p_name, p.brand AS p_brand, p.image_url AS p_image, p.product_url AS p_url, p.retailer_domain AS p_domain,
            p.price_minor AS p_price, p.currency AS p_currency, a.mime_type AS a_mime, a.deleted_at AS a_deleted
       FROM wardrobe_items w
       LEFT JOIN products p ON p.id = w.product_id
       LEFT JOIN assets a ON a.id = w.media_asset_id
      WHERE w.user_id = ?1
      ORDER BY w.created_at DESC LIMIT 200`
  )
    .bind(user.id)
    .all<Record<string, unknown>>();
  const items: WardrobeItemDTO[] = await Promise.all(
    results.map(async (r) => ({
      id: String(r.id),
      kind: r.kind as WardrobeItemDTO["kind"],
      note: (r.note as string | null) ?? null,
      product: r.product_id && r.p_name
        ? {
            id: String(r.product_id),
            name: String(r.p_name),
            brand: (r.p_brand as string | null) ?? null,
            imageUrl: String(r.p_image),
            productUrl: String(r.p_url),
            retailerDomain: String(r.p_domain),
            price: r.p_price !== null && r.p_currency ? { amountMinor: Number(r.p_price), currency: String(r.p_currency) } : null
          }
        : null,
      media: r.media_asset_id && !r.a_deleted
        ? { assetId: String(r.media_asset_id), url: await signedAssetUrl(c.env, origin, String(r.media_asset_id)), mimeType: String(r.a_mime) }
        : null,
      createdAt: String(r.created_at)
    }))
  );
  return c.json({ items });
});

wardrobeRoutes.post("/", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, CreateWardrobeItemInput);
  if (input.productId) await getOwnedProduct(c.env, user.id, input.productId);
  if (input.mediaAssetId) {
    const asset = await getOwnedAsset(c.env, user.id, input.mediaAssetId);
    if (asset.purpose === "person") throw new ApiError(ErrorCode.VALIDATION_FAILED, "Source photos can't be added to the wardrobe directly.");
  }
  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO wardrobe_items (id, user_id, kind, product_id, media_asset_id, tryon_id, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
  )
    .bind(id, user.id, input.kind, input.productId ?? null, input.mediaAssetId ?? null, input.tryOnId ?? null, input.note ?? null, now)
    .run();
  return c.json({ id, createdAt: now }, 201);
});

wardrobeRoutes.delete("/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM wardrobe_items WHERE id = ?1 AND user_id = ?2").bind(c.req.param("id"), c.get("user").id).run();
  if (!res.meta.changes) throw new ApiError(ErrorCode.NOT_FOUND);
  return c.body(null, 204);
});
