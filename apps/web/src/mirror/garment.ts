/**
 * Garment preparation for the LiveMirror: obtain an alpha-masked, tightly
 * cropped garment image. Product photos with transparent backgrounds are used
 * as-is; photos on plain backgrounds get a border flood-fill cutout.
 */

export interface PreparedGarment {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** How the cutout was obtained — shown to the user so quality is explainable. */
  cutout: "transparent-source" | "background-removed" | "none";
}

const WORK_SIZE = 900;

export async function prepareGarment(source: ImageBitmap): Promise<PreparedGarment> {
  const scale = Math.min(1, WORK_SIZE / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  let transparent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! < 20) transparent++;
  let cutout: PreparedGarment["cutout"] = "transparent-source";

  if (transparent / (w * h) < 0.03) {
    cutout = removeBorderBackground(d, w, h) ? "background-removed" : "none";
    ctx.putImageData(img, 0, 0);
  }
  return trimToContent(canvas, cutout);
}

/** Flood-fill from the border, clearing pixels close to the estimated background color. */
function removeBorderBackground(d: Uint8ClampedArray, w: number, h: number): boolean {
  // Estimate background from border pixels (median per channel).
  const samples: number[][] = [[], [], []];
  const sample = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    samples[0]!.push(d[p]!);
    samples[1]!.push(d[p + 1]!);
    samples[2]!.push(d[p + 2]!);
  };
  for (let x = 0; x < w; x += 3) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += 3) {
    sample(0, y);
    sample(w - 1, y);
  }
  const median = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1]!;
  const bg = samples.map(median) as [number, number, number];

  // Border must be fairly uniform, otherwise this isn't a plain-background photo.
  let uniform = 0;
  const n = samples[0]!.length;
  for (let i = 0; i < n; i++) {
    if (Math.abs(samples[0]![i]! - bg[0]) + Math.abs(samples[1]![i]! - bg[1]) + Math.abs(samples[2]![i]! - bg[2]) < 60) uniform++;
  }
  if (uniform / n < 0.6) return false;

  const tol = 46;
  const dist = (p: number) => Math.abs(d[p]! - bg[0]) + Math.abs(d[p + 1]! - bg[1]) + Math.abs(d[p + 2]! - bg[2]);
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (!visited[i]) {
      visited[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const p = i * 4;
    const dd = dist(p);
    if (dd > tol) continue;
    // Soft edge: partially transparent near the tolerance boundary.
    d[p + 3] = dd < tol * 0.6 ? 0 : Math.round(((dd - tol * 0.6) / (tol * 0.4)) * 255);
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return true;
}

function trimToContent(canvas: HTMLCanvasElement, cutout: PreparedGarment["cutout"]): PreparedGarment {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3]! > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { canvas, width: w, height: h, cutout: "none" };
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d")!.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: out, width: cw, height: ch, cutout };
}
