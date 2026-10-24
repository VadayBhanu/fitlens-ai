import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { audit } from "../lib/audit";
import { requireAuth } from "../lib/auth";
import { nowIso } from "../lib/http";
import { blobStore } from "../lib/storage";
import { loadMe } from "./auth";

export const accountRoutes = new Hono<AppEnv>();
accountRoutes.use("*", requireAuth);

/** Data portability: everything we hold about the user, as JSON (media as references). */
accountRoutes.get("/export", async (c) => {
  const id = c.get("user").id;
  const q = (sql: string) => c.env.DB.prepare(sql).bind(id).all().then((r) => r.results);
  const body = {
    exportedAt: nowIso(),
    account: await loadMe(c.env, id),
    consents: await q("SELECT purpose, policy_version, granted_at, revoked_at FROM consents WHERE user_id = ?1"),
    products: await q("SELECT * FROM products WHERE user_id = ?1"),
    assets: await q("SELECT id, purpose, mime_type, bytes, width, height, created_at, expires_at, deleted_at FROM assets WHERE user_id = ?1"),
    tryOns: await q("SELECT id, product_id, quality, category, status, warnings_json, created_at, updated_at FROM tryon_jobs WHERE user_id = ?1"),
    wardrobe: await q("SELECT * FROM wardrobe_items WHERE user_id = ?1"),
    usage: await q("SELECT operation, units, created_at FROM usage_events WHERE user_id = ?1")
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="fitlens-export-${id}.json"` }
  });
});

/** Permanently delete the account and every stored file. */
accountRoutes.delete("/", async (c) => {
  const user = c.get("user");
  await deleteUserData(c.env, user.id);
  await audit(c.env, null, "user.delete", "user", user.id);
  return c.body(null, 204);
});

export async function deleteUserData(env: Env, userId: string): Promise<void> {
  const store = blobStore(env);
  for (;;) {
    const { results } = await env.DB.prepare("SELECT id, object_key FROM assets WHERE user_id = ?1 AND deleted_at IS NULL LIMIT 100")
      .bind(userId)
      .all<{ id: string; object_key: string }>();
    if (!results.length) break;
    await Promise.all(results.map((a) => store.delete(a.object_key)));
    await env.DB.batch(results.map((a) => env.DB.prepare("UPDATE assets SET deleted_at = ?1 WHERE id = ?2").bind(nowIso(), a.id)));
  }
  // Explicit deletes (D1 enforces FKs, but be explicit about intent and order).
  await env.DB.batch(
    ["wardrobe_items", "rendered_media", "tryon_jobs", "products", "usage_events", "consents", "sessions", "assets"].map((t) =>
      env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?1`).bind(userId)
    )
  );
  await env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(userId).run();
}
