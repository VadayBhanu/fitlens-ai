import { ErrorCode } from "@fitlens/shared";
import type { MiddlewareHandler } from "hono";
import type { AppEnv, AuthUser } from "../env";
import { sha256Hex } from "./crypto";
import { ApiError, nowIso } from "./http";

export const SESSION_DAYS = 30;

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 200) throw new ApiError(ErrorCode.UNAUTHENTICATED);
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, s.last_used_at, u.id, u.email, u.display_name, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.deleted_at IS NULL`
  )
    .bind(tokenHash, nowIso())
    .first<{ session_id: string; last_used_at: string; id: string; email: string; display_name: string | null; created_at: string }>();
  if (!row) throw new ApiError(ErrorCode.UNAUTHENTICATED, "Your session has expired. Please sign in again.");

  const user: AuthUser = { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at, sessionId: row.session_id };
  c.set("user", user);

  if (Date.now() - Date.parse(row.last_used_at) > 3600_000) {
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE sessions SET last_used_at = ?1 WHERE id = ?2").bind(nowIso(), row.session_id).run());
  }
  await next();
};

export function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip");
}
