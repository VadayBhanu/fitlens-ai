import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { MEDIAPIPE_WASM_PATH, POSE_MODEL_FALLBACK_URL, POSE_MODEL_URL } from "./config";

/** MediaPipe Pose landmark indices used by FitLens. */
export const POSE = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24
} as const;

const cache = new Map<string, Promise<PoseLandmarker>>();

async function modelUrl(): Promise<string> {
  try {
    const head = await fetch(POSE_MODEL_URL, { method: "HEAD" });
    if (head.ok && !(head.headers.get("content-type") ?? "").includes("text/html")) return POSE_MODEL_URL;
  } catch {
    /* fall through */
  }
  return POSE_MODEL_FALLBACK_URL;
}

export interface LandmarkerOptions {
  mode: "IMAGE" | "VIDEO";
  numPoses?: number;
  /** "auto" tries the GPU first and falls back to the CPU. */
  delegate?: "auto" | "GPU" | "CPU";
  /** Also output a person segmentation mask (used for body calibration). */
  masks?: boolean;
}

/** Lazily create (and cache) a pose landmarker. */
export function getPoseLandmarker(opts: LandmarkerOptions): Promise<PoseLandmarker> {
  const { mode, numPoses = 1, delegate = "auto", masks = false } = opts;
  const key = `${mode}:${numPoses}:${delegate}:${masks}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
      const modelAssetPath = await modelUrl();
      const make = (d: "GPU" | "CPU") =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate: d },
          runningMode: mode,
          numPoses,
          minPoseDetectionConfidence: 0.4,
          minPosePresenceConfidence: 0.4,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: masks
        });
      if (delegate !== "auto") return make(delegate);
      try {
        return await make("GPU");
      } catch {
        return await make("CPU");
      }
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** A downscaled copy of an image, which detection handles more reliably than huge photos. */
function detectionCanvas(bitmap: ImageBitmap, maxSide = 960): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bitmap.width * scale));
  c.height = Math.max(1, Math.round(bitmap.height * scale));
  c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  return c;
}

function isPerson(pose: { visibility?: number }[]): boolean {
  const vis = (i: number) => pose[i]?.visibility ?? 0;
  // Upper body: at least one shoulder clearly visible plus the face, or both shoulders.
  const shoulders = [vis(POSE.leftShoulder), vis(POSE.rightShoulder)];
  return (shoulders.some((v) => v > 0.5) && vis(POSE.nose) > 0.5) || shoulders.every((v) => v > 0.35);
}

/**
 * Count people in a still photo (photo quality check). Uses the CPU delegate:
 * GPU inference on still images returns nothing on some drivers, and CPU is
 * plenty fast for a single photo. Falls back to the GPU if the CPU finds nobody.
 * Returns undefined if detection isn't available, so the user is never blocked by it.
 */
export async function countPeople(bitmap: ImageBitmap): Promise<number | undefined> {
  const canvas = detectionCanvas(bitmap);
  let count: number | undefined;
  for (const delegate of ["CPU", "GPU"] as const) {
    try {
      const lm = await getPoseLandmarker({ mode: "IMAGE", numPoses: 3, delegate });
      count = lm.detect(canvas).landmarks.filter(isPerson).length;
      if (count > 0) return count;
    } catch {
      /* try the next delegate */
    }
  }
  return count;
}
