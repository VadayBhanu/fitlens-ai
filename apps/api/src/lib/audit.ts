import type { Env } from "../env";
import { newId, sha256Hex } from "./crypto";
import { nowIso } from "./http";

export async function audit(env: Env, actorId: string | null, action: string, objectType?: string, objectId?: string, ip?: string | null): Promise<void> {
  const ipHash = ip ? (await sha256Hex(`${ip}:${env.SIGNING_SECRET ?? ""}`)).slice(0, 16) : null;
  await env.DB.prepare(
    "INSERT INTO audit_events (id, actor_id, action, object_type, object_id, ip_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  )
    .bind(newId(), actorId, action, objectType ?? null, objectId ?? null, ipHash, nowIso())
    .run();
}

export async function recordUsage(env: Env, userId: string, operation: string, units = 1, estimatedCost = 0): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO usage_events (id, user_id, operation, units, estimated_cost, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
  )
    .bind(newId(), userId, operation, units, estimatedCost, nowIso())
    .run();
}

export function startOfUtcDay(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

export async function usageToday(env: Env, userId: string, operation: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(units), 0) AS n FROM usage_events WHERE user_id = ?1 AND operation = ?2 AND created_at >= ?3"
  )
    .bind(userId, operation, startOfUtcDay())
    .first<{ n: number }>();
  return row?.n ?? 0;
}
