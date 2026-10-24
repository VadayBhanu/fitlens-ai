// Renders the extension icons. Usage: node scripts/icons.mjs
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0B1020"/><circle cx="32" cy="32" r="17" fill="none" stroke="#6D5DF6" stroke-width="6"/><circle cx="32" cy="32" r="7" fill="#BBA7FF"/></svg>`;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(new URL(`../public/icons/icon${size}.png`, import.meta.url), await page.screenshot({ omitBackground: true }));
}
await browser.close();
console.log("icons written");
