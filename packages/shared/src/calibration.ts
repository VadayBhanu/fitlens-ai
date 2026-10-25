/**
 * Personal body calibration for the LiveMirror.
 *
 * Pose landmarks give joint centres (shoulder/hip joints sit inside the body),
 * not the body's outline. A short guided calibration — the user stands facing
 * the camera, face and hips in view, arms slightly out — measures:
 *   - proportions from landmarks (torso length, hip width, arm lengths, neck),
 *   - the real body outline (chest, waist, hip widths) from the person
 *     segmentation mask.
 * Everything is expressed relative to the shoulder-joint width, so the profile
 * works at any distance from the camera. It never leaves the device.
 */

export interface CalibPoint {
  x: number;
  y: number;
  z?: number;
  visibility: number;
}

/** Landmarks in video pixels, already mapped so "l" = image-left. */
export interface CalibLandmarks {
  nose?: CalibPoint;
  eyeL?: CalibPoint;
  eyeR?: CalibPoint;
  shoulderL?: CalibPoint;
  shoulderR?: CalibPoint;
  elbowL?: CalibPoint;
  elbowR?: CalibPoint;
  wristL?: CalibPoint;
  wristR?: CalibPoint;
  hipL?: CalibPoint;
  hipR?: CalibPoint;
}

export interface BodyProfile {
  version: 1;
  /** Shoulder-midpoint → hip-midpoint distance / shoulder-joint width. */
  torsoRatio: number;
  /** Hip-joint width / shoulder-joint width. */
  hipJointRatio: number;
  /** Outer body width at chest / waist / hips, / shoulder-joint width. */
  chestRatio: number;
  waistRatio: number;
  hipRatio: number;
  upperArmRatio: number;
  forearmRatio: number;
  /** Shoulder line → nose (vertical) / shoulder-joint width. */
  neckRatio: number;
  measuredOutline: boolean;
  hipsMeasured: boolean;
  calibratedAt: string;
}

/** Typical adult proportions, used until (or instead of) a calibration. */
export const DEFAULT_PROFILE: BodyProfile = {
  version: 1,
  torsoRatio: 1.45,
  hipJointRatio: 0.62,
  chestRatio: 1.22,
  waistRatio: 1.08,
  hipRatio: 1.18,
  upperArmRatio: 0.85,
  forearmRatio: 0.75,
  neckRatio: 0.75,
  measuredOutline: false,
  hipsMeasured: false,
  calibratedAt: ""
};

export type CalibCheckId = "face" | "centered" | "distance" | "shoulders" | "hips" | "facing" | "arms" | "still";

export interface CalibCheck {
  id: CalibCheckId;
  label: string;
  ok: boolean;
  /** What to do when not ok. */
  hint: string;
}

const vis = (p: CalibPoint | undefined, min: number) => !!p && p.visibility >= min;
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Angle (degrees) between the upper arm and the body's downward axis. */
function armAngle(shoulder: CalibPoint, elbow: CalibPoint, down: { x: number; y: number }): number {
  const ax = elbow.x - shoulder.x;
  const ay = elbow.y - shoulder.y;
  const len = Math.hypot(ax, ay) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, (ax * down.x + ay * down.y) / len))) * 180) / Math.PI;
}

/**
 * Evaluate one frame against the calibration requirements.
 * `motion` is recent shoulder movement as a fraction of shoulder width.
 */
