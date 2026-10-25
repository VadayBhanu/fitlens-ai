import { DEFAULT_PROFILE, type BodyProfile } from "./calibration";

/**
 * Real-time garment cloth simulation for the 3D LiveMirror.
 *
 * Position-based dynamics (Müller et al. 2007) on tube-shaped cloth pieces:
 * a torso tube and one tube per sleeve. Each particle is
 *   1. integrated with Verlet (inertia + gravity + damping),
 *   2. softly "skinned" toward a rest shape around the tracked body (stiff at
 *      the shoulders, loose at the hem so fabric lags, swings and settles),
 *   3. relaxed against stretch / shear / bend distance constraints,
 *   4. pushed out of the body's collision volumes (elliptic torso, arm capsules).
 *
 * Framework-free and deterministic so it is unit-testable; the renderer only
 * reads `positions`. Coordinates are scene units (pixels): +x right, +y up,
 * +z toward the camera.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  len: (a: Vec3): number => Math.hypot(a.x, a.y, a.z),
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  },
  dist: (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
};

/** Tracked joints in scene space. "left"/"right" = image-left/right. */
export interface BodyFrame3D {
  shoulderL: Vec3;
  shoulderR: Vec3;
  hipL: Vec3;
  hipR: Vec3;
  elbowL?: Vec3;
  elbowR?: Vec3;
  wristL?: Vec3;
  wristR?: Vec3;
  head?: Vec3;
}

export interface Capsule {
  a: Vec3;
  b: Vec3;
  r: number;
}

export interface BodyModel {
  shoulderMid: Vec3;
  hipMid: Vec3;
  across: Vec3;
  up: Vec3;
  forward: Vec3;
  shoulderWidth: number;
  hipWidth: number;
  torsoLength: number;
  /** Arm polylines (shoulder → elbow → wrist); guessed hanging arms when untracked. */
  armL: Vec3[];
  armR: Vec3[];
  armTrackedL: boolean;
  armTrackedR: boolean;
  capsules: Capsule[];
  head: { c: Vec3; r: number } | null;
  /** Half-widths of the real body outline (px) at shoulders, chest, waist and hips. */
  outline: { shoulder: number; chest: number; waist: number; hip: number };
}

/** Half-width of the body outline at `t` torso-lengths below the shoulder line (0 = shoulders, 1 = hips). */
export function outlineHalfWidth(b: Pick<BodyModel, "outline">, t: number): number {
  const o = b.outline;
  const stops: [number, number][] = [
    [0, o.shoulder],
    [0.3, o.chest],
    [0.68, o.waist],
    [1, o.hip]
  ];
  if (t <= 0) return o.shoulder;
  if (t >= 1) return o.hip;
  for (let k = 0; k < stops.length - 1; k++) {
    const [t0, w0] = stops[k]!;
    const [t1, w1] = stops[k + 1]!;
    if (t <= t1) return w0 + (w1 - w0) * smooth((t - t0) / (t1 - t0));
  }
  return o.hip;
}

