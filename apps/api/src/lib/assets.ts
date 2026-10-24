import { ErrorCode, type AssetDTO, type AssetPurpose } from "@fitlens/shared";
import type { Env } from "../env";
import { newId, sha256Hex } from "./crypto";
import { ApiError, addHours, nowIso } from "./http";
import { IMAGE_MIMES, VIDEO_MIMES, validateMedia, type SupportedMime } from "./media";
import { signedAssetUrl } from "./signing";
import { blobStore } from "./storage";
import { intVar } from "../env";

export interface AssetRow {
  id: string;
  user_id: string;
  object_key: string;
  mime_type: string;
  bytes: number;
  purpose: AssetPurpose;
  width: number | null;
  height: number | null;
  created_at: string;
  expires_at: string | null;
  deleted_at: string | null;
}

export function allowedMimesFor(purpose: AssetPurpose): SupportedMime[] {
  return purpose === "recording" || purpose === "reel" ? [...VIDEO_MIMES, ...IMAGE_MIMES] : IMAGE_MIMES;
}

export async function storeAsset(
  env: Env,
  userId: string,
  purpose: AssetPurpose,
  bytes: Uint8Array,
  opts: { sourceUrl?: string; keep?: boolean } = {}
): Promise<AssetRow> {
  const v = validateMedia(bytes, allowedMimesFor(purpose));
  if ("error" in v) {
    if (v.error === "too_large") throw new ApiError(ErrorCode.PAYLOAD_TOO_LARGE);
    if (v.error === "bad_dimensions") throw new ApiError(ErrorCode.UNSUPPORTED_MEDIA, "Image dimensions must be between 64 and 12000 pixels.");
    throw new ApiError(ErrorCode.UNSUPPORTED_MEDIA);
  }
  const id = newId();
  const ext = v.mime.split("/")[1];
  const key = `u/${userId}/${purpose}/${id}.${ext}`;
  await blobStore(env).put(key, bytes, v.mime);
  // Person photos are temporary unless the user explicitly keeps them.
  const expiresAt = purpose === "person" && !opts.keep ? addHours(intVar(env.TEMP_PHOTO_RETENTION_HOURS, 24)) : null;
  const row: AssetRow = {
    id,
    user_id: userId,
    object_key: key,
    mime_type: v.mime,
    bytes: bytes.byteLength,
    purpose,
    width: v.width,
    height: v.height,
    created_at: nowIso(),
    expires_at: expiresAt,
    deleted_at: null
  };
  await env.DB.prepare(
    `INSERT INTO assets (id, user_id, object_key, mime_type, bytes, sha256, purpose, width, height, source_url, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
  )
    .bind(id, userId, key, v.mime, bytes.byteLength, await sha256Hex(bytes), purpose, v.width, v.height, opts.sourceUrl ?? null, row.created_at, expiresAt)
    .run();
  return row;
}

export async function getOwnedAsset(env: Env, userId: string, assetId: string): Promise<AssetRow> {
  const row = await env.DB.prepare("SELECT * FROM assets WHERE id = ?1 AND deleted_at IS NULL").bind(assetId).first<AssetRow>();
  // Same response for "missing" and "not yours" so IDs can't be probed.
  if (!row || row.user_id !== userId) throw new ApiError(ErrorCode.NOT_FOUND);
  return row;
}

export async function assetDto(env: Env, origin: string, row: AssetRow): Promise<AssetDTO> {
  return {
    id: row.id,
    purpose: row.purpose,
    mimeType: row.mime_type,
    bytes: row.bytes,
    url: await signedAssetUrl(env, origin, row.id),
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

export async function deleteAsset(env: Env, row: AssetRow): Promise<void> {
  await blobStore(env).delete(row.object_key);
  await env.DB.prepare("UPDATE assets SET deleted_at = ?1 WHERE id = ?2").bind(nowIso(), row.id).run();
}

export async function readAssetBytes(env: Env, row: AssetRow): Promise<Uint8Array> {
  const obj = await blobStore(env).get(row.object_key);
  if (!obj) throw new ApiError(ErrorCode.NOT_FOUND);
  return new Uint8Array(await new Response(obj.body).arrayBuffer());
}
