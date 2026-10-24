import { add, dist, LandmarkSmoother, mid, normalize, scale, sub, type GarmentCategory, type Point2D, type TrackedPoint, type UpperBody } from "@fitlens/shared";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { getPoseLandmarker, POSE } from "../lib/pose";
import type { PreparedGarment } from "./garment";
import { DEFAULT_ADJUSTMENTS, type FitAdjustments, type MirrorRenderer, type TrackedPose } from "./types";

export { DEFAULT_ADJUSTMENTS, type FitAdjustments } from "./types";

export type TrackingState = "initializing" | "searching" | "tracking" | "partial" | "multiple-people" | "too-close" | "paused";

export interface MirrorStatus {
  state: TrackingState;
  fps: number;
  inferenceMs: number;
  confidence: number;
  message: string;
}

type Key = "lShoulder" | "rShoulder" | "lElbow" | "rElbow" | "lHip" | "rHip" | "lWrist" | "rWrist" | "nose";

const MESSAGES: Record<TrackingState, string> = {
  initializing: "Starting camera and body tracking…",
  searching: "Step back so your head, shoulders and waist are in view.",
  tracking: "Tracking — move naturally. Best results facing the camera.",
  partial: "Hips aren't visible, so the hem position is estimated.",
  "multiple-people": "More than one person detected. Please stay alone in the frame.",
  "too-close": "You're very close to the camera — step back a little.",
  paused: "Paused."
};

/**
 * LiveMirror engine: camera → pose tracking → smoothing → renderer.
 * The renderer (3D cloth simulation or flat 2D mesh) composites the camera
 * frame and the garment into its own canvas. Everything runs locally; no
 * frames leave the device. The canvas holds the true (non-mirrored) image so
 * captures and recordings match what others see; mirroring is a CSS flip.
 */
export class MirrorEngine {
  private stream: MediaStream | null = null;
  private landmarker: PoseLandmarker | null = null;
  private raf = 0;
  private running = false;
  private garment: PreparedGarment | null = null;
  private category: GarmentCategory = "top";
  private smoother = new LandmarkSmoother<Key>(0.55, 300, 1.0, 0.015);
  private opacity = 0;
  private lastFrameTs = 0;
  private fpsAvg = 0;
  private infAvg = 0;
  private lastStatusEmit = 0;
  private lastVideoTime = -1;
  private lastDetect = 0;
  private lastPose: TrackedPose | null = null;
  private lastState: TrackingState = "searching";
  private lastConfidence = 0;
  adjustments: FitAdjustments = { ...DEFAULT_ADJUSTMENTS };
  showGarment = true;
  showBodyModel = false;

  constructor(
    private renderer: MirrorRenderer,
    private readonly video: HTMLVideoElement,
    private readonly onStatus: (s: MirrorStatus) => void
  ) {}