export function buildBodyModel(f: BodyFrame3D, profile: BodyProfile = DEFAULT_PROFILE): BodyModel {
  const shoulderMid = v3.lerp(f.shoulderL, f.shoulderR, 0.5);
  const hipMid = v3.lerp(f.hipL, f.hipR, 0.5);
  const up = v3.norm(v3.sub(shoulderMid, hipMid));
  const rawAcross = v3.sub(f.shoulderR, f.shoulderL);
  const across = v3.norm(v3.sub(rawAcross, v3.scale(up, v3.dot(rawAcross, up))));
  const forward = v3.cross(across, up);
  const shoulderWidth = v3.dist(f.shoulderL, f.shoulderR);
  const hipWidth = v3.dist(f.hipL, f.hipR);
  const torsoLength = v3.dist(shoulderMid, hipMid);

  const upperLen = shoulderWidth * profile.upperArmRatio;
  const foreLen = shoulderWidth * profile.forearmRatio;
  const guessArm = (shoulder: Vec3, side: -1 | 1): Vec3[] => {
    const dir = v3.norm(v3.add(v3.scale(across, side * 0.15), v3.scale(up, -1)));
    const elbow = v3.add(shoulder, v3.scale(dir, upperLen));
    const wrist = v3.add(elbow, v3.scale(v3.norm(v3.add(v3.scale(across, side * 0.05), v3.scale(up, -1))), foreLen));
    return [shoulder, elbow, wrist];
  };
  const arm = (shoulder: Vec3, elbow: Vec3 | undefined, wrist: Vec3 | undefined, side: -1 | 1): { pts: Vec3[]; tracked: boolean } => {
    if (!elbow) return { pts: guessArm(shoulder, side), tracked: false };
    // Missing wrist: continue the upper arm by the calibrated forearm length.
    const w = wrist ?? v3.add(elbow, v3.scale(v3.norm(v3.sub(elbow, shoulder)), foreLen));
    return { pts: [shoulder, elbow, w], tracked: true };
  };
  const L = arm(f.shoulderL, f.elbowL, f.wristL, -1);
  const R = arm(f.shoulderR, f.elbowR, f.wristR, 1);
  const upperR = shoulderWidth * 0.11;
  const foreR = shoulderWidth * 0.085;
  const capsules: Capsule[] = [
    { a: L.pts[0]!, b: L.pts[1]!, r: upperR },
    { a: L.pts[1]!, b: L.pts[2]!, r: foreR },
    { a: R.pts[0]!, b: R.pts[1]!, r: upperR },
    { a: R.pts[1]!, b: R.pts[2]!, r: foreR }
  ];
  return {
    shoulderMid,
    hipMid,
    across,
    up,
    forward,
    shoulderWidth,
    hipWidth,
    torsoLength,
    armL: L.pts,
    armR: R.pts,
    armTrackedL: L.tracked,
    armTrackedR: R.tracked,
    capsules,
    head: f.head ? { c: f.head, r: shoulderWidth * 0.36 } : null,
    outline: {
      // The shoulder outline sits outside the joints; never narrower than the chest suggests.
      shoulder: shoulderWidth * 0.5 * Math.max(1.12, profile.chestRatio * 0.95),
      chest: shoulderWidth * 0.5 * profile.chestRatio,
      waist: shoulderWidth * 0.5 * profile.waistRatio,
      hip: shoulderWidth * 0.5 * profile.hipRatio
    }
  };
}

export type ClothKind = "top" | "outerwear" | "dress";

export interface GarmentSpec {
  kind: ClothKind;
  /** Torso circumference segments and rows. */
  segments: number;
  rows: number;
  sleeveSegments: number;
  sleeveRows: number;
  /** Looseness around the body (1 = skin tight). */
  ease: number;
  /** Garment length below the shoulders, in torso lengths. */
  length: number;
  /** Hem width relative to the hips. */
  flare: number;
  /** Fraction of the arm (shoulder → wrist) the sleeve covers; 0 = sleeveless. */
  sleeveLength: number;
  /** Width/length/size user adjustments. */
  widthScale: number;
  lengthScale: number;
}

export function defaultSpec(kind: ClothKind): GarmentSpec {
  const base = { segments: 28, rows: 18, sleeveSegments: 12, sleeveRows: 10, widthScale: 1, lengthScale: 1 };
  switch (kind) {
    case "outerwear":
      return { ...base, kind, ease: 1.12, length: 1.18, flare: 1.05, sleeveLength: 0.97 };
    case "dress":
      return { ...base, kind, rows: 24, ease: 1.05, length: 2.3, flare: 1.7, sleeveLength: 0.18 };
    default:
      return { ...base, kind, ease: 1.06, length: 1.12, flare: 1.0, sleeveLength: 0.42 };
  }
}

