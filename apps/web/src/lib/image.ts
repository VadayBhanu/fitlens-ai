import { computeImageStats, type ImageStats } from "@fitlens/shared";

export interface PreparedImage {
  blob: Blob;
  previewUrl: string;
  stats: ImageStats;
  bitmap: ImageBitmap;
}

export async function loadBitmap(src: Blob | string): Promise<ImageBitmap> {
  if (typeof src !== "string") return createImageBitmap(src, { imageOrientation: "from-image" });
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return createImageBitmap(img);
}

/**
 * Normalize a photo for upload: apply EXIF orientation, cap the long side,
 * re-encode as JPEG (which also strips EXIF metadata such as GPS location),
 * and compute quality statistics on a downsampled copy.
 */
export async function prepareImage(file: Blob, maxSide = 2048, type: "image/jpeg" | "image/png" = "image/jpeg"): Promise<PreparedImage> {
  if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.type) && file.type !== "") {
    throw new Error("Please choose a JPEG, PNG or WebP image.");
  }
  if (file.size > 25 * 1024 * 1024) throw new Error("That image is larger than 25 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("We couldn't read that image. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), type, 0.92));

  const sw = Math.min(256, w);
  const sh = Math.round((h / w) * sw);
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(canvas, 0, 0, sw, sh);
  const stats = computeImageStats(sctx.getImageData(0, 0, sw, sh).data, sw, sh, w, h);
  const out = await createImageBitmap(canvas);
  bitmap.close();
  return { blob, previewUrl: URL.createObjectURL(blob), stats, bitmap: out };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not capture image"))), type, quality));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  downloadBlob(await res.blob(), filename);
}
