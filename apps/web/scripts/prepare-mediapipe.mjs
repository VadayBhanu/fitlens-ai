// Self-host MediaPipe's WASM runtime and the pose model so the Live Mirror has
// no third-party runtime dependency (and works under a strict CSP).
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The package doesn't export package.json, so resolve its entry and walk up.
const pkgDir = dirname(require.resolve("@mediapipe/tasks-vision"));
const out = join(here, "../public/mediapipe");
mkdirSync(join(out, "wasm"), { recursive: true });
// FilesetResolver.forVisionTasks() loads the SIMD or no-SIMD build (not the ES-module variant).
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  copyFileSync(join(pkgDir, "wasm", f), join(out, "wasm", f));
}

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const modelPath = join(out, "pose_landmarker_lite.task");
if (!existsSync(modelPath)) {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log("Downloaded pose model.");
  } catch (e) {
    console.warn(`Could not download the pose model (${e.message}). The app will load it from Google's CDN at runtime.`);
  }
}
console.log("MediaPipe assets ready in public/mediapipe.");