export function evaluateCalibration(lm: CalibLandmarks, W: number, H: number, motion: number, requireHips = true): CalibCheck[] {
  const checks: CalibCheck[] = [];
  const face = vis(lm.nose, 0.6) && vis(lm.eyeL, 0.5) && vis(lm.eyeR, 0.5) && lm.nose!.y > H * 0.03;
  checks.push({ id: "face", label: "Face in frame", ok: face, hint: "Keep your whole face inside the frame." });

  const shoulders = vis(lm.shoulderL, 0.7) && vis(lm.shoulderR, 0.7);
  checks.push({ id: "shoulders", label: "Shoulders visible", ok: shoulders, hint: "Make sure both shoulders are in view." });

  let centered = false;
  let distanceOk = false;
  let distanceHint = "Stand so your shoulders are in view.";
  let facing = false;
  let arms = false;
  let hipsOk = false;
  if (shoulders) {
    const sL = lm.shoulderL!;
    const sR = lm.shoulderR!;
    const sw = d2(sL, sR);
    const mid = midpoint(sL, sR);
    centered = Math.abs(mid.x - W / 2) < W * 0.12;
    const frac = sw / W;
    distanceOk = frac >= 0.09 && frac <= 0.4;
    distanceHint = frac > 0.4 ? "Step back a little." : frac < 0.09 ? "Come a little closer." : "";
    const roll = (Math.atan2(sR.y - sL.y, sR.x - sL.x) * 180) / Math.PI;
    const depthSkew = sL.z !== undefined && sR.z !== undefined ? Math.abs(sL.z - sR.z) / sw : 0;
    const noseBetween = !lm.nose || (lm.nose.x > Math.min(sL.x, sR.x) && lm.nose.x < Math.max(sL.x, sR.x));
    facing = Math.abs(roll) < 8 && depthSkew < 0.35 && noseBetween;

    const hipsVisible = vis(lm.hipL, 0.6) && vis(lm.hipR, 0.6) && lm.hipL!.y < H * 0.97 && lm.hipR!.y < H * 0.97;
    hipsOk = hipsVisible || !requireHips;
    const down = hipsVisible
      ? (() => {
          const hm = midpoint(lm.hipL!, lm.hipR!);
          const l = d2(hm, mid) || 1;
          return { x: (hm.x - mid.x) / l, y: (hm.y - mid.y) / l };
        })()
      : { x: 0, y: 1 };
    if (vis(lm.elbowL, 0.5) && vis(lm.elbowR, 0.5)) {
      const aL = armAngle(sL, lm.elbowL!, down);
      const aR = armAngle(sR, lm.elbowR!, down);
      arms = aL >= 15 && aL <= 65 && aR >= 15 && aR <= 65;
    }
  }
  checks.push({ id: "centered", label: "Centred", ok: centered, hint: "Move to the middle of the frame." });
  checks.push({ id: "distance", label: "Good distance", ok: distanceOk, hint: distanceHint });
  checks.push({
    id: "hips",
    label: "Waist & hips visible",
    ok: hipsOk,
    hint: "Step back or tilt the camera down until your hips are in view."
  });
  checks.push({ id: "facing", label: "Facing the camera", ok: facing, hint: "Face the camera straight on and keep your shoulders level." });
  checks.push({ id: "arms", label: "Arms slightly out", ok: arms, hint: "Hold your arms a little away from your sides, like the letter A." });
  checks.push({ id: "still", label: "Holding still", ok: motion < 0.04, hint: "Hold still for a moment." });
  return checks;
}

/** A person mask (1 = person) sampled in its own pixel grid. */
export interface PersonMask {
  data: Float32Array | Uint8Array;
  width: number;
  height: number;
  /** Value at or above which a pixel counts as the person (0.5 for float masks). */
  threshold: number;
}

/**
 * Body width through `center` along unit direction `dir` (both in mask
 * pixels): walk outwards both ways until leaving the person. Returns null if
 * the centre isn't on the person or the walk hits the image edge.
 */
export function measureMaskWidth(mask: PersonMask, center: { x: number; y: number }, dir: { x: number; y: number }, maxDist: number): number | null {
  const at = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= mask.width || yi >= mask.height) return -1;
    return mask.data[yi * mask.width + xi]!;
  };
  if (at(center.x, center.y) < mask.threshold) return null;
  let total = 0;
  for (const sgn of [-1, 1]) {
    let k = 0;
    for (;;) {
      const v = at(center.x + dir.x * k * sgn, center.y + dir.y * k * sgn);
      if (v < 0) return null; // ran off the image: unreliable
      if (v < mask.threshold) break;
      k++;
      if (k > maxDist) return null;
    }
    total += k;
  }
  return total;
}

