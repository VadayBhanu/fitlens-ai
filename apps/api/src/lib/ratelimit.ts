import { ErrorCode } from "@fitlens/shared";
import type { Env } from "../env";
import { ApiError } from "./http";

/** Fixed-window rate limiter backed by D1 (works on the free plan). */
export async function rateLimit(env: Env, bucket: string, limit: number, windowSeconds: number): Promise<void> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
     RETURNING count`
  )
    .bind(bucket, windowStart)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit) {
    throw new ApiError(ErrorCode.RATE_LIMITED, undefined, { retryAfterSeconds: windowStart + windowSeconds - Math.floor(Date.now() / 1000) }, true);
  }
}

export async function purgeOldRateLimits(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(Math.floor(Date.now() / 1000) - 86_400).run();
}
