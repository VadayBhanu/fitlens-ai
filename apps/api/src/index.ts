import { ErrorCode } from "@fitlens/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv, Env } from "./env";
import { deleteAsset, type AssetRow } from "./lib/assets";
import { ApiError, nowIso } from "./lib/http";
import { purgeOldRateLimits } from "./lib/ratelimit";
import { apiOrigin } from "./lib/signing";
import { reconcileJobs } from "./jobs/tryon";
import { accountRoutes } from "./routes/account";
import { adminRoutes } from "./routes/admin";
import { assetRoutes, fileRoutes } from "./routes/assets";
import { authRoutes } from "./routes/auth";
import { productRoutes } from "./routes/products";
import { tryOnRoutes } from "./routes/tryons";
import { wardrobeRoutes } from "./routes/wardrobe";
import { offerProviders } from "./providers/offers";
import { tryOnProvider } from "./providers/tryon";

const app = new Hono<AppEnv>();

export function isAllowedOrigin(origin: string, allowed: string): boolean {
  return allowed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((rule) => (rule.endsWith("*") ? origin.startsWith(rule.slice(0, -1)) : origin === rule));
}

app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
  c.header("X-Request-Id", c.get("requestId"));
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (!c.res.headers.get("Content-Security-Policy")) c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
});

app.use(
  "/v1/*",
  cors({
    origin: (origin, c) => (origin && isAllowedOrigin(origin, (c.env as Env).ALLOWED_ORIGINS) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-FitLens-Client"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 86400
  })
);

app.get("/", (c) => c.json({ name: "FitLens API", docs: "/v1/health" }));

app.get("/v1/health", async (c) => {
  let db = "ok";
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch {
    db = "error";
  }
  return c.json({
    status: db === "ok" ? "ok" : "degraded",
    time: nowIso(),
    environment: c.env.ENVIRONMENT,
    services: {
      database: db,
      storage: c.env.ASSETS ? "r2" : c.env.ASSETS_KV ? "kv" : "missing",
      tryOnProvider: tryOnProvider(c.env).configured ? "configured" : "not_configured",
      offers: offerProviders(c.env).map((p) => ({ name: p.name, configured: p.configured })),
      reviewSummaries: c.env.AI ? "workers-ai" : "disabled",
      signing: c.env.SIGNING_SECRET ? "configured" : "missing"
    }
  });
});

app.route("/v1/auth", authRoutes);
app.route("/v1/assets", assetRoutes);
app.route("/v1/files", fileRoutes);
app.route("/v1/products", productRoutes);
app.route("/v1/tryons", tryOnRoutes);
app.route("/v1/wardrobe", wardrobeRoutes);
app.route("/v1/account", accountRoutes);
app.route("/v1/admin", adminRoutes);

app.notFound((c) => c.json(new ApiError(ErrorCode.NOT_FOUND).toBody(), 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toBody(), err.status as 400);
  }
  console.error(JSON.stringify({ level: "error", requestId: c.get("requestId"), path: c.req.path, message: err.message, stack: err.stack }));
  const body = new ApiError(ErrorCode.INTERNAL).toBody();
  body.error.details = { requestId: c.get("requestId") };
  return c.json(body, 500);
});

async function scheduled(env: Env): Promise<void> {
  const origin = apiOrigin(env);
  await reconcileJobs(env, origin);

  // Retention: purge expired temporary photos.
  const { results } = await env.DB.prepare("SELECT * FROM assets WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?1 LIMIT 200")
    .bind(nowIso())
    .all<AssetRow>();
  for (const a of results) await deleteAsset(env, a);

  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(nowIso()).run();
  await purgeOldRateLimits(env);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(env));
  }
} satisfies ExportedHandler<Env>;

export { app };
