import { CreateTryOnInput, ErrorCode } from "@fitlens/shared";
import { Hono } from "hono";
import { intVar, type AppEnv } from "../env";
import { getOwnedAsset } from "../lib/assets";
import { audit, recordUsage, usageToday } from "../lib/audit";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { ApiError, nowIso, parseJson } from "../lib/http";
import { getOwnedProduct } from "../lib/products";
import { rateLimit } from "../lib/ratelimit";
import { apiOrigin } from "../lib/signing";
import { getOwnedJob, jobDto, loadJob, refreshJob, submitJob, type TryOnRow } from "../jobs/tryon";
import { tryOnProvider } from "../providers/tryon";

export const tryOnRoutes = new Hono<AppEnv>();
tryOnRoutes.use("*", requireAuth);

async function assertCanGenerate(c: { env: AppEnv["Bindings"] }, userId: string): Promise<void> {
  const consent = await c.env.DB.prepare("SELECT id FROM consents WHERE user_id = ?1 AND purpose = 'cloud_tryon' AND revoked_at IS NULL")
    .bind(userId)
    .first();
  if (!consent) throw new ApiError(ErrorCode.CONSENT_REQUIRED);
  const limit = intVar(c.env.FREE_DAILY_TRYONS, 10);
  if ((await usageToday(c.env, userId, "tryon")) >= limit) throw new ApiError(ErrorCode.QUOTA_EXHAUSTED);
  const active = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tryon_jobs WHERE user_id = ?1 AND status IN ('queued', 'processing')")
    .bind(userId)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= intVar(c.env.MAX_ACTIVE_TRYONS, 2)) {
    throw new ApiError(ErrorCode.RATE_LIMITED, "Please wait for your current try-on to finish.", undefined, true);
  }
}

tryOnRoutes.post("/", async (c) => {
  const user = c.get("user");
  const origin = apiOrigin(c.env, c.req.url);
  const idem = c.req.header("idempotency-key")?.slice(0, 100) ?? null;
  if (idem) {
    const prior = await c.env.DB.prepare("SELECT * FROM tryon_jobs WHERE user_id = ?1 AND idempotency_key = ?2").bind(user.id, idem).first<TryOnRow>();
    if (prior) return c.json(await jobDto(c.env, origin, prior), 200);
  }
  const input = await parseJson(c, CreateTryOnInput);
  if (!tryOnProvider(c.env).configured) throw new ApiError(ErrorCode.PROVIDER_NOT_CONFIGURED);
  await rateLimit(c.env, `tryon:${user.id}`, 20, 3600);
  await assertCanGenerate(c, user.id);

  const person = await getOwnedAsset(c.env, user.id, input.personAssetId);
  const garment = await getOwnedAsset(c.env, user.id, input.garmentAssetId);
  if (person.purpose !== "person") throw new ApiError(ErrorCode.VALIDATION_FAILED, "personAssetId must reference a person photo.");
  if (garment.purpose !== "garment") throw new ApiError(ErrorCode.VALIDATION_FAILED, "garmentAssetId must reference a garment image.");
  if (input.productId) await getOwnedProduct(c.env, user.id, input.productId);

  const warnings: string[] = [];
  const q = input.inputQuality;
  if (q) {
    if (Math.min(q.width, q.height) < 640) warnings.push("Your photo is low resolution, so fine details may be soft.");
    if (q.brightness < 70) warnings.push("Your photo is dark, which can affect color accuracy.");
    if (q.sharpness < 60) warnings.push("Your photo may be slightly blurry.");
  }
  if (input.category === "other") warnings.push("We couldn't identify the garment type, so the AI chose automatically.");

  const now = nowIso();
  const job: TryOnRow = {
    id: newId(),
    user_id: user.id,
    product_id: input.productId ?? null,
    person_asset_id: person.id,
    garment_asset_id: garment.id,
    quality: input.quality,
    category: input.category,
    status: "queued",
    provider: tryOnProvider(c.env).name,
    provider_job_id: null,
    idempotency_key: idem,
    warnings_json: JSON.stringify(warnings),
    error_code: null,
    error_message: null,
    retryable: 0,
    attempts: 0,
    result_media_id: null,
    created_at: now,
    updated_at: now,
    submitted_at: null,
    last_polled_at: null
  };
  try {
    await c.env.DB.prepare(
      `INSERT INTO tryon_jobs (id, user_id, product_id, person_asset_id, garment_asset_id, quality, category, status, provider, idempotency_key, warnings_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', ?8, ?9, ?10, ?11, ?11)`
    )
      .bind(job.id, user.id, job.product_id, job.person_asset_id, job.garment_asset_id, job.quality, job.category, job.provider, idem, job.warnings_json, now)
      .run();
  } catch (e) {
    // Lost an idempotency race — return the winner.
    if (idem && /UNIQUE/i.test(String(e))) {
      const prior = await c.env.DB.prepare("SELECT * FROM tryon_jobs WHERE user_id = ?1 AND idempotency_key = ?2").bind(user.id, idem).first<TryOnRow>();
      if (prior) return c.json(await jobDto(c.env, origin, prior), 200);
    }
    throw e;
  }
  await recordUsage(c.env, user.id, "tryon");
  await audit(c.env, user.id, "tryon.create", "tryon", job.id);
  const submitted = await submitJob(c.env, origin, job);
  return c.json(await jobDto(c.env, origin, submitted), 202);
});

tryOnRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM tryon_jobs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 30")
    .bind(c.get("user").id)
    .all<TryOnRow>();
  const origin = apiOrigin(c.env, c.req.url);
  return c.json({ tryOns: await Promise.all(results.map((j) => jobDto(c.env, origin, j))) });
});

tryOnRoutes.get("/:id", async (c) => {
  const origin = apiOrigin(c.env, c.req.url);
  let job = await getOwnedJob(c.env, c.get("user").id, c.req.param("id"));
  job = await refreshJob(c.env, origin, job);
  return c.json(await jobDto(c.env, origin, job));
});

tryOnRoutes.post("/:id/retry", async (c) => {
  const user = c.get("user");
  const origin = apiOrigin(c.env, c.req.url);
  const job = await getOwnedJob(c.env, user.id, c.req.param("id"));
  if (!["failed", "expired"].includes(job.status) || job.retryable !== 1) {
    throw new ApiError(ErrorCode.CONFLICT, "Only failed jobs that can be retried may be retried.");
  }
  if (job.attempts >= 3) throw new ApiError(ErrorCode.CONFLICT, "This try-on has already been retried the maximum number of times.");
  await assertCanGenerate(c, user.id);
  await c.env.DB.prepare("UPDATE tryon_jobs SET status = 'queued', provider_job_id = NULL, last_polled_at = NULL, updated_at = ?1 WHERE id = ?2")
    .bind(nowIso(), job.id)
    .run();
  const submitted = await submitJob(c.env, origin, (await loadJob(c.env, job.id))!);
  return c.json(await jobDto(c.env, origin, submitted), 202);
});

tryOnRoutes.post("/:id/cancel", async (c) => {
  const job = await getOwnedJob(c.env, c.get("user").id, c.req.param("id"));
  if (job.status === "queued" || job.status === "processing") {
    await c.env.DB.prepare("UPDATE tryon_jobs SET status = 'cancelled', updated_at = ?1 WHERE id = ?2").bind(nowIso(), job.id).run();
  }
  return c.json(await jobDto(c.env, apiOrigin(c.env, c.req.url), (await loadJob(c.env, job.id))!));
});