interface Constraint {
  i: number;
  j: number;
  stiffness: number;
}

/** A closed tube of particles: `rings` rows × `segments` around. */
export class ClothTube {
  readonly count: number;
  readonly positions: Float32Array;
  private readonly prev: Float32Array;
  private readonly targets: Float32Array;
  /** Per-particle skinning stiffness (1 = pinned to the rest shape). */
  private readonly skin: Float32Array;
  private readonly constraints: Constraint[] = [];
  private readonly rest: Float32Array;

  constructor(
    readonly rings: number,
    readonly segments: number,
    skinProfile: (v: number) => number
  ) {
    this.count = rings * segments;
    this.positions = new Float32Array(this.count * 3);
    this.prev = new Float32Array(this.count * 3);
    this.targets = new Float32Array(this.count * 3);
    this.skin = new Float32Array(this.count);
    const idx = (r: number, i: number) => r * segments + (((i % segments) + segments) % segments);
    for (let r = 0; r < rings; r++) {
      const k = skinProfile(rings > 1 ? r / (rings - 1) : 0);
      for (let i = 0; i < segments; i++) {
        this.skin[idx(r, i)] = k;
        this.constraints.push({ i: idx(r, i), j: idx(r, i + 1), stiffness: 1 });
        if (r + 1 < rings) {
          this.constraints.push({ i: idx(r, i), j: idx(r + 1, i), stiffness: 1 });
          this.constraints.push({ i: idx(r, i), j: idx(r + 1, i + 1), stiffness: 0.5 });
          this.constraints.push({ i: idx(r, i + 1), j: idx(r + 1, i), stiffness: 0.5 });
        }
        if (r + 2 < rings) this.constraints.push({ i: idx(r, i), j: idx(r + 2, i), stiffness: 0.25 });
        this.constraints.push({ i: idx(r, i), j: idx(r, i + 2), stiffness: 0.2 });
      }
    }
    this.rest = new Float32Array(this.constraints.length);
  }

  index(r: number, i: number): number {
    return r * this.segments + (((i % this.segments) + this.segments) % this.segments);
  }

  setTarget(n: number, p: Vec3): void {
    this.targets[n * 3] = p.x;
    this.targets[n * 3 + 1] = p.y;
    this.targets[n * 3 + 2] = p.z;
  }

  target(n: number): Vec3 {
    return { x: this.targets[n * 3]!, y: this.targets[n * 3 + 1]!, z: this.targets[n * 3 + 2]! };
  }

  position(n: number): Vec3 {
    return { x: this.positions[n * 3]!, y: this.positions[n * 3 + 1]!, z: this.positions[n * 3 + 2]! };
  }

  /** Snap all particles to their targets with zero velocity. */
  snap(): void {
    this.positions.set(this.targets);
    this.prev.set(this.targets);
  }

  /** Rest lengths follow the current rest shape so the garment scales with the body. */
  private updateRestLengths(): void {
    const t = this.targets;
    this.constraints.forEach((c, k) => {
      const dx = t[c.i * 3]! - t[c.j * 3]!;
      const dy = t[c.i * 3 + 1]! - t[c.j * 3 + 1]!;
      const dz = t[c.i * 3 + 2]! - t[c.j * 3 + 2]!;
      this.rest[k] = Math.hypot(dx, dy, dz);
    });
  }

  integrate(dt: number, gravity: number, damping: number): void {
    const p = this.positions;
    const q = this.prev;
    const g = -gravity * dt * dt;
    for (let n = 0; n < this.count; n++) {
      const o = n * 3;
      for (let a = 0; a < 3; a++) {
        const cur = p[o + a]!;
        const vel = (cur - q[o + a]!) * damping;
        q[o + a] = cur;
        p[o + a] = cur + vel + (a === 1 ? g : 0);
      }
    }
  }

