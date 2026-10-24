import {
  add,
  computeGarmentLayout,
  DEFAULT_ANCHORS,
  dist,
  LandmarkSmoother,
  mid,
  normalize,
  scale,
  sub,
  type GarmentAnchors,
  type GarmentCategory,
  type Point2D,
  type TrackedPoint,
  type UpperBody
} from "@fitlens/shared";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { getPoseLandmarker, POSE } from "../lib/pose";
import type { PreparedGarment } from "./garment";
import { renderGarment } from "./renderer";

export type TrackingState = "initializing" | "searching" | "tracking" | "partial" | "multiple-people" | "too-close" | "paused";

export interface MirrorStatus {
  state: TrackingState;
  fps: number;
  inferenceMs: number;
  confidence: number;
  message: string;
}

export interface FitAdjustments {
  /** Overall size multiplier. */
  size: number;
  /** Vertical offset as a fraction of torso length (+ = down). */
  offsetY: number;
  /** Extra width multiplier. */
  width: number;
  /** Hem length multiplier. */
  length: number;
}

export const DEFAULT_ADJUSTMENTS: FitAdjustments = { size: 1, offsetY: 0, width: 1, length: 1 };

type Key = "lShoulder" | "rShoulder" | "lElbow" | "rElbow" | "lHip" | "rHip" | "lWrist" | "rWrist";

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
 * LiveMirror: camera → pose tracking → smoothing → garment layout → compositor.
 * Everything runs locally in the browser; no frames leave the device.
 * The canvas holds the true (non-mirrored) image so captures and recordings
 * match what other people would see. Mirroring for the preview is a CSS flip.
 */
