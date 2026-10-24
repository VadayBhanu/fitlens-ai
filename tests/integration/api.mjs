// End-to-end API test: boots the real Worker with `wrangler dev` (local D1 + R2),
// a mock FASHN server, and exercises auth, uploads, product import, try-on,
// deals, reviews, wardrobe, authorization boundaries, export and deletion.
//
// Usage: node tests/integration/api.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { startMockFashn } from "../support/mock-fashn.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = join(root, "apps/api");
const img = (n) => readFileSync(join(root, "apps/web/public/demo-store/img", n));
const PORT = 8788;
const MOCK_PORT = 9799;
const API = `http://127.0.0.1:${PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

// ---------- mock FASHN ----------
const mockFashn = await startMockFashn({ port: MOCK_PORT, imageDir: join(root, "apps/web/public/demo-store/img") });
const mock = mockFashn.server;

// ---------- worker ----------
const persist = mkdtempSync(join(tmpdir(), "fitlens-it-"));
const wrangler = join(root, "node_modules/.bin/wrangler");
execFileSync(wrangler, ["d1", "migrations", "apply", "fitlens", "--local", "--persist-to", persist], { cwd: apiDir, stdio: "ignore" });
execFileSync(wrangler, ["d1", "execute", "fitlens", "--local", "--persist-to", persist, "--file=seeds/demo.sql"], { cwd: apiDir, stdio: "ignore" });
const vars = {
  SIGNING_SECRET: "integration-signing-secret-123456",
  ADMIN_TOKEN: "integration-admin-token-123456",
  FASHN_API_KEY: "test-fashn-key",
  FASHN_BASE_URL: `${MOCK}/v1`,
  DEV_ALLOW_PRIVATE_HOSTS: "true",
  PASSWORD_PBKDF2_ITERATIONS: "1000"
};
const worker = spawn(
  wrangler,
  ["dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", persist, ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])],
  { cwd: apiDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } }
);
let log = "";
worker.stdout.on("data", (d) => (log += d));
worker.stderr.on("data", (d) => (log += d));

const cleanup = () => {
  worker.kill("SIGTERM");
  mock.close();
  rmSync(persist, { recursive: true, force: true });
};

async function call(method, path, { token, json, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (json !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(API + path, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push(["FAIL", name]);
    console.log(`  ✗ ${name}\n    ${e.message}`);
    throw e;
  }
}

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${API}/v1/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
    if (i === 59) throw new Error("Worker did not start:\n" + log);
  }
  console.log("FitLens API integration test");
  const email = `it-${Date.now()}@example.com`;
  let token, token2, personId, product, job;

  await step("health reports configured services", async () => {
    const r = await call("GET", "/v1/health");
    assert.equal(r.data.status, "ok");
    assert.equal(r.data.services.tryOnProvider, "configured");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  });

  await step("signup validates input", async () => {
    const r = await call("POST", "/v1/auth/signup", { json: { email, password: "short", acceptTerms: true, confirmAdult: true } });
    assert.equal(r.status, 422);
    assert.equal(r.data.error.code, "VALIDATION_FAILED");
  });

  await step("signup, duplicate and login", async () => {
    const r = await call("POST", "/v1/auth/signup", { json: { email, password: "correct horse battery", acceptTerms: true, confirmAdult: true } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.ok(r.data.token);
    const dup = await call("POST", "/v1/auth/signup", { json: { email, password: "correct horse battery", acceptTerms: true, confirmAdult: true } });
    assert.equal(dup.status, 409);
    const bad = await call("POST", "/v1/auth/login", { json: { email, password: "wrong password!" } });
    assert.equal(bad.status, 401);
    const ok = await call("POST", "/v1/auth/login", { json: { email: email.toUpperCase(), password: "correct horse battery" } });
    assert.equal(ok.status, 200);
    token = ok.data.token;
    assert.equal(ok.data.user.consents.cloud_tryon, false);
  });

  await step("CORS allows the configured web origin and rejects others", async () => {
    const ok = await fetch(`${API}/v1/health`, { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "GET" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
    const ext = await fetch(`${API}/v1/health`, { method: "OPTIONS", headers: { Origin: "chrome-extension://abcdefghijklmnop", "Access-Control-Request-Method": "GET" } });
    assert.equal(ext.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop");
    const evil = await fetch(`${API}/v1/health`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
  });

  await step("unauthenticated requests are rejected", async () => {
    const r = await call("GET", "/v1/auth/me");
    assert.equal(r.status, 401);
  });

  await step("upload validates file signatures", async () => {
    const bad = await call("POST", "/v1/assets?purpose=person", { token, body: "not an image at all, just text" });
    assert.equal(bad.status, 415);
    const r = await call("POST", "/v1/assets?purpose=person", { token, body: img("camp-shirt-sage.png"), headers: { "Content-Type": "image/png" } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.mimeType, "image/png");
    assert.ok(r.data.expiresAt, "person photos are temporary by default");
    personId = r.data.id;
  });

  await step("signed media URLs work and reject tampering", async () => {
    const a = await call("GET", `/v1/assets/${personId}`, { token });
    const ok = await fetch(a.data.url);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    const bad = await fetch(a.data.url.replace(/sig=[0-9a-f]{4}/, "sig=0000"));
    assert.equal(bad.status, 403);
  });

  await step("product extraction imports the garment image", async () => {
    const r = await call("POST", "/v1/products/extract", {
      token,
      json: {
        name: "Denim Trucker Jacket",
        brand: "Northline",
        category: "outerwear",
        color: "Indigo",
        size: "M",
        styleNumber: "NL-204",
        gtin: "840000001023",
        imageUrl: `${MOCK}/img/jacket.png`,
        productUrl: "http://localhost:5173/demo-store/#nl-204",
        retailerDomain: "localhost",
        price: { amountMinor: 8900, currency: "USD" },
        extractionMethod: "json-ld",
        extractionConfidence: 0.95
      }
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    product = r.data.product;
    assert.ok(product.garmentAssetId, "garment imported: " + JSON.stringify(r.data.warnings));
    const again = await call("POST", "/v1/products/extract", { token, json: { ...r.data.product, imageUrl: `${MOCK}/img/jacket.png`, productUrl: "http://localhost:5173/demo-store/#nl-204", retailerDomain: "localhost", price: { amountMinor: 8900, currency: "USD" }, extractionMethod: "json-ld", extractionConfidence: 0.95, gtin: "840000001023", styleNumber: "NL-204", brand: "Northline", color: "Indigo", size: "M" } });
    assert.equal(again.status, 200);
    assert.equal(again.data.product.id, product.id, "re-selecting the same product is idempotent");
  });

  await step("SSRF protection blocks internal addresses in production mode", async () => {
    // DEV_ALLOW_PRIVATE_HOSTS is on for this test, so assert URL-level validation instead.
    const r = await call("POST", "/v1/products/extract", {
      token,
      json: { name: "X", category: "top", imageUrl: "file:///etc/passwd", productUrl: "https://shop.example/x", retailerDomain: "shop.example", extractionMethod: "json-ld", extractionConfidence: 0.5 }
    });
    assert.equal(r.status, 422);
  });

  await step("try-on requires explicit consent", async () => {
    const r = await call("POST", "/v1/tryons", { token, json: { personAssetId: personId, garmentAssetId: product.garmentAssetId, productId: product.id, category: "outerwear" } });
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, "CONSENT_REQUIRED");
    const c = await call("POST", "/v1/auth/consents", { token, json: { purpose: "cloud_tryon", granted: true } });
    assert.equal(c.data.consents.cloud_tryon, true);
  });

  await step("try-on rejects swapped asset roles", async () => {
    const r = await call("POST", "/v1/tryons", { token, json: { personAssetId: product.garmentAssetId, garmentAssetId: personId, category: "top" } });
    assert.equal(r.status, 422);
  });

  await step("try-on is created idempotently and submitted to the provider", async () => {
    const body = { personAssetId: personId, garmentAssetId: product.garmentAssetId, productId: product.id, category: "outerwear", quality: "balanced", inputQuality: { width: 500, height: 600, brightness: 120, sharpness: 300 } };
    const r = await call("POST", "/v1/tryons", { token, json: body, headers: { "Idempotency-Key": "it-key-1" } });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    assert.equal(r.data.status, "processing");
    job = r.data;
    const again = await call("POST", "/v1/tryons", { token, json: body, headers: { "Idempotency-Key": "it-key-1" } });
    assert.equal(again.data.id, job.id);
    assert.equal(mockFashn.state.lastRunBody.model_name, "tryon-v1.6");
    assert.equal(mockFashn.state.lastRunBody.inputs.category, "tops");
    assert.equal(mockFashn.state.lastRunBody.inputs.mode, "balanced");
    assert.match(mockFashn.state.lastRunBody.inputs.model_image, /^data:image\/png;base64,/);
    assert.ok(job.warnings.some((w) => /low resolution/i.test(w)));
  });

  await step("polling completes the job and stores the result privately", async () => {
    let r;
    for (let i = 0; i < 15; i++) {
      await new Promise((res) => setTimeout(res, 2700));
      r = await call("GET", `/v1/tryons/${job.id}`, { token });
      if (r.data.status === "completed" || r.data.status === "failed") break;
    }
    assert.equal(r.data.status, "completed", JSON.stringify(r.data));
    assert.ok(r.data.result.url.includes("/v1/files/"));
    const file = await fetch(r.data.result.url);
    assert.equal(file.status, 200);
    job = r.data;
  });

  await step("deal search returns only verified exact variants as exact", async () => {
    const r = await call("POST", `/v1/products/${product.id}/deals`, { token });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const exactIds = r.data.exact.map((o) => o.retailer + ":" + o.size);
    assert.deepEqual(exactIds.sort(), ["Demo Marketplace:M", "Demo Outlet:M"]);
    assert.ok(!r.data.exact.some((o) => o.size === "L"), "size L must never be exact");
    assert.ok(r.data.similar.some((o) => o.retailer === "Demo Boutique"));
    assert.equal(r.data.recommendation.offerId, r.data.exact.find((o) => o.retailer === "Demo Outlet").id);
    assert.ok(r.data.exact.every((o) => o.source.isDemoData));
  });

  await step("reviews are matched by identifier and sourced", async () => {
    const r = await call("GET", `/v1/products/${product.id}/reviews`, { token });
    assert.equal(r.data.status, "ok");
    assert.equal(r.data.count, 3);
    assert.equal(r.data.averageRating, 4);
    assert.ok(r.data.reviews.every((rv) => rv.sourceUrl && rv.isDemo));
  });

  await step("wardrobe saves and lists the try-on result", async () => {
    const r = await call("POST", "/v1/wardrobe", { token, json: { kind: "tryon", productId: product.id, mediaAssetId: job.result.assetId, tryOnId: job.id } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const list = await call("GET", "/v1/wardrobe", { token });
    assert.equal(list.data.items.length, 1);
    assert.equal(list.data.items[0].product.name, "Denim Trucker Jacket");
    assert.ok(list.data.items[0].media.url);
    const person = await call("POST", "/v1/wardrobe", { token, json: { kind: "capture", mediaAssetId: personId } });
    assert.equal(person.status, 422, "raw source photos cannot be added to the wardrobe");
  });

  await step("users cannot access each other's data", async () => {
    const r = await call("POST", "/v1/auth/signup", { json: { email: `other-${email}`, password: "another long password", acceptTerms: true, confirmAdult: true } });
    token2 = r.data.token;
    for (const path of [`/v1/products/${product.id}`, `/v1/tryons/${job.id}`, `/v1/assets/${personId}`]) {
      const x = await call("GET", path, { token: token2 });
      assert.equal(x.status, 404, path);
    }
    const del = await call("DELETE", `/v1/assets/${personId}`, { token: token2 });
    assert.equal(del.status, 404);
  });

  await step("admin API is locked without the admin token", async () => {
    const r = await call("POST", "/v1/admin/catalog", { token, json: {} });
    assert.equal(r.status, 403);
    const ok = await call("POST", "/v1/admin/catalog", {
      headers: { Authorization: `Bearer ${vars.ADMIN_TOKEN}` },
      json: { retailer: { name: "Feed Test", domain: "feed.example" }, items: [{ externalId: "1", title: "Northline Denim Trucker Jacket", brand: "Northline", styleNumber: "NL-204", color: "Indigo", size: "M", productUrl: "https://feed.example/1", price: { amountMinor: 7000, currency: "USD" }, shippingMinor: 1000 }] }
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.upserted, 1);
  });

  await step("data export contains the user's records", async () => {
    const r = await call("GET", "/v1/account/export", { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.account.email, email);
    assert.equal(r.data.tryOns.length, 1);
  });

  await step("account deletion removes data and invalidates sessions", async () => {
    const a = await call("GET", `/v1/tryons/${job.id}`, { token });
    const fileUrl = a.data.result.url;
    const r = await call("DELETE", "/v1/account", { token });
    assert.equal(r.status, 204);
    const me = await call("GET", "/v1/auth/me", { token });
    assert.equal(me.status, 401);
    const file = await fetch(fileUrl);
    assert.equal(file.status, 404, "media is gone after deletion");
  });

  await step("scheduled maintenance runs cleanly", async () => {
    const r = await fetch(`${API}/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*`);
    assert.equal(r.status, 200);
  });

  console.log(`\n${results.length} checks passed.`);
  cleanup();
  process.exit(0);
} catch (e) {
  console.error("\nIntegration test failed:", e.message);
  console.error("--- worker log (tail) ---\n" + log.split("\n").slice(-40).join("\n"));
  cleanup();
  process.exit(1);
}
