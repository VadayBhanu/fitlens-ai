import { ErrorCode, type TryOnDTO } from "@fitlens/shared";
import { allowPrivateHosts, type Env } from "../env";
import { getOwnedAsset, readAssetBytes, storeAsset, type AssetRow } from "../lib/assets";
import { recordUsage } from "../lib/audit";
import { bytesToBase64, newId } from "../lib/crypto";
import { ApiError, nowIso } from "../lib/http";
import { signedAssetUrl } from "../lib/signing";
import { safeFetchBytes } from "../lib/ssrf";
import { ProviderError, tryOnProvider } from "../providers/tryon";

export interface TryOnRow {
  id: string;
  user_id: string;
  product_id: string | null;
  person_asset_id: string;
  garment_asset_id: string;
  quality: TryOnDTO["quality"];
  category: TryOnDTO["category"];
  status: TryOnDTO["status"];
  provider: string;
  provider_job_id: string | null;
  idempotency_key: string | null;
  warnings_json: string;
  error_code: string | null;
  error_message: string | null;
  retryable: number;
  attempts: number;
  result_media_id: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  last_polled_at: string | null;
}

/** Jobs with no provider progress after this long are expired. */
const JOB_TIMEOUT_MS = 10 * 60_000;
/** Minimum spacing between provider polls for one job. */
const POLL_SPACING_MS = 2_500;

function isLocalOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost");
  } catch {
    return true;
  }
}

/**
 * Give the provider a way to read a private asset: a short-lived signed URL in
 * production, or an inline data URL when running on localhost (the provider
 * cannot reach a developer's machine).
 */
async function providerImageRef(env: Env, origin: string, asset: AssetRow): Promise<string> {
  if (!isLocalOrigin(origin)) return signedAssetUrl(env, origin, asset.id, 900);
  const bytes = await readAssetBytes(env, asset);
  return `data:${asset.mime_type};base64,${bytesToBase64(bytes)}`;
}

async function update(env: Env, id: string, fields: Partial<TryOnRow>): Promise<void> {
  const entries = Object.entries({ ...fields, updated_at: nowIso() });
  const sets = entries.map(([k], i) => `${k} = ?${i + 2}`).join(", ");
  await env.DB.prepare(`UPDATE tryon_jobs SET ${sets} WHERE id = ?1`)
    .bind(id, ...entries.map(([, v]) => v ?? null))
    .run();
}

export async function loadJob(env: Env, id: string): Promise<TryOnRow | null> {
  return env.DB.prepare("SELECT * FROM tryon_jobs WHERE id = ?1").bind(id).first<TryOnRow>();
}

export async function submitJob(env: Env, origin: string, job: TryOnRow): Promise<TryOnRow> {
  const provider = tryOnProvider(env);
  const person = await getOwnedAsset(env, job.user_id, job.person_asset_id);
  const garment = await getOwnedAsset(env, job.user_id, job.garment_asset_id);
  try {
    const { providerJobId } = await provider.createJob({
      personImage: await providerImageRef(env, origin, person),
      garmentImage: await providerImageRef(env, origin, garment),
      quality: job.quality,
      category: job.category
    });
    const now = nowIso();
    await update(env, job.id, { status: "processing", provider_job_id: providerJobId, submitted_at: now, attempts: job.attempts + 1, error_code: null, error_message: null, retryable: 0 });
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError((e as Error).message, true);
    await update(env, job.id, {
      status: "failed",
      attempts: job.attempts + 1,
      error_code: pe.notConfigured ? ErrorCode.PROVIDER_NOT_CONFIGURED : pe.retryable ? ErrorCode.PROVIDER_UNAVAILABLE : ErrorCode.GENERATION_FAILED,
      error_message: pe.message.slice(0, 500),
      retryable: pe.retryable ? 1 : 0
    });
  }
  return (await loadJob(env, job.id))!;
}

/**
 * Advance a processing job by polling its provider. Safe to call repeatedly
 * from request handlers and the cron reconciler; it is throttled per job and
 * the completion write is guarded so a result is stored once.
 */
export async function refreshJob(env: Env, origin: string, job: TryOnRow): Promise<TryOnRow> {
  if (job.status !== "processing" || !job.provider_job_id) return job;
  if (job.last_polled_at && Date.now() - Date.parse(job.last_polled_at) < POLL_SPACING_MS) return job;

  if (job.submitted_at && Date.now() - Date.parse(job.submitted_at) > JOB_TIMEOUT_MS) {
    await update(env, job.id, { status: "expired", error_code: ErrorCode.PROVIDER_UNAVAILABLE, error_message: "The try-on took too long and was stopped.", retryable: 1 });
    return (await loadJob(env, job.id))!;
  }

  // Claim this poll so concurrent requests don't all hit the provider.
  const claimed = await env.DB.prepare(
    "UPDATE tryon_jobs SET last_polled_at = ?1 WHERE id = ?2 AND status = 'processing' AND (last_polled_at IS NULL OR last_polled_at = ?3)"
  )
    .bind(nowIso(), job.id, job.last_polled_at)
    .run();
  if (!claimed.meta.changes) return (await loadJob(env, job.id)) ?? job;

  const provider = tryOnProvider(env);
  let state;
  try {
    state = await provider.getJob(job.provider_job_id);
  } catch (e) {
    if (e instanceof ProviderError && !e.retryable) {
      await update(env, job.id, { status: "failed", error_code: ErrorCode.PROVIDER_UNAVAILABLE, error_message: e.message.slice(0, 500), retryable: 0 });
    }
    return (await loadJob(env, job.id))!;
  }

  if (state.state === "failed") {
    await update(env, job.id, { status: "failed", error_code: ErrorCode.GENERATION_FAILED, error_message: state.message.slice(0, 500), retryable: state.retryable ? 1 : 0 });
  } else if (state.state === "done") {
    await finalizeJob(env, job, state.outputUrl, provider.creditsFor(job.quality));
  }
  return (await loadJob(env, job.id))!;
}

