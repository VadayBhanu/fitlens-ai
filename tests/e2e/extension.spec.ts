import { chromium, expect, test, type BrowserContext, type Worker } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(__dirname, "../..");
const extDir = join(root, "apps/extension/dist-e2e");

let context: BrowserContext;
let sw: Worker;
let extensionId: string;

test.beforeAll(async () => {
  execFileSync("node", ["build.mjs"], { cwd: join(root, "apps/extension"), env: { ...process.env, FITLENS_E2E: "1", FITLENS_OUT_DIR: "dist-e2e" }, stdio: "ignore" });
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "fitlens-ext-")), {
    // The full Chromium build ("chromium" channel) supports extensions in headless mode.
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`]
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  extensionId = new URL(sw.url()).host;
});

test.afterAll(async () => {
  await context?.close();
});

test("hover-to-select on a store page sends a validated product to the side panel, which imports it and finds verified deals", async () => {
  // Create an account through the API (the web app's sign-up is covered elsewhere).
  const email = `ext-${Date.now()}@example.com`;
  const signup = await fetch("http://127.0.0.1:8787/v1/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "extension password 1", acceptTerms: true, confirmAdult: true })
  });
  expect(signup.status).toBe(201);

  // Side panel: sign in.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole("heading", { name: "Sign in to FitLens" })).toBeVisible();
  await panel.getByLabel("Email").fill(email);
  await panel.getByLabel("Password").fill("extension password 1");
  await panel.getByRole("button", { name: "Sign in" }).click();
  await expect(panel.getByRole("heading", { name: "Pick a garment" })).toBeVisible();

  // Store page: activate FitLens the same way the toolbar button does.
  const store = await context.newPage();
  await store.goto("http://localhost:5173/demo-store/");
  const card = store.locator("article", { hasText: "Denim Trucker Jacket" });
  await card.getByRole("button", { name: "L", exact: true }).click(); // choose size L first…
  await card.getByRole("button", { name: "M", exact: true }).click(); // …then M: the selection must reflect the current variant
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, files: ["content.js"] });
  }, "http://localhost:5173/demo-store/*");
  await expect(store.locator("fitlens-overlay")).toHaveCount(1);

  // Hover the jacket image and click the floating "Try on" button (inside a closed shadow root).
  const img = card.locator("img");
  await img.hover();
  const box = (await img.boundingBox())!;
  await store.mouse.click(box.x + box.width - 70, box.y + 26);

  // Side panel picks up the selection, imports it, and shows the product.
  await panel.bringToFront();
  await expect(panel.getByText("Denim Trucker Jacket")).toBeVisible();
  await expect(panel.getByText("Read from the store's product data")).toBeVisible();
  await expect(panel.getByText(/Style NL-204 · GTIN 840000001023/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Try it on" })).toBeEnabled({ timeout: 20_000 });

  await panel.getByRole("button", { name: "Compare prices" }).click();
  await expect(panel.getByText(/Best verified offer: Demo Outlet/)).toBeVisible();
  await expect(panel.locator("a.offer")).toHaveCount(2);
  await expect(panel.getByText("Size L")).toHaveCount(0);

  // Escape deactivates the overlay on the page.
  await store.bringToFront();
  await store.keyboard.press("Escape");
  await expect(store.locator("fitlens-overlay")).toHaveCount(0);
});

test("the service worker rejects selections that aren't from a content script", async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const res = await panel.evaluate(() =>
    chrome.runtime.sendMessage({ type: "PRODUCT_SELECTED", product: { name: "x", imageUrl: "https://x.example/a.png", productUrl: "https://x.example", retailerDomain: "x.example", extractionMethod: "json-ld", extractionConfidence: 1 } })
  );
  expect(res).toEqual({ ok: false, error: "Rejected" });
});
