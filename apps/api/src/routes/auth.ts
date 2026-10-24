import { CONSENT_POLICY_VERSION, ConsentPurpose, ErrorCode, LogInInput, SignUpInput, type AuthDTO, type MeDTO } from "@fitlens/shared";
import { Hono } from "hono";
import { z } from "zod";
import { intVar, type AppEnv, type Env } from "../env";
import { audit, usageToday } from "../lib/audit";
import { requireAuth, SESSION_DAYS, clientIp } from "../lib/auth";
import { hashPassword, newId, randomToken, sha256Hex, timingSafeEqual } from "../lib/crypto";
import { ApiError, nowIso, parseJson } from "../lib/http";
import { rateLimit } from "../lib/ratelimit";

export const authRoutes = new Hono<AppEnv>();

async function createSession(env: Env, userId: string, client: string | undefined): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, client, created_at, expires_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  )
    .bind(newId(), userId, await sha256Hex(token), (client ?? "unknown").slice(0, 40), now, expiresAt, now)
    .run();
  return { token, expiresAt };
}

export async function loadMe(env: Env, userId: string): Promise<MeDTO> {
  const user = await env.DB.prepare("SELECT id, email, display_name, created_at FROM users WHERE id = ?1").bind(userId).first<{
    id: string;
    email: string;
    display_name: string | null;
    created_at: string;
  }>();
  if (!user) throw new ApiError(ErrorCode.UNAUTHENTICATED);
  const { results } = await env.DB.prepare("SELECT purpose FROM consents WHERE user_id = ?1 AND revoked_at IS NULL")
    .bind(userId)
    .all<{ purpose: string }>();
  const granted = new Set(results.map((r) => r.purpose));
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    createdAt: user.created_at,
    consents: { cloud_tryon: granted.has("cloud_tryon"), product_analytics: granted.has("product_analytics") },
    usage: { tryOnsToday: await usageToday(env, userId, "tryon"), dailyTryOnLimit: intVar(env.FREE_DAILY_TRYONS, 10) }
  };
}

authRoutes.post("/signup", async (c) => {
  await rateLimit(c.env, `signup:${clientIp(c.req.raw) ?? "anon"}`, 10, 3600);
  const input = await parseJson(c, SignUpInput);
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(input.email).first();
  if (existing) throw new ApiError(ErrorCode.CONFLICT, "An account with this email already exists. Try signing in.");
  const iterations = intVar(c.env.PASSWORD_PBKDF2_ITERATIONS, 100_000);
  const pw = await hashPassword(input.password, iterations);
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, password_salt, password_iter, display_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    ).bind(id, input.email, pw.hash, pw.salt, pw.iterations, input.displayName ?? null, now),
    c.env.DB.prepare("INSERT INTO consents (id, user_id, purpose, policy_version, granted_at) VALUES (?1, ?2, 'terms', ?3, ?4)").bind(
      newId(),
      id,
      CONSENT_POLICY_VERSION,
      now
    )
  ]);
  const session = await createSession(c.env, id, c.req.header("x-fitlens-client"));
  await audit(c.env, id, "user.signup", "user", id, clientIp(c.req.raw));
  const body: AuthDTO = { ...session, user: await loadMe(c.env, id) };
  return c.json(body, 201);
});

authRoutes.post("/login", async (c) => {
  const input = await parseJson(c, LogInInput);
  await rateLimit(c.env, `login:${clientIp(c.req.raw) ?? "anon"}`, 30, 900);
  await rateLimit(c.env, `login-email:${input.email}`, 10, 900);
  const user = await c.env.DB.prepare(
    "SELECT id, password_hash, password_salt, password_iter FROM users WHERE email = ?1 AND deleted_at IS NULL"
  )
    .bind(input.email)
    .first<{ id: string; password_hash: string; password_salt: string; password_iter: number }>();
  // Hash even when the user doesn't exist to keep timing uniform.
  const pw = await hashPassword(input.password, user?.password_iter ?? intVar(c.env.PASSWORD_PBKDF2_ITERATIONS, 100_000), user?.password_salt ?? "00".repeat(16));
  if (!user || !timingSafeEqual(pw.hash, user.password_hash)) {
    throw new ApiError(ErrorCode.UNAUTHENTICATED, "Incorrect email or password.");
  }
  const session = await createSession(c.env, user.id, c.req.header("x-fitlens-client"));
  await audit(c.env, user.id, "user.login", "user", user.id, clientIp(c.req.raw));
  const body: AuthDTO = { ...session, user: await loadMe(c.env, user.id) };
  return c.json(body);
});

authRoutes.post("/logout", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(c.get("user").sessionId).run();
  return c.body(null, 204);
});

authRoutes.get("/me", requireAuth, async (c) => c.json(await loadMe(c.env, c.get("user").id)));

const ConsentBody = z.object({ purpose: ConsentPurpose, granted: z.boolean() });

authRoutes.post("/consents", requireAuth, async (c) => {
  const user = c.get("user");
  const { purpose, granted } = await parseJson(c, ConsentBody);
  const now = nowIso();
  await c.env.DB.prepare("UPDATE consents SET revoked_at = ?1 WHERE user_id = ?2 AND purpose = ?3 AND revoked_at IS NULL")
    .bind(now, user.id, purpose)
    .run();
  if (granted) {
    await c.env.DB.prepare("INSERT INTO consents (id, user_id, purpose, policy_version, granted_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(newId(), user.id, purpose, CONSENT_POLICY_VERSION, now)
      .run();
  }
  await audit(c.env, user.id, granted ? "consent.grant" : "consent.revoke", "consent", purpose);
  return c.json(await loadMe(c.env, user.id));
});