export interface CalibSample {
  torso: number | null;
  hipJoint: number | null;
  chest: number | null;
  waist: number | null;
  hip: number | null;
  upperArm: number | null;
  forearm: number | null;
  neck: number | null;
}

const within = (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? v : null);

/** Proportions from one good frame (ratios to shoulder-joint width). */
export function sampleBody(lm: CalibLandmarks, W: number, H: number, mask?: PersonMask): CalibSample | null {
  if (!lm.shoulderL || !lm.shoulderR) return null;
  const sL = lm.shoulderL;
  const sR = lm.shoulderR;
  const sw = d2(sL, sR);
  if (sw < 10) return null;
  const sMid = midpoint(sL, sR);
  const hips = vis(lm.hipL, 0.6) && vis(lm.hipR, 0.6) ? { l: lm.hipL!, r: lm.hipR! } : null;
  const hMid = hips ? midpoint(hips.l, hips.r) : null;
  const arm = (s: CalibPoint, e?: CalibPoint, w?: CalibPoint) => ({
    upper: e && e.visibility > 0.5 ? d2(s, e) / sw : null,
    fore: e && w && e.visibility > 0.5 && w.visibility > 0.5 ? d2(e, w) / sw : null
  });
  const aL = arm(sL, lm.elbowL, lm.wristL);
  const aR = arm(sR, lm.elbowR, lm.wristR);
  const avg = (a: number | null, b: number | null) => (a !== null && b !== null ? (a + b) / 2 : (a ?? b));

  let chest: number | null = null;
  let waist: number | null = null;
  let hip: number | null = null;
  if (mask && hips && hMid) {
    const sx = mask.width / W;
    const sy = mask.height / H;
    const toMask = (p: { x: number; y: number }) => ({ x: p.x * sx, y: p.y * sy });
    const unit = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const l = d2(a, b) || 1;
      return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    };
    const acrossS = unit(sL, sR);
    const acrossH = unit(hips.l, hips.r);
    const level = (t: number) => ({ x: sMid.x + (hMid.x - sMid.x) * t, y: sMid.y + (hMid.y - sMid.y) * t });
    const lerpDir = (t: number) => {
      const x = acrossS.x + (acrossH.x - acrossS.x) * t;
      const y = acrossS.y + (acrossH.y - acrossS.y) * t;
      const l = Math.hypot(x, y) || 1;
      return { x: x / l, y: y / l };
    };
    const widthAt = (t: number) => {
      const m = measureMaskWidth(mask, toMask(level(t)), lerpDir(t), sw * sx * 2);
      return m === null ? null : m / sx / sw;
    };
    // Plausible ranges reject frames where an arm touches the torso.
    chest = (() => {
      const w = widthAt(0.3);
      return w === null ? null : within(w, 0.95, 1.65);
    })();
    waist = (() => {
      const w = widthAt(0.68);
      return w === null ? null : within(w, 0.75, 1.65);
    })();
    hip = (() => {
      const w = widthAt(0.98);
      return w === null ? null : within(w, 0.85, 1.8);
    })();
  }
  return {
    torso: hMid ? within(d2(sMid, hMid) / sw, 1.0, 2.2) : null,
    hipJoint: hips ? within(d2(hips.l, hips.r) / sw, 0.4, 0.95) : null,
    chest,
    waist,
    hip,
    upperArm: (() => {
      const v = avg(aL.upper, aR.upper);
      return v === null ? null : within(v, 0.5, 1.3);
    })(),
    forearm: (() => {
      const v = avg(aL.fore, aR.fore);
      return v === null ? null : within(v, 0.45, 1.2);
    })(),
    neck: lm.nose && lm.nose.visibility > 0.6 ? within((sMid.y - lm.nose.y) / sw, 0.3, 1.3) : null
  };
}

function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length < 3) return null;
  return v[v.length >> 1]!;
}