async function finalizeJob(env: Env, job: TryOnRow, outputUrl: string, credits: number): Promise<void> {
  const warnings: string[] = JSON.parse(job.warnings_json || "[]");
  let asset: AssetRow;
  try {
    // Provider CDN links expire; copy the result into our private storage.
    // Output must pass the same signature/dimension validation as uploads.
    const { bytes } = await safeFetchBytes(outputUrl, { allowPrivate: allowPrivateHosts(env) });
    asset = await storeAsset(env, job.user_id, "capture", bytes, { sourceUrl: "provider:" + job.provider });
  } catch (e) {
    await update(env, job.id, {
      status: "failed",
      error_code: ErrorCode.GENERATION_FAILED,
      error_message: `The generated image could not be saved: ${(e as Error).message}`.slice(0, 500),
      retryable: 1
    });
    return;
  }
  const person = await env.DB.prepare("SELECT width, height FROM assets WHERE id = ?1").bind(job.person_asset_id).first<{ width: number | null; height: number | null }>();
  if (person?.width && person.height && asset.width && asset.height) {
    const inAspect = person.width / person.height;
    const outAspect = asset.width / asset.height;
    if (Math.abs(inAspect - outAspect) / inAspect > 0.08) warnings.push("The result was reframed compared with your photo.");
  }
  warnings.push("AI-generated preview: check the garment's color, logo and details against the product photos before buying.");

  const mediaId = newId();
  const now = nowIso();
  // Guarded transition: only one caller can move processing → completed.
  const res = await env.DB.prepare(
    "UPDATE tryon_jobs SET status = 'completed', result_media_id = ?1, warnings_json = ?2, updated_at = ?3 WHERE id = ?4 AND status = 'processing'"
  )
    .bind(mediaId, JSON.stringify(warnings), now, job.id)
    .run();
  if (!res.meta.changes) return;
  await env.DB.prepare("INSERT INTO rendered_media (id, user_id, job_id, kind, asset_id, metadata_json, created_at) VALUES (?1, ?2, ?3, 'tryon', ?4, ?5, ?6)")
    .bind(mediaId, job.user_id, job.id, asset.id, JSON.stringify({ provider: job.provider, quality: job.quality }), now)
    .run();
  await recordUsage(env, job.user_id, "provider_credits", credits, credits);
}

export async function jobDto(env: Env, origin: string, job: TryOnRow): Promise<TryOnDTO> {
  let result: TryOnDTO["result"] = null;
  if (job.result_media_id) {
    const media = await env.DB.prepare("SELECT asset_id FROM rendered_media WHERE id = ?1").bind(job.result_media_id).first<{ asset_id: string }>();
    if (media) result = { mediaId: job.result_media_id, assetId: media.asset_id, url: await signedAssetUrl(env, origin, media.asset_id) };
  }
  return {
    id: job.id,
    status: job.status,
    quality: job.quality,
    category: job.category,
    productId: job.product_id,
    personAssetId: job.person_asset_id,
    garmentAssetId: job.garment_asset_id,
    result,
    warnings: JSON.parse(job.warnings_json || "[]"),
    error: job.error_code ? { code: job.error_code, message: job.error_message ?? "", retryable: job.retryable === 1 } : null,
    createdAt: job.created_at,
    updatedAt: job.updated_at
  };
}

export async function getOwnedJob(env: Env, userId: string, id: string): Promise<TryOnRow> {
  const job = await loadJob(env, id);
  if (!job || job.user_id !== userId) throw new ApiError(ErrorCode.NOT_FOUND);
  return job;
}

/** Cron: advance in-flight jobs and expire stuck ones. */
export async function reconcileJobs(env: Env, origin: string): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM tryon_jobs WHERE status IN ('queued', 'processing') ORDER BY updated_at ASC LIMIT 25"
  ).all<TryOnRow>();
  for (const job of results) {
    if (job.status === "queued" && Date.now() - Date.parse(job.created_at) > 120_000) {
      // Queued jobs are submitted inline; one stuck here means the request died.
      await update(env, job.id, { status: "failed", error_code: ErrorCode.INTERNAL, error_message: "The job was interrupted before submission.", retryable: 1 });
      continue;
    }
    await refreshJob(env, origin, job);
  }
}
