import { assessPersonPhoto, computeImageStats, type ImageStats, type QualityAssessment } from "@fitlens/shared";

export interface Prepared {
  blob: Blob;
  url: string;
  stats: ImageStats;
  assessment: QualityAssessment;
}

/** Resize, strip metadata (re-encode) and quality-check a photo before upload. */
export async function preparePhoto(file: Blob, type: "image/jpeg" | "image/png" = "image/jpeg"): Promise<Prepared> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("We couldn't read that image. Use a JPEG, PNG or WebP.");
  }
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type, quality: 0.92 });
  const sw = Math.min(256, w);
  const sh = Math.round((h / w) * sw);
  const small = new OffscreenCanvas(sw, sh);
  const sctx = small.getContext("2d")!;
  sctx.drawImage(bitmap, 0, 0, sw, sh);
  const stats = computeImageStats(sctx.getImageData(0, 0, sw, sh).data, sw, sh, w, h);
  bitmap.close();
  return { blob, url: URL.createObjectURL(blob), stats, assessment: assessPersonPhoto(stats) };
}
