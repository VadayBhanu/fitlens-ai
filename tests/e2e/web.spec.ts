import { expect, test } from "@playwright/test";
import { join } from "node:path";

const FIX = join(__dirname, ".fixtures");
const IMG = join(__dirname, "../../apps/web/public/demo-store/img");

test.describe.configure({ mode: "serial" });

test("landing page explains the product and links to the demo store", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Try it on before you buy it." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Try-On Studio" })).toBeVisible();
  const store = await page.request.get("/demo-store/");
  expect(store.ok()).toBeTruthy();
  expect(await store.text()).toContain("application/ld+json");
});

test("protected pages redirect to sign in", async ({ page }) => {
  await page.goto("/wardrobe");
  await expect(page).toHaveURL(/\/login\?next=%2Fwardrobe/);
});

test("full studio journey: sign up → garment → photo → consent → try-on → wardrobe → delete account", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/signup?next=/studio");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a very good password");
  await page.getByLabel("I am 18 or older.").check();
  await page.locator("label.check", { hasText: "I accept the" }).locator("input").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/studio/);
  await expect(page.getByText("10 of 10 try-ons left today")).toBeVisible();

  // 1. Garment upload (fallback path when not using the extension)
  await page.locator("section", { hasText: "1 · Garment" }).locator('input[type="file"]').setInputFiles(join(IMG, "denim-jacket-indigo.png"));
  await expect(page.getByText("Uploaded garment")).toBeVisible();
  await page.getByLabel("Type").selectOption("outerwear");

  // 2. Person photo with client-side quality and person checks
  await page.locator("section", { hasText: "2 · Your photo" }).locator('input[type="file"]').setInputFiles(join(FIX, "person.jpg"));
  await expect(page.getByRole("button", { name: "Choose another photo" })).toBeVisible();
  await expect(page.getByText("Please use a different photo")).toHaveCount(0);

  // 3. Consent gate, then generate
  await expect(page.getByText("Your permission is needed")).toBeVisible();
  await page.getByRole("button", { name: "I agree, continue" }).click();
  await page.getByRole("radio", { name: "HD" }).click();
  await page.getByRole("button", { name: "Generate try-on" }).click();

  // 4. Result
  await expect(page.getByRole("img", { name: "AI try-on result" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Check before you buy")).toBeVisible();
  await page.getByRole("button", { name: "Save to wardrobe" }).click();
  await expect(page.getByRole("button", { name: "Saved to wardrobe ✓" })).toBeVisible();
  await expect(page.getByText("9 of 10 try-ons left today")).toBeVisible();

  await page.getByRole("link", { name: "Wardrobe" }).click();
  await expect(page.getByRole("heading", { name: "Your saved looks" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(1);

  // Privacy controls
  await page.getByRole("link", { name: "Account" }).click();
  const consent = page.locator("label.check", { hasText: "Cloud photo try-on" }).locator("input");
  await expect(consent).toBeChecked();
  await consent.uncheck();
  await expect(consent).not.toBeChecked();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export my data (JSON)" }).click();
  expect((await download).suggestedFilename()).toBe("fitlens-data-export.json");

  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete my account" }).click();
  await expect(page).toHaveURL("http://localhost:5173/");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a very good password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});

test("photo quality gate blocks unusable photos", async ({ page }) => {
  await page.goto("/signup?next=/studio");
  await page.getByLabel("Email").fill(`e2e-q-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("a very good password");
  await page.getByLabel("I am 18 or older.").check();
  await page.locator("label.check", { hasText: "I accept the" }).locator("input").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/studio/);
  // A garment image is not a person photo: the on-device check should block it.
  await page.locator("section", { hasText: "2 · Your photo" }).locator('input[type="file"]').setInputFiles(join(IMG, "camp-shirt-sage.png"));
  await expect(page.getByText("Please use a different photo")).toBeVisible();
  await expect(page.getByText(/couldn't find a person/i)).toBeVisible();
});
