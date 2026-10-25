// Starts the real API (wrangler dev, local D1/R2) on :8787 with a mock FASHN
// provider on :9799, for Playwright end-to-end tests. Keeps running until killed.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockFashn } from "../support/mock-fashn.mjs";
import { killTree, removeDir, wranglerRunner } from "../support/proc.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = join(root, "apps/api");
const wrangler = wranglerRunner(root);
const persist = mkdtempSync(join(tmpdir(), "fitlens-e2e-"));

const mock = await startMockFashn({ port: 9799, imageDir: join(root, "apps/web/public/demo-store/img") });
wrangler.sync(["d1", "migrations", "apply", "fitlens", "--local", "--persist-to", persist], { cwd: apiDir, stdio: "ignore" });
wrangler.sync(["d1", "execute", "fitlens", "--local", "--persist-to", persist, "--file=seeds/demo.sql"], { cwd: apiDir, stdio: "ignore" });

const vars = {
  SIGNING_SECRET: "e2e-signing-secret-0123456789abcdef",
  FASHN_API_KEY: "test-fashn-key",
  FASHN_BASE_URL: "http://127.0.0.1:9799/v1",
  DEV_ALLOW_PRIVATE_HOSTS: "true",
  PASSWORD_PBKDF2_ITERATIONS: "1000",
  ALLOWED_ORIGINS: "http://localhost:5173,chrome-extension://*"
};
const child = wrangler.spawn(["dev", "--port", "8787", "--persist-to", persist, ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], {
  cwd: apiDir,
  stdio: "inherit",
  env: { ...process.env, CI: "1" }
});
const shutdown = () => {
  killTree(child);
  mock.close();
  removeDir(persist);
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
child.on("exit", (code) => process.exit(code ?? 1));
