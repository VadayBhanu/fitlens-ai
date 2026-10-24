import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test fixtures that are downloaded, not committed:
 *  - person.jpg: MediaPipe's public pose test photo (anonymous stock image)
 *  - person.mjpeg: a short fake-camera clip built from it, with gentle motion
 */
export const FIXTURES = join(__dirname, ".fixtures");
const PERSON_URL = "https://storage.googleapis.com/mediapipe-assets/pose.jpg";

export default async function globalSetup() {
  mkdirSync(FIXTURES, { recursive: true });
  const person = join(FIXTURES, "person.jpg");
  if (!existsSync(person)) {
    const res = await fetch(PERSON_URL);
    if (!res.ok) throw new Error(`Couldn't download test photo: HTTP ${res.status}`);
    writeFileSync(person, Buffer.from(await res.arrayBuffer()));
  }
  const mjpeg = join(FIXTURES, "person.mjpeg");
  if (!existsSync(mjpeg)) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const b64 = readFileSync(person).toString("base64");
    const frames: string[] = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${data}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const g = c.getContext("2d")!;
      const out: string[] = [];
      for (let i = 0; i < 60; i++) {
        const dx = Math.sin((i / 60) * Math.PI * 2) * 20;
        const s = 480 / img.height;
        g.fillStyle = "#88a";
        g.fillRect(0, 0, 640, 480);
        g.drawImage(img, (640 - img.width * s) / 2 + dx, 0, img.width * s, 480);
        out.push(c.toDataURL("image/jpeg", 0.85).split(",")[1]!);
      }
      return out;
    }, b64);
    writeFileSync(mjpeg, Buffer.concat(frames.map((f) => Buffer.from(f, "base64"))));
    await browser.close();
  }
}
