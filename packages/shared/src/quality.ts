/**
 * Input-photo quality checks that run in the browser before anything is
 * uploaded. Cheap, deterministic heuristics — they catch obviously unusable
 * photos, they do not certify a photo as good.
 */

export interface ImageStats {
  width: number;
  height: number;
  brightness: number;
  sharpness: number;
}

/** Compute mean luma and variance of a 4-neighbour Laplacian on RGBA pixels. */
export function computeImageStats(data: Uint8ClampedArray | Uint8Array, width: number, height: number, originalWidth = width, originalHeight = height): ImageStats {
  const n = width * height;
  const gray = new Float32Array(n);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const y = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
    gray[i] = y;
    sum += y;
  }
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = gray[i - 1]! + gray[i + 1]! + gray[i - width]! + gray[i + width]! - 4 * gray[i]!;
      lapSum += l;
      lapSq += l * l;
      count++;
    }
  }
  const mean = count ? lapSum / count : 0;
  const variance = count ? lapSq / count - mean * mean : 0;
  return { width: originalWidth, height: originalHeight, brightness: n ? sum / n : 0, sharpness: Math.max(variance, 0) };
}

export interface QualityAssessment {
  ok: boolean;
  blocking: string[];
  warnings: string[];
  /**
   * On-device detection found nobody. Not blocking on its own — detection can
   * miss people in unusual photos — so the UI asks the user to confirm.
   */
  personNotDetected: boolean;
}

export function assessPersonPhoto(stats: ImageStats, people?: number): QualityAssessment {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const shortSide = Math.min(stats.width, stats.height);
  if (shortSide < 384) blocking.push("Photo resolution is too low. Use a photo at least 512px on the short side.");
  else if (shortSide < 640) warnings.push("Low resolution — results will be sharper with a larger photo.");
  if (stats.brightness < 45) blocking.push("Photo is too dark. Try brighter, even lighting.");
  else if (stats.brightness < 70) warnings.push("Photo is a little dark.");
  if (stats.brightness > 235) blocking.push("Photo is overexposed.");
  if (stats.sharpness < 25) blocking.push("Photo looks blurry. Hold the camera steady or use a sharper photo.");
  else if (stats.sharpness < 60) warnings.push("Photo may be slightly blurry.");
  const personNotDetected = people === 0;
  if (personNotDetected) warnings.push("We couldn't clearly detect a person. Make sure your face and upper body are visible.");
  if (people !== undefined && people > 1) blocking.push("Several people detected. Use a photo with only you in it.");
  if (stats.width > stats.height * 1.3) warnings.push("Portrait (vertical) photos usually work best.");
  return { ok: blocking.length === 0, blocking, warnings, personNotDetected };
}