  solve(iterations: number, collide: (p: Float32Array, n: number) => void): void {
    this.updateRestLengths();
    const p = this.positions;
    const t = this.targets;
    // Skinning acts like a spring toward the rest shape, applied once per step
    // (pinned particles, k = 1, are placed exactly).
    for (let n = 0; n < this.count; n++) {
      const k = this.skin[n]!;
      if (k <= 0) continue;
      const o = n * 3;
      p[o] = p[o]! + (t[o]! - p[o]!) * k;
      p[o + 1] = p[o + 1]! + (t[o + 1]! - p[o + 1]!) * k;
      p[o + 2] = p[o + 2]! + (t[o + 2]! - p[o + 2]!) * k;
    }
    for (let it = 0; it < iterations; it++) {
      for (let c = 0; c < this.constraints.length; c++) {
        const { i, j, stiffness } = this.constraints[c]!;
        const oi = i * 3;
        const oj = j * 3;
        const dx = p[oj]! - p[oi]!;
        const dy = p[oj + 1]! - p[oi + 1]!;
        const dz = p[oj + 2]! - p[oi + 2]!;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const wi = 1 - this.skin[i]!;
        const wj = 1 - this.skin[j]!;
        const w = wi + wj;
        if (w <= 1e-6) continue;
        const corr = ((d - this.rest[c]!) / d) * stiffness;
        const ci = (corr * wi) / w;
        const cj = (corr * wj) / w;
        p[oi] = p[oi]! + dx * ci;
        p[oi + 1] = p[oi + 1]! + dy * ci;
        p[oi + 2] = p[oi + 2]! + dz * ci;
        p[oj] = p[oj]! - dx * cj;
        p[oj + 1] = p[oj + 1]! - dy * cj;
        p[oj + 2] = p[oj + 2]! - dz * cj;
      }
      for (let n = 0; n < this.count; n++) if (this.skin[n]! < 1) collide(p, n);
    }
  }
}

function pushOutOfCapsule(p: Float32Array, n: number, c: Capsule, margin: number): void {
  const o = n * 3;
  const abx = c.b.x - c.a.x, aby = c.b.y - c.a.y, abz = c.b.z - c.a.z;
  const apx = p[o]! - c.a.x, apy = p[o + 1]! - c.a.y, apz = p[o + 2]! - c.a.z;
  const ab2 = abx * abx + aby * aby + abz * abz || 1e-6;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2));
  const cx = c.a.x + abx * t, cy = c.a.y + aby * t, cz = c.a.z + abz * t;
  const dx = p[o]! - cx, dy = p[o + 1]! - cy, dz = p[o + 2]! - cz;
  const d = Math.hypot(dx, dy, dz);
  const r = c.r + margin;
  if (d >= r || d < 1e-6) return;
  const s = r / d;
  p[o] = cx + dx * s;
  p[o + 1] = cy + dy * s;
  p[o + 2] = cz + dz * s;
}

/** Point and tangent at arc length `s` along a polyline. */
function alongPolyline(pts: Vec3[], s: number): { p: Vec3; dir: Vec3 } {
  let remaining = s;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const len = v3.dist(a, b);
    if (remaining <= len || k === pts.length - 2) {
      const t = len > 0 ? Math.min(remaining / len, 1) : 0;
      return { p: v3.lerp(a, b, t), dir: v3.norm(v3.sub(b, a)) };
    }
    remaining -= len;
  }
  return { p: pts[0]!, dir: { x: 0, y: -1, z: 0 } };
}