export class MirrorEngine {
  private stream: MediaStream | null = null;
  private landmarker: PoseLandmarker | null = null;
  private raf = 0;
  private running = false;
  private garment: PreparedGarment | null = null;
  private anchors: GarmentAnchors = DEFAULT_ANCHORS.top;
  private smoother = new LandmarkSmoother<Key>(0.55, 300, 1.0, 0.015);
  private opacity = 0;
  private lastFrameTs = 0;
  private fpsAvg = 0;
  private infAvg = 0;
  private lastStatusEmit = 0;
  private lastVideoTime = -1;
  private lastDetect = 0;
  private lastBody: UpperBody | null = null;
  private lastState: TrackingState = "searching";
  private lastConfidence = 0;
  private lastPoints: Partial<Record<Key, Point2D>> = {};
  adjustments: FitAdjustments = { ...DEFAULT_ADJUSTMENTS };
  showGarment = true;
  showSkeleton = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement,
    private readonly onStatus: (s: MirrorStatus) => void
  ) {}

  static async listCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
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
    this.canvas.width = this.video.videoWidth || 1280;
    this.canvas.height = this.video.videoHeight || 720;
    this.landmarker = await getPoseLandmarker("VIDEO", 2);
    this.running = true;
    this.smoother.reset();
    this.loop();
  }

  setGarment(g: PreparedGarment | null, category: GarmentCategory): void {
    this.garment = g;
    this.anchors = category === "outerwear" ? DEFAULT_ANCHORS.outerwear : category === "dress" ? DEFAULT_ANCHORS.dress : DEFAULT_ANCHORS.top;
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

  get mediaStream(): MediaStream | null {
    return this.stream;
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
    const ctx = this.canvas.getContext("2d")!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.drawImage(this.video, 0, 0, W, H);
    if (!this.landmarker) return;

    // Adaptive inference rate: on slow devices (no GPU), detect less often and
    // keep compositing the last known pose so the preview stays responsive.
    if (now - this.lastDetect >= Math.min(this.infAvg * 1.5, 400)) {
      this.lastDetect = now;
      this.detect(W, H, now);
    }
    const body = this.lastBody;
    const state = this.lastState;
    const confidence = this.lastConfidence;
    if (this.showSkeleton) drawSkeleton(ctx, this.lastPoints);

    // Fade in when tracking, fade out when lost — never leave a floating garment.
    const target = body && state !== "too-close" && this.showGarment ? 1 : 0;
    this.opacity += (target - this.opacity) * 0.25;

    if (body && this.garment && this.opacity > 0.01) {
      const layout = computeGarmentLayout(body, this.anchors, { hemExtension: 0.12 * this.adjustments.length + (this.adjustments.length - 1) * 0.6, shoulderEase: 1.18 * this.adjustments.width });
      const torsoMinX = Math.min(layout.torso[0].x, layout.torso[3].x);
      const torsoMaxX = Math.max(layout.torso[1].x, layout.torso[2].x);
      const inside = (p?: Point2D) => !!p && p.x > torsoMinX + 10 && p.x < torsoMaxX - 10;
      renderGarment(ctx, this.garment, this.anchors, layout, {
        opacity: this.opacity,
        leftArmInFront: inside(body.leftElbow),
        rightArmInFront: inside(body.rightElbow)
      });
    }
    this.emit(state, confidence);
  }

  private detect(W: number, H: number, now: number): void {
    if (!this.landmarker) return;
    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(this.video, now);
    this.infAvg = this.infAvg * 0.9 + (performance.now() - t0) * 0.1;

    const poses = result.landmarks;
    if (poses.length > 1) {
      // Pick the larger (closer) person, but tell the user.
      poses.sort((a, b) => spread(b) - spread(a));
    }
    const pose = poses[0];
    let state: TrackingState = "searching";
    let confidence = 0;
    let body: UpperBody | null = null;

    if (pose) {
      // Camera space (not mirrored): the person's RIGHT side appears on the
      // image LEFT, which is also where a front-facing garment photo puts the
      // wearer's right sleeve. So image-left = MediaPipe "right" landmarks.
      const P = (i: number): TrackedPoint | undefined => {
        const l = pose[i];
        return l ? { x: l.x * W, y: l.y * H, confidence: l.visibility ?? 0.9 } : undefined;
      };
      const raw: Record<Key, TrackedPoint | undefined> = {
        lShoulder: P(POSE.rightShoulder),
        rShoulder: P(POSE.leftShoulder),
        lElbow: P(POSE.rightElbow),
        rElbow: P(POSE.leftElbow),
        lWrist: P(POSE.rightWrist),
        rWrist: P(POSE.leftWrist),
        lHip: P(POSE.rightHip),
        rHip: P(POSE.leftHip)
      };
      const s = this.smoother.update(raw, now);
      confidence = Math.min(raw.lShoulder?.confidence ?? 0, raw.rShoulder?.confidence ?? 0);
      if (s.lShoulder && s.rShoulder) {
        const shoulderW = dist(s.lShoulder, s.rShoulder);
        let lHip = s.lHip;
        let rHip = s.rHip;
        state = poses.length > 1 ? "multiple-people" : "tracking";
        if (!lHip || !rHip) {
          // Estimate hips from shoulders when the waist is out of frame.
          const across = normalize(sub(s.rShoulder, s.lShoulder));
          const down = { x: -across.y, y: across.x };
          const len = shoulderW * 1.5;
          lHip = add(s.lShoulder, add(scale(down, len), scale(across, shoulderW * 0.12)));
          rHip = add(s.rShoulder, add(scale(down, len), scale(across, -shoulderW * 0.12)));
          if (state === "tracking") state = "partial";
        }
        if (shoulderW > W * 0.75) state = "too-close";
        body = this.applyAdjustments({ leftShoulder: s.lShoulder, rightShoulder: s.rShoulder, leftHip: lHip, rightHip: rHip, leftElbow: s.lElbow, rightElbow: s.rElbow });
      }
      this.lastPoints = s;
    } else {
      this.smoother.update({ lShoulder: undefined, rShoulder: undefined, lElbow: undefined, rElbow: undefined, lWrist: undefined, rWrist: undefined, lHip: undefined, rHip: undefined }, now);
      this.lastPoints = {};
    }

    this.lastBody = body;
    this.lastState = state;
    this.lastConfidence = confidence;
  }

  private applyAdjustments(b: UpperBody): UpperBody {
    const { size, offsetY } = this.adjustments;
    if (size === 1 && offsetY === 0) return b;
    const c = mid(mid(b.leftShoulder, b.rightShoulder), mid(b.leftHip, b.rightHip));
    const torsoLen = dist(mid(b.leftShoulder, b.rightShoulder), mid(b.leftHip, b.rightHip));
    const tf = (p?: Point2D) => (p ? { x: c.x + (p.x - c.x) * size, y: c.y + (p.y - c.y) * size + offsetY * torsoLen } : undefined);
    return {
      leftShoulder: tf(b.leftShoulder)!,
      rightShoulder: tf(b.rightShoulder)!,
      leftHip: tf(b.leftHip)!,
      rightHip: tf(b.rightHip)!,
      leftElbow: tf(b.leftElbow),
      rightElbow: tf(b.rightElbow)
    };
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

function drawSkeleton(ctx: CanvasRenderingContext2D, s: Partial<Record<Key, Point2D>>): void {
  const lines: [Key, Key][] = [
    ["lShoulder", "rShoulder"],
    ["lShoulder", "lElbow"],
    ["lElbow", "lWrist"],
    ["rShoulder", "rElbow"],
    ["rElbow", "rWrist"],
    ["lShoulder", "lHip"],
    ["rShoulder", "rHip"],
    ["lHip", "rHip"]
  ];
  ctx.save();
  ctx.strokeStyle = "rgba(187,167,255,0.9)";
  ctx.lineWidth = 3;
  for (const [a, b] of lines) {
    const p = s[a];
    const q = s[b];
    if (!p || !q) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  ctx.fillStyle = "#6D5DF6";
  for (const p of Object.values(s)) {
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