/** Robust (median) profile from many good frames; missing measurements use defaults. */
export function buildProfile(samples: CalibSample[], now = new Date()): BodyProfile {
  const pick = (k: keyof CalibSample, fallback: number) => median(samples.map((s) => s[k])) ?? fallback;
  const chest = median(samples.map((s) => s.chest));
  const waist = median(samples.map((s) => s.waist));
  const hip = median(samples.map((s) => s.hip));
  const torso = median(samples.map((s) => s.torso));
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    version: 1,
    torsoRatio: round(torso ?? DEFAULT_PROFILE.torsoRatio),
    hipJointRatio: round(pick("hipJoint", DEFAULT_PROFILE.hipJointRatio)),
    chestRatio: round(chest ?? DEFAULT_PROFILE.chestRatio),
    waistRatio: round(waist ?? DEFAULT_PROFILE.waistRatio),
    hipRatio: round(hip ?? DEFAULT_PROFILE.hipRatio),
    upperArmRatio: round(pick("upperArm", DEFAULT_PROFILE.upperArmRatio)),
    forearmRatio: round(pick("forearm", DEFAULT_PROFILE.forearmRatio)),
    neckRatio: round(pick("neck", DEFAULT_PROFILE.neckRatio)),
    measuredOutline: chest !== null && waist !== null && hip !== null,
    hipsMeasured: torso !== null,
    calibratedAt: now.toISOString()
  };
}

export interface CalibrationProgress {
  checks: CalibCheck[];
  allOk: boolean;
  /** 0..1 while holding a good pose. */
  progress: number;
  /** First failing check's hint (what the user should do next). */
  instruction: string;
  profile: BodyProfile | null;
}

/**
 * Stateful calibration session: requires every check to pass continuously
 * for `holdMs` while collecting samples, then produces a profile.
 */
export class BodyCalibrator {
  private okSince: number | null = null;
  private samples: CalibSample[] = [];
  private history: { t: number; x: number; y: number; sw: number }[] = [];
  requireHips: boolean;

  constructor(private readonly opts: { holdMs?: number; minSamples?: number; requireHips?: boolean } = {}) {
    this.requireHips = opts.requireHips ?? true;
  }

  reset(): void {
    this.okSince = null;
    this.samples = [];
    this.history = [];
  }

  /** True when a mask sample would be used this frame (lets callers skip mask readback otherwise). */
  get wantsSamples(): boolean {
    return this.okSince !== null;
  }

  update(lm: CalibLandmarks, W: number, H: number, t: number, mask?: PersonMask): CalibrationProgress {
    const holdMs = this.opts.holdMs ?? 1500;
    const minSamples = this.opts.minSamples ?? 12;
    let motion = 1;
    if (lm.shoulderL && lm.shoulderR) {
      const m = midpoint(lm.shoulderL, lm.shoulderR);
      const sw = d2(lm.shoulderL, lm.shoulderR);
      this.history.push({ t, x: m.x, y: m.y, sw });
      this.history = this.history.filter((h) => t - h.t <= 600);
      const first = this.history[0]!;
      motion = this.history.reduce((mx, h) => Math.max(mx, Math.hypot(h.x - first.x, h.y - first.y) / Math.max(sw, 1)), 0);
      if (this.history.length < 3) motion = 1;
    } else {
      this.history = [];
    }
    const checks = evaluateCalibration(lm, W, H, motion, this.requireHips);
    const allOk = checks.every((c) => c.ok);
    if (!allOk) {
      this.okSince = null;
      this.samples = [];
    } else {
      if (this.okSince === null) this.okSince = t;
      const s = sampleBody(lm, W, H, mask);
      if (s) this.samples.push(s);
    }
    const progress = this.okSince === null ? 0 : Math.min((t - this.okSince) / holdMs, 1);
    const done = progress >= 1 && this.samples.length >= minSamples;
    const failing = checks.find((c) => !c.ok);
    return {
      checks,
      allOk,
      progress,
      instruction: failing ? failing.hint : done ? "Calibrated!" : "Great — hold still…",
      profile: done ? buildProfile(this.samples) : null
    };
  }
}
