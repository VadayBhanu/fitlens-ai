import { AssetPurpose, ErrorCode } from "@fitlens/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { assetDto, deleteAsset, getOwnedAsset, storeAsset, type AssetRow } from "../lib/assets";
import { audit } from "../lib/audit";
import { requireAuth } from "../lib/auth";
import { ApiError } from "../lib/http";
import { MAX_VIDEO_BYTES } from "../lib/media";
import { rateLimit } from "../lib/ratelimit";
import { apiOrigin, verifyAssetSignature } from "../lib/signing";
import { blobStore } from "../lib/storage";

export const assetRoutes = new Hono<AppEnv>();

/** Upload raw bytes: POST /v1/assets?purpose=person[&keep=1] with the file as the body. */
assetRoutes.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  await rateLimit(c.env, `upload:${user.id}`, 120, 3600);
  const purpose = AssetPurpose.safeParse(c.req.query("purpose"));
  if (!purpose.success) throw new ApiError(ErrorCode.VALIDATION_FAILED, "purpose must be one of person, garment, capture, recording, reel.");
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_VIDEO_BYTES) throw new ApiError(ErrorCode.PAYLOAD_TOO_LARGE);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.byteLength) throw new ApiError(ErrorCode.BAD_REQUEST, "Empty upload.");
  const row = await storeAsset(c.env, user.id, purpose.data, bytes, { keep: c.req.query("keep") === "1" });
  await audit(c.env, user.id, "asset.upload", "asset", row.id);
  return c.json(await assetDto(c.env, apiOrigin(c.env, c.req.url), row), 201);
});

assetRoutes.get("/:id", requireAuth, async (c) => {
  const row = await getOwnedAsset(c.env, c.get("user").id, c.req.param("id"));
  return c.json(await assetDto(c.env, apiOrigin(c.env, c.req.url), row));
});

/** Keep a temporary person photo (removes its auto-delete expiry). */
assetRoutes.post("/:id/keep", requireAuth, async (c) => {
  const row = await getOwnedAsset(c.env, c.get("user").id, c.req.param("id"));
  await c.env.DB.prepare("UPDATE assets SET expires_at = NULL WHERE id = ?1").bind(row.id).run();
  return c.json(await assetDto(c.env, apiOrigin(c.env, c.req.url), { ...row, expires_at: null }));
});

assetRoutes.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const row = await getOwnedAsset(c.env, user.id, c.req.param("id"));
  await deleteAsset(c.env, row);
  await c.env.DB.prepare("DELETE FROM wardrobe_items WHERE user_id = ?1 AND media_asset_id = ?2").bind(user.id, row.id).run();
  await audit(c.env, user.id, "asset.delete", "asset", row.id);
  return c.body(null, 204);
});

/** Public, signature-protected file delivery: GET /v1/files/:id?exp=&sig= */
export const fileRoutes = new Hono<AppEnv>();

fileRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const ok = await verifyAssetSignature(c.env, id, c.req.query("exp"), c.req.query("sig"));
  if (!ok) throw new ApiError(ErrorCode.FORBIDDEN, "This media link has expired.");
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ?1 AND deleted_at IS NULL").bind(id).first<AssetRow>();
  if (!row) throw new ApiError(ErrorCode.NOT_FOUND);
  const obj = await blobStore(c.env).get(row.object_key);
  if (!obj) throw new ApiError(ErrorCode.NOT_FOUND);
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.mime_type,
      "Cache-Control": "private, max-age=900",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline"
    }
  });
});
