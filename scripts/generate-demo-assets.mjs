// Renders the demo-store garment images (transparent PNGs) with headless Chromium.
// Usage: node scripts/generate-demo-assets.mjs
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const OUT = new URL("../apps/web/public/demo-store/img/", import.meta.url);

const garments = {
  "crew-tee-white": { body: "#f4f2ee", shade: "#d9d5cc", trim: "#e6e2da", kind: "tee" },
  "denim-jacket-indigo": { body: "#3c5a8a", shade: "#2b4369", trim: "#c79a52", kind: "jacket" },
  "camp-shirt-sage": { body: "#9fb59a", shade: "#7f9879", trim: "#eef0e8", kind: "shirt" }
};

const draw = (spec) => {
  const W = 900, H = 1000;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const long = spec.kind === "jacket";
  // Silhouette: shoulders at y=100, sleeves down to cuffs, hem at bottom.
  g.beginPath();
  g.moveTo(330, 70);                       // left neck
  g.quadraticCurveTo(450, 140, 570, 70);   // neckline
  g.lineTo(690, 110);                      // right shoulder
  if (long) { g.lineTo(860, 780); g.lineTo(760, 810); g.lineTo(675, 380); }
  else { g.lineTo(870, 330); g.lineTo(770, 400); g.lineTo(675, 300); }
  g.lineTo(680, 990);                      // right hem
  g.lineTo(220, 990);                      // left hem
  g.lineTo(225, long ? 380 : 300);
  if (long) { g.lineTo(140, 810); g.lineTo(40, 780); }
  else { g.lineTo(130, 400); g.lineTo(30, 330); }
  g.lineTo(210, 110);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, spec.shade); grad.addColorStop(0.3, spec.body); grad.addColorStop(0.7, spec.body); grad.addColorStop(1, spec.shade);
  g.fillStyle = grad; g.fill();
  g.lineWidth = 4; g.strokeStyle = spec.shade; g.stroke();
  // Fabric texture
  g.save(); g.clip();
  g.globalAlpha = 0.06; g.fillStyle = "#000";
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
  g.restore();
  // Collar / placket / details
  g.strokeStyle = spec.trim; g.lineWidth = 10;
  g.beginPath(); g.moveTo(335, 75); g.quadraticCurveTo(450, 150, 565, 75); g.stroke();
  if (spec.kind !== "tee") {
    g.lineWidth = 6; g.beginPath(); g.moveTo(450, 130); g.lineTo(450, 985); g.stroke();
    g.fillStyle = spec.trim;
    for (let y = 220; y < 960; y += 130) { g.beginPath(); g.arc(470, y, 9, 0, Math.PI * 2); g.fill(); }
  }
  if (spec.kind === "jacket") {
    g.strokeStyle = spec.trim; g.lineWidth = 4;
    g.strokeRect(275, 300, 120, 110); g.strokeRect(505, 300, 120, 110);
    g.beginPath(); g.moveTo(225, 860); g.lineTo(680, 860); g.stroke();
  }
  if (spec.kind === "tee") {
    g.fillStyle = "#2b2b2b"; g.font = "bold 46px Helvetica, Arial"; g.textAlign = "center";
    g.fillText("NORTHLINE", 450, 420);
  }
  return c.toDataURL("image/png");
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, spec] of Object.entries(garments)) {
  const data = await page.evaluate(draw, spec);
  writeFileSync(new URL(`${name}.png`, OUT), Buffer.from(data.split(",")[1], "base64"));
  console.log("wrote", name);
}
await browser.close();