function polylineLength(pts: Vec3[]): number {
  let l = 0;
  for (let k = 0; k < pts.length - 1; k++) l += v3.dist(pts[k]!, pts[k + 1]!);
  return l;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * A full garment: torso tube + sleeve tubes, simulated against a BodyModel.
 * Ring 0 of every tube is the top (neck/shoulder line or armhole).
 */
export class GarmentCloth {
  readonly torso: ClothTube;
  readonly sleeves: [ClothTube, ClothTube] | null;
  private body: BodyModel | null = null;
  private initialized = false;

  constructor(public spec: GarmentSpec) {
    // Shoulders follow the body tightly; the hem is loose so it lags and swings.
    this.torso = new ClothTube(spec.rows + 1, spec.segments, (v) => (v === 0 ? 1 : 0.3 * (1 - v) ** 3 + 0.015));
    this.sleeves =
      spec.sleeveLength > 0
        ? [
            new ClothTube(spec.sleeveRows + 1, spec.sleeveSegments, (v) => (v === 0 ? 1 : 0.35 * (1 - v) + 0.06)),
            new ClothTube(spec.sleeveRows + 1, spec.sleeveSegments, (v) => (v === 0 ? 1 : 0.35 * (1 - v) + 0.06))
          ]
        : null;
  }

  /** Torso rest shape: an elliptic tube from the shoulder line down past the hips. */
  private torsoTargets(b: BodyModel): void {
    const s = this.spec;
    const R = this.torso.rings;
    const N = this.torso.segments;
    const length = b.torsoLength * s.length * s.lengthScale;
    const ease = s.ease * s.widthScale;
    const neckLift = b.torsoLength * 0.06;
    for (let r = 0; r < R; r++) {
      const v = r / (R - 1);
      const along = -neckLift + length * v;
      const center = v3.add(b.shoulderMid, v3.scale(b.up, -along));
      // Width follows the measured body outline (shoulders → chest → waist → hips) plus ease.
      let a = outlineHalfWidth(b, along / Math.max(b.torsoLength, 1)) * ease;
      if (along > b.torsoLength) a *= 1 + (s.flare - 1) * Math.min((along - b.torsoLength) / Math.max(length - b.torsoLength, 1), 1);
      // Rounded shoulders: the top ring is narrower front-to-back.
      const depth = a * (0.52 + 0.1 * Math.min(v * 4, 1));
      for (let i = 0; i < N; i++) {
        const th = -Math.PI / 2 + (2 * Math.PI * i) / N;
        let ax = a;
        if (r === 0) ax *= 0.98; // shoulder seam sits on the shoulder joints
        const off = v3.add(v3.scale(b.across, ax * Math.sin(th)), v3.scale(b.forward, depth * Math.cos(th)));
        this.torso.setTarget(this.torso.index(r, i), v3.add(center, off));
      }
    }
  }

  private sleeveTargets(b: BodyModel, tube: ClothTube, arm: Vec3[], side: -1 | 1): void {
    const s = this.spec;
    const total = polylineLength(arm);
    const covered = total * s.sleeveLength * Math.max(0.6, s.lengthScale);
    const rTop = b.shoulderWidth * 0.17 * s.ease * s.widthScale;
    const rCuff = b.shoulderWidth * (s.sleeveLength > 0.6 ? 0.095 : 0.15) * s.ease * s.widthScale;
    // Armhole sits slightly inboard of the shoulder joint so the sleeve overlaps the torso seam.
    const start = v3.add(arm[0]!, v3.scale(b.across, -side * b.shoulderWidth * 0.04));
    const pts = [start, ...arm.slice(1)];
    for (let r = 0; r < tube.rings; r++) {
      const v = r / (tube.rings - 1);
      const { p, dir } = alongPolyline(pts, covered * v);
      let n1 = v3.sub(b.forward, v3.scale(dir, v3.dot(b.forward, dir)));
      if (v3.len(n1) < 1e-3) n1 = b.up;
      n1 = v3.norm(n1);
      // "side" points to image-right when the arm hangs down, matching the
      // torso convention: segment 0 sits on the image-left edge, the front
      // (facing the camera) is at angle 0, so textures map the same way.
      const side = v3.scale(v3.cross(dir, n1), -1);
      const rr = rTop + (rCuff - rTop) * v;
      for (let i = 0; i < tube.segments; i++) {
        const ph = -Math.PI / 2 + (2 * Math.PI * i) / tube.segments;
        tube.setTarget(tube.index(r, i), v3.add(p, v3.add(v3.scale(n1, rr * Math.cos(ph)), v3.scale(side, rr * Math.sin(ph)))));
      }
    }
  }

  private collideTorso = (p: Float32Array, n: number): void => {
    const b = this.body!;
    const o = n * 3;
    const dx = p[o]! - b.hipMid.x, dy = p[o + 1]! - b.hipMid.y, dz = p[o + 2]! - b.hipMid.z;
    const y = dx * b.up.x + dy * b.up.y + dz * b.up.z;
    if (y > -b.torsoLength * 0.35 && y < b.torsoLength * 1.02) {
      const x = dx * b.across.x + dy * b.across.y + dz * b.across.z;
      const z = dx * b.forward.x + dy * b.forward.y + dz * b.forward.z;
      // y is measured up from the hips; the outline is indexed down from the shoulders.
      const t = Math.max(0, Math.min(1, 1 - y / b.torsoLength));
      // Near the shoulders the arms attach, so the collider tapers in to stay clear of the arm capsules.
      const A = outlineHalfWidth(b, t) * (t < 0.15 ? 0.82 + 1.0 * t : 0.97);
      const B = A * 0.6;
      const e = (x * x) / (A * A) + (z * z) / (B * B);
      if (e < 1 && e > 1e-6) {
        const k = 1 / Math.sqrt(e) - 1;
        p[o] = p[o]! + (b.across.x * x + b.forward.x * z) * k;
        p[o + 1] = p[o + 1]! + (b.across.y * x + b.forward.y * z) * k;
        p[o + 2] = p[o + 2]! + (b.across.z * x + b.forward.z * z) * k;
      }
    }
    const margin = b.shoulderWidth * 0.02;
    for (const c of b.capsules) pushOutOfCapsule(p, n, c, margin);
  };

  private collideSleeve = (p: Float32Array, n: number): void => {
    const b = this.body!;
    const margin = b.shoulderWidth * 0.025;
    for (const c of b.capsules) pushOutOfCapsule(p, n, c, margin);
  };

  /**
   * Advance the simulation one frame. Large jumps (first frame, re-acquired
   * tracking, teleports) snap the cloth to the rest shape instead of whipping.
   */
  step(body: BodyModel, dt: number, opts: { iterations?: number; pxPerMeter?: number } = {}): void {
    const prevBody = this.body;
    this.body = body;
    this.torsoTargets(body);
    if (this.sleeves) {
      this.sleeveTargets(body, this.sleeves[0], body.armL, -1);
      this.sleeveTargets(body, this.sleeves[1], body.armR, 1);
    }
    const jumped = !prevBody || v3.dist(prevBody.shoulderMid, body.shoulderMid) > body.shoulderWidth * 0.8;
    if (!this.initialized || jumped) {
      this.torso.snap();
      this.sleeves?.forEach((s) => s.snap());
      this.initialized = true;
      return;
    }
    const pxPerMeter = opts.pxPerMeter ?? body.shoulderWidth / 0.4;
    const gravity = 9.81 * pxPerMeter;
    const iterations = opts.iterations ?? 8;
    const h = Math.min(Math.max(dt, 1 / 240), 1 / 20);
    const substeps = h > 1 / 45 ? 2 : 1;
    for (let k = 0; k < substeps; k++) {
      this.torso.integrate(h / substeps, gravity, 0.965);
      this.torso.solve(iterations, this.collideTorso);
      if (this.sleeves) {
        for (const s of this.sleeves) {
          s.integrate(h / substeps, gravity, 0.95);
          s.solve(Math.max(4, iterations - 2), this.collideSleeve);
        }
      }
    }
  }

  reset(): void {
    this.initialized = false;
    this.body = null;
  }
}
