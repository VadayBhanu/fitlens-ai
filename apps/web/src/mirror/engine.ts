import {
  add,
  BodyCalibrator,
  DEFAULT_PROFILE,
  dist,
  LandmarkSmoother,
  mid,
  normalize,
  scale,
  sub,
  type BodyProfile,
  type CalibLandmarks,
  type CalibrationProgress,
  type GarmentCategory,
  type PersonMask,
  type Point2D,
  type TrackedPoint,
  type UpperBody
} from "@fitlens/shared";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { getPoseLandmarker, POSE } from "../lib/pose";
import type { PreparedGarment } from "./garment";
import { DEFAULT_ADJUSTMENTS, type FitAdjustments, type MirrorRenderer, type TrackedPose } from "./types";

export { DEFAULT_ADJUSTMENTS, type FitAdjustments } from "./types";

export type TrackingState = "initializing" | "calibrating" | "searching" | "tracking" | "partial" | "face-hidden" | "multiple-people" | "too-close" | "paused";

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
  calibrating: "Calibrating — follow the checklist.",
  "face-hidden": "Keep your face in the frame so we can track your body accurately.",
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
  private mode: "live" | "calibrating" = "live";
  private calibrator = new BodyCalibrator();
  private lastCalibEmit = 0;
  private faceMissingSince: number | null = null;
  onCalibration: ((p: CalibrationProgress) => void) | null = null;
  profile: BodyProfile = DEFAULT_PROFILE;
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
    this.landmarker = await getPoseLandmarker({ mode: "VIDEO", numPoses: 2 });
    this.running = true;
    this.smoother.reset();
    this.loop();
  }

  get calibrating(): boolean {
    return this.mode === "calibrating";
  }

  /**
   * Guided calibration: the garment is hidden while the user lines up; a
   * segmentation-enabled tracker measures their real body outline.
   */
  async startCalibration(requireHips = true): Promise<void> {
    this.calibrator.reset();
    this.calibrator.requireHips = requireHips;
    // One tracker for everything: two GPU pose graphs on one page can starve
    // each other, so segmentation output is switched on only while calibrating.
    await this.landmarker?.setOptions({ outputSegmentationMasks: true });
    this.mode = "calibrating";
    this.emit("calibrating", 0, true);
  }

  setRequireHips(requireHips: boolean): void {
    this.calibrator.requireHips = requireHips;
  }

  /** Leave calibration (keeping the current profile). */
  finishCalibration(): void {
    if (this.mode === "calibrating") void this.landmarker?.setOptions({ outputSegmentationMasks: false }).catch(() => undefined);
    this.mode = "live";
    this.smoother.reset();
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
    if (this.mode === "calibrating" && this.landmarker) {
      this.calibrate(now);
      this.renderer.render({ video: this.video, pose: null, opacity: 0, adjustments: this.adjustments, timeMs: now, showBodyModel: false, profile: this.profile });
      this.emit("calibrating", 0);
      return;
    }
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
      showBodyModel: this.showBodyModel,
      profile: this.profile
    });
    this.emit(state, this.lastConfidence);
  }

  private calibrate(now: number): void {
    const W = this.video.videoWidth || 1280;
    const H = this.video.videoHeight || 720;
    const result = this.landmarker!.detectForVideo(this.video, now);
    const lm = result.landmarks[0];
    const P = (i: number) => {
      const l = lm?.[i];
      return l ? { x: l.x * W, y: l.y * H, z: l.z * W, visibility: l.visibility ?? 0.9 } : undefined;
    };
    // Image-left = the person's right side (see detect()).
    const landmarks: CalibLandmarks = {
      nose: P(POSE.nose),
      eyeL: P(POSE.rightEye),
      eyeR: P(POSE.leftEye),
      shoulderL: P(POSE.rightShoulder),
      shoulderR: P(POSE.leftShoulder),
      elbowL: P(POSE.rightElbow),
      elbowR: P(POSE.leftElbow),
      wristL: P(POSE.rightWrist),
      wristR: P(POSE.leftWrist),
      hipL: P(POSE.rightHip),
      hipR: P(POSE.leftHip)
    };
    let mask: PersonMask | undefined;
    const m = result.segmentationMasks?.[0];
    try {
      // Reading the mask back is costly, so only do it while collecting samples.
      if (m && this.calibrator.wantsSamples) mask = { data: m.getAsFloat32Array().slice(), width: m.width, height: m.height, threshold: 0.5 };
    } catch {
      // Mask readback unsupported on this GPU: calibrate from landmarks (outline uses typical widths).
      mask = undefined;
    } finally {
      result.segmentationMasks?.forEach((x) => x.close());
    }
    const progress = this.calibrator.update(landmarks, W, H, now, mask);
    if (progress.profile) {
      this.profile = progress.profile;
      this.finishCalibration();
    }
    if (progress.profile || now - this.lastCalibEmit > 120) {
      this.lastCalibEmit = now;
      this.onCalibration?.(progress);
    }
  }

  private detect(now: number): void {
    const W = this.video.videoWidth || 1280;
    const H = this.video.videoHeight || 720;
    const t0 = performance.now();
    const result = this.landmarker!.detectForVideo(this.video, now);
    // Masks may still arrive for a frame or two after calibration ends.
    result.segmentationMasks?.forEach((m) => m.close());
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
          // Calibrated proportions: torso length and hip width relative to the shoulders.
          const len = shoulderW * this.profile.torsoRatio;
          const inset = (shoulderW * (1 - this.profile.hipJointRatio)) / 2;
          lHip = add(s.lShoulder, add(scale(down, len), scale(across, inset)));
          rHip = add(s.rShoulder, add(scale(down, len), scale(across, -inset)));
          hipsEstimated = true;
          if (state === "tracking") state = "partial";
        }
        // The face anchors tracking (and the collar): ask the user to keep it in view.
        const faceVisible = (raw.nose?.confidence ?? 0) > 0.5;
        if (faceVisible) this.faceMissingSince = null;
        else this.faceMissingSince ??= now;
        if (this.faceMissingSince !== null && now - this.faceMissingSince > 1000 && state !== "multiple-people") state = "face-hidden";
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