  static async listCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }

  get rendererKind(): MirrorRenderer["kind"] {
    return this.renderer.kind;
  }

  /** Swap rendering mode (3D cloth ↔ flat) without restarting the camera. Renderers are owned by the caller. */
  setRenderer(renderer: MirrorRenderer): void {
    this.renderer = renderer;
    if (this.video.videoWidth) renderer.resize(this.video.videoWidth, this.video.videoHeight);
    renderer.setGarment(this.garment, this.category);
  }

  async start(deviceId?: string): Promise<void> {
    this.emit("initializing", 0, true);
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser doesn't support camera access.");
    this.stopStream();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    this.renderer.resize(this.video.videoWidth || 1280, this.video.videoHeight || 720);
    this.landmarker = await getPoseLandmarker("VIDEO", 2);
    this.running = true;
    this.smoother.reset();
    this.loop();
  }

  setGarment(g: PreparedGarment | null, category: GarmentCategory): void {
    this.garment = g;
    this.category = category;
    this.renderer.setGarment(g, category);
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.emit("paused", 0, true);
  }

  resume(): void {
    if (this.running || !this.stream) return;
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stopStream();
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const now = performance.now();
    if (this.lastFrameTs) this.fpsAvg = this.fpsAvg * 0.9 + (1000 / Math.max(now - this.lastFrameTs, 1)) * 0.1;
    this.lastFrameTs = now;
    this.frame(now);
  };

  private frame(now: number): void {
    if (!this.landmarker) return;
    // Adaptive inference rate: on slow devices (no GPU), detect less often and
    // keep rendering with the last known pose so the preview stays responsive.
    if (now - this.lastDetect >= Math.min(this.infAvg * 1.5, 400)) {
      this.lastDetect = now;
      this.detect(now);
    }
    const pose = this.lastPose;
    const state = this.lastState;
    // Fade in when tracking, fade out when lost — never leave a floating garment.
    const target = pose && state !== "too-close" && this.showGarment ? 1 : 0;
    this.opacity += (target - this.opacity) * 0.25;
    this.renderer.render({
      video: this.video,
      pose: state === "too-close" ? null : pose,
      opacity: this.opacity,
      adjustments: this.adjustments,
      timeMs: now,
      showBodyModel: this.showBodyModel
    });
    this.emit(state, this.lastConfidence);
  }

  private detect(now: number): void {
    const W = this.video.videoWidth || 1280;
    const H = this.video.videoHeight || 720;
    const t0 = performance.now();
    const result = this.landmarker!.detectForVideo(this.video, now);
    this.infAvg = this.infAvg * 0.9 + (performance.now() - t0) * 0.1;

    const poses = result.landmarks;
    // Several people: follow the largest (closest) one, and tell the user.
    if (poses.length > 1) poses.sort((a, b) => spread(b) - spread(a));
    const lm = poses[0];
    let state: TrackingState = "searching";
    let confidence = 0;
    let pose: TrackedPose | null = null;

    if (lm) {
      // Camera space (not mirrored): the person's RIGHT side appears on the
      // image LEFT, which is also where a front-facing garment photo puts the
      // wearer's right sleeve. So image-left = MediaPipe "right" landmarks.
      // z is MediaPipe's relative depth, scaled like x (so × width = pixels).
      const P = (i: number): TrackedPoint | undefined => {
        const l = lm[i];
        return l ? { x: l.x * W, y: l.y * H, z: l.z * W, confidence: l.visibility ?? 0.9 } : undefined;
      };
      const raw: Record<Key, TrackedPoint | undefined> = {
        lShoulder: P(POSE.rightShoulder),
        rShoulder: P(POSE.leftShoulder),
        lElbow: P(POSE.rightElbow),
        rElbow: P(POSE.leftElbow),
        lWrist: P(POSE.rightWrist),
        rWrist: P(POSE.leftWrist),
        lHip: P(POSE.rightHip),
        rHip: P(POSE.leftHip),
        nose: P(POSE.nose)
      };
      const s = this.smoother.update(raw, now);
      confidence = Math.min(raw.lShoulder?.confidence ?? 0, raw.rShoulder?.confidence ?? 0);
      if (s.lShoulder && s.rShoulder) {
        const shoulderW = dist(s.lShoulder, s.rShoulder);
        let lHip = s.lHip;
        let rHip = s.rHip;
        let hipsEstimated = false;
        state = poses.length > 1 ? "multiple-people" : "tracking";
        if (!lHip || !rHip) {
          // Estimate hips from shoulders when the waist is out of frame.
          const across = normalize(sub(s.rShoulder, s.lShoulder));
          const down = { x: -across.y, y: across.x };
          const len = shoulderW * 1.5;
          lHip = add(s.lShoulder, add(scale(down, len), scale(across, shoulderW * 0.12)));
          rHip = add(s.rShoulder, add(scale(down, len), scale(across, -shoulderW * 0.12)));
          hipsEstimated = true;
          if (state === "tracking") state = "partial";
        }
        if (shoulderW > W * 0.75) state = "too-close";
        const body = this.applyAdjustments({ leftShoulder: s.lShoulder, rightShoulder: s.rShoulder, leftHip: lHip, rightHip: rHip, leftElbow: s.lElbow, rightElbow: s.rElbow });
        pose = { body, leftWrist: this.adjustPoint(s.lWrist, body), rightWrist: this.adjustPoint(s.rWrist, body), head: s.nose, hipsEstimated };
      }
    } else {
      this.smoother.update(
        { lShoulder: undefined, rShoulder: undefined, lElbow: undefined, rElbow: undefined, lWrist: undefined, rWrist: undefined, lHip: undefined, rHip: undefined, nose: undefined },
        now
      );
    }
    this.lastPose = pose;
    this.lastState = state;
    this.lastConfidence = confidence;
  }

  private adjustCenter: Point2D = { x: 0, y: 0 };
  private adjustTorso = 0;

  /** Apply the user's size/position adjustments around the torso centre (depth is preserved). */
  private applyAdjustments(b: UpperBody): UpperBody {
    this.adjustCenter = mid(mid(b.leftShoulder, b.rightShoulder), mid(b.leftHip, b.rightHip));
    this.adjustTorso = dist(mid(b.leftShoulder, b.rightShoulder), mid(b.leftHip, b.rightHip));
    if (this.adjustments.size === 1 && this.adjustments.offsetY === 0) return b;
    const tf = (p?: Point2D) => this.adjustPoint(p, b);
    return { leftShoulder: tf(b.leftShoulder)!, rightShoulder: tf(b.rightShoulder)!, leftHip: tf(b.leftHip)!, rightHip: tf(b.rightHip)!, leftElbow: tf(b.leftElbow), rightElbow: tf(b.rightElbow) };
  }

  private adjustPoint(p: Point2D | undefined, _b: UpperBody): Point2D | undefined {
    if (!p) return undefined;
    const { size, offsetY } = this.adjustments;
    if (size === 1 && offsetY === 0) return p;
    const c = this.adjustCenter;
    return { x: c.x + (p.x - c.x) * size, y: c.y + (p.y - c.y) * size + offsetY * this.adjustTorso, z: p.z };
  }

  private emit(state: TrackingState, confidence: number, force = false): void {
    const now = performance.now();
    if (!force && now - this.lastStatusEmit < 250) return;
    this.lastStatusEmit = now;
    this.onStatus({ state, fps: Math.round(this.fpsAvg), inferenceMs: Math.round(this.infAvg), confidence: Math.round(confidence * 100) / 100, message: MESSAGES[state] });
  }
}

function spread(pose: { x: number; y: number }[]): number {
  const a = pose[POSE.leftShoulder];
  const b = pose[POSE.rightShoulder];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}
