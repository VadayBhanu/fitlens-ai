export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8787";
export const EXTENSION_URL = (import.meta.env.VITE_EXTENSION_URL as string | undefined) || "";
export const POSE_MODEL_URL = "/mediapipe/pose_landmarker_lite.task";
export const POSE_MODEL_FALLBACK_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export const MEDIAPIPE_WASM_PATH = "/mediapipe/wasm";
