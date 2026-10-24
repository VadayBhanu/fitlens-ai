import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { MEDIAPIPE_WASM_PATH, POSE_MODEL_FALLBACK_URL, POSE_MODEL_URL } from "./config";

/** MediaPipe Pose landmark indices used by FitLens. */
export const POSE = {
  nose: 0,
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

/** Lazily create (and cache) a pose landmarker. GPU first, CPU fallback. */
export function getPoseLandmarker(mode: "IMAGE" | "VIDEO", numPoses = 2): Promise<PoseLandmarker> {
  const key = `${mode}:${numPoses}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
      const modelAssetPath = await modelUrl();
      const opts = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath, delegate },
        runningMode: mode,
        numPoses,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      try {
        return await PoseLandmarker.createFromOptions(fileset, opts("GPU"));
      } catch {
        return await PoseLandmarker.createFromOptions(fileset, opts("CPU"));
      }
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Count people in a still photo (used by the photo quality check). */
export async function countPeople(bitmap: ImageBitmap): Promise<number | undefined> {
  try {
    const lm = await getPoseLandmarker("IMAGE", 3);
    const res = lm.detect(bitmap);
    return res.landmarks.filter((pose) => {
      const s = [pose[POSE.leftShoulder], pose[POSE.rightShoulder]];
      return s.every((p) => p && (p.visibility ?? 1) > 0.4);
    }).length;
  } catch {
    return undefined; // detection unavailable — don't block the user
  }
}
