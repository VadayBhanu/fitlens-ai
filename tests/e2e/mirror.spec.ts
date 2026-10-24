import { expect, test } from "@playwright/test";

test("live mirror tracks a person from the camera, captures a photo and records a playable clip", async ({ page }, testInfo) => {
  // Headless CI has no GPU, so pose inference runs on the CPU and is slow.
  test.setTimeout(180_000);
  await page.goto("/mirror");
  await expect(page.getByText("Background removed automatically").or(page.getByText("Transparent image"))).toBeVisible();
  await page.getByRole("button", { name: "Start Live Mirror" }).click();
  await expect(page.locator(".hud-pill").first()).toBeVisible({ timeout: 30_000 });
  // The fake camera shows a person — tracking should lock on.
  await expect(page.locator(".hud-pill").first()).toHaveText(/Tracking|Partial/, { timeout: 30_000 });

  // The garment must actually be composited: compare the rendered canvas with the raw camera frame.
  const changedPixels = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(".mirror-stage canvas")!;
    const v = document.querySelector<HTMLVideoElement>(".mirror-stage video")!;
    const rendered = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const raw = document.createElement("canvas");
    raw.width = c.width;
    raw.height = c.height;
    const rctx = raw.getContext("2d")!;
    rctx.drawImage(v, 0, 0, c.width, c.height);
    const camera = rctx.getImageData(0, 0, c.width, c.height).data;
    let changed = 0;
    for (let i = 0; i < rendered.length; i += 4) {
      const d = Math.abs(rendered[i]! - camera[i]!) + Math.abs(rendered[i + 1]! - camera[i + 1]!) + Math.abs(rendered[i + 2]! - camera[i + 2]!);
      if (d > 90) changed++;
    }
    return changed / (c.width * c.height);
  });
  // A garment covers a meaningful share of the frame (motion alone changes far less).
  expect(changedPixels).toBeGreaterThan(0.02);
  await testInfo.attach("mirror-frame", { body: await page.locator(".mirror-stage").screenshot(), contentType: "image/png" });
  if (process.env.MIRROR_SCREENSHOT) await page.locator(".mirror-stage").screenshot({ path: process.env.MIRROR_SCREENSHOT });

  await page.getByRole("button", { name: "Capture photo" }).click();
  await expect(page.getByRole("img", { name: "Captured outfit" })).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();

  await page.getByRole("button", { name: "Record clip" }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Stop recording" }).click();
  const video = page.locator(".card video");
  await expect(video).toBeVisible();
  const duration = await video.evaluate((v: HTMLVideoElement) => new Promise<number>((r) => (v.readyState >= 1 ? r(v.duration) : v.addEventListener("loadedmetadata", () => r(v.duration)))));
  expect(Number.isNaN(duration)).toBeFalsy();

  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.getByRole("button", { name: "Start Live Mirror" })).toBeVisible();
});
