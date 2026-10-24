import type { Point2D } from "./filters";

/**
 * Pure 2D geometry for the LiveMirror garment renderer. All coordinates are
 * in output-canvas pixels. These are visual alignment estimates only — they
 * do not measure the shopper's physical body.
 */

export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function mid(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function lerp(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function angle(from: Point2D, to: Point2D): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function add(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(a: Point2D, s: number): Point2D {
  return { x: a.x * s, y: a.y * s };
}

export function sub(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function normalize(v: Point2D): Point2D {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

/** Body landmarks the renderer needs, already mirrored into canvas space. */
export interface UpperBody {
  leftShoulder: Point2D;
  rightShoulder: Point2D;
  leftHip: Point2D;
  rightHip: Point2D;
  leftElbow?: Point2D;
  rightElbow?: Point2D;
}

/**
 * Normalized anchor template describing where body-relative features sit on
 * a front-facing garment image (0..1 of the garment's tight bounding box).
 */
export interface GarmentAnchors {
  /** Shoulder seam points. */
  leftShoulder: Point2D;
  rightShoulder: Point2D;
  /** Hem corners. */
  leftHem: Point2D;
  rightHem: Point2D;
  /** Vertical cut where sleeve meets body at the left/right side, as x fraction. */
  leftSleeveCut: number;
  rightSleeveCut: number;
  /** Centre of each sleeve's cuff; with the shoulder seam it defines the sleeve's rest direction. */
  leftCuff: Point2D;
  rightCuff: Point2D;
  /** Height (fraction) where the sleeve meets the body at the armpit. */
  armpitY: number;
}

export const DEFAULT_ANCHORS: Record<"top" | "outerwear" | "dress", GarmentAnchors> = {
  top: {
    leftShoulder: { x: 0.22, y: 0.05 },
    rightShoulder: { x: 0.78, y: 0.05 },
    leftHem: { x: 0.23, y: 1 },
    rightHem: { x: 0.77, y: 1 },
    leftSleeveCut: 0.235,
    rightSleeveCut: 0.765,
    leftCuff: { x: 0.07, y: 0.33 },
    rightCuff: { x: 0.93, y: 0.33 },
    armpitY: 0.25
  },
  outerwear: {
    leftShoulder: { x: 0.22, y: 0.05 },
    rightShoulder: { x: 0.78, y: 0.05 },
    leftHem: { x: 0.23, y: 1 },
    rightHem: { x: 0.77, y: 1 },
    leftSleeveCut: 0.235,
    rightSleeveCut: 0.765,
    leftCuff: { x: 0.08, y: 0.79 },
    rightCuff: { x: 0.92, y: 0.79 },
    armpitY: 0.34
  },
  dress: {
    leftShoulder: { x: 0.3, y: 0.04 },
    rightShoulder: { x: 0.7, y: 0.04 },
    leftHem: { x: 0.1, y: 1 },
    rightHem: { x: 0.9, y: 1 },
    leftSleeveCut: 0.24,
    rightSleeveCut: 0.76,
    leftCuff: { x: 0.12, y: 0.2 },
    rightCuff: { x: 0.88, y: 0.2 },
    armpitY: 0.18
  }
};

export interface SleevePlacement {
  pivot: Point2D;
  /** Direction from shoulder to elbow in canvas space (radians). */
  armAngle: number;
}

/** A quad in target space: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point2D, Point2D, Point2D, Point2D];

export interface GarmentLayout {
  torso: Quad;
  /** Sleeve placement: pivot on the shoulder seam and the target arm direction. */
  leftSleeve: SleevePlacement | null;
  rightSleeve: SleevePlacement | null;
  shoulderWidthPx: number;
  /** Torso roll in radians (0 = shoulders level). */
  roll: number;
}

export interface LayoutOptions {
  /** How far the garment hem extends below the hips relative to torso length. */
  hemExtension: number;
  /** Ease added to the shoulder width (garments are wider than the skeleton). */
  shoulderEase: number;
}

/**
 * Compute where the garment's torso panel and sleeves should go for a body
 * pose. Here "left"/"right" refer to the image as displayed: `leftShoulder`
 * is the shoulder that appears on the left of the mirrored canvas.
 */
export function computeGarmentLayout(
  body: UpperBody,
  anchors: GarmentAnchors,
  opts: LayoutOptions = { hemExtension: 0.12, shoulderEase: 1.18 }
): GarmentLayout {
  const shoulderMid = mid(body.leftShoulder, body.rightShoulder);
  const hipMid = mid(body.leftHip, body.rightHip);
  const shoulderWidthPx = dist(body.leftShoulder, body.rightShoulder);
  const across = normalize(sub(body.rightShoulder, body.leftShoulder));
  const down = normalize(sub(hipMid, shoulderMid));
  const torsoLen = dist(shoulderMid, hipMid);

  const anchorShoulderSpan = anchors.rightShoulder.x - anchors.leftShoulder.x;
  const panelSpan = anchors.rightSleeveCut - anchors.leftSleeveCut;
  // Width of the torso panel in target pixels at shoulder level.
  const topWidth = shoulderWidthPx * opts.shoulderEase * (panelSpan / anchorShoulderSpan);
  // Hips are usually narrower than shoulders on the skeleton; garments hang.
  const hipWidthPx = Math.max(dist(body.leftHip, body.rightHip) * 1.35, topWidth * 0.85);
  const bottomWidth = Math.min(hipWidthPx, topWidth * 1.15) * ((anchors.rightHem.x - anchors.leftHem.x) / panelSpan);

  // Neck/shoulder line sits a little above the shoulder joints.
  const anchorTopOffset = anchors.leftShoulder.y; // fraction of garment height above shoulder seam
  const garmentLen = torsoLen * (1 + opts.hemExtension) / Math.max(1 - anchorTopOffset, 0.5);
  const top = sub(shoulderMid, scale(down, garmentLen * anchorTopOffset));
  const bottom = add(top, scale(down, garmentLen));

  const torso: Quad = [
    sub(top, scale(across, topWidth / 2)),
    add(top, scale(across, topWidth / 2)),
    add(bottom, scale(across, bottomWidth / 2)),
    sub(bottom, scale(across, bottomWidth / 2))
  ];

  const roll = angle(body.leftShoulder, body.rightShoulder);

  const sleeve = (shoulder: Point2D, elbow: Point2D | undefined, side: "left" | "right"): SleevePlacement | null => {
    if (!elbow) return null;
    const corner = side === "left" ? torso[0] : torso[1];
    // Pivot sits on the shoulder seam: between the panel corner and the shoulder line.
    const pivot = lerp(corner, add(shoulder, scale(down, -garmentLen * anchorTopOffset * 0.2)), 0.25);
    return { pivot, armAngle: angle(shoulder, elbow) };
  };

  return {
    torso,
    leftSleeve: sleeve(body.leftShoulder, body.leftElbow, "left"),
    rightSleeve: sleeve(body.rightShoulder, body.rightElbow, "right"),
    shoulderWidthPx,
    roll
  };
}

/** Bilinear interpolation inside a quad (u,v in 0..1). */
export function quadPoint(q: Quad, u: number, v: number): Point2D {
  const top = lerp(q[0], q[1], u);
  const bottom = lerp(q[3], q[2], u);
  return lerp(top, bottom, v);
}

/**
 * Affine transform mapping source triangle (s0,s1,s2) onto target (t0,t1,t2).
 * Returns canvas setTransform parameters [a, b, c, d, e, f].
 */
export function triangleTransform(
  s0: Point2D,
  s1: Point2D,
  s2: Point2D,
  t0: Point2D,
  t1: Point2D,
  t2: Point2D
): [number, number, number, number, number, number] | null {
  const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(den) < 1e-9) return null;
  const a = ((t1.x - t0.x) * (s2.y - s0.y) - (t2.x - t0.x) * (s1.y - s0.y)) / den;
  const b = ((t1.y - t0.y) * (s2.y - s0.y) - (t2.y - t0.y) * (s1.y - s0.y)) / den;
  const c = ((t2.x - t0.x) * (s1.x - s0.x) - (t1.x - t0.x) * (s2.x - s0.x)) / den;
  const d = ((t2.y - t0.y) * (s1.x - s0.x) - (t1.y - t0.y) * (s2.x - s0.x)) / den;
  const e = t0.x - a * s0.x - c * s0.y;
  const f = t0.y - b * s0.x - d * s0.y;
  return [a, b, c, d, e, f];
}

/** Rough yaw estimate from shoulder-to-hip width ratio and depth (z) differences. */
export function estimateYaw(shoulderWidthPx: number, torsoLengthPx: number, zLeft = 0, zRight = 0): number {
  const ratio = shoulderWidthPx / Math.max(torsoLengthPx, 1);
  // A frontal adult torso has a shoulder/torso ratio near ~0.75–0.9.
  const frontal = 0.82;
  const cos = Math.min(ratio / frontal, 1);
  const magnitude = Math.acos(cos);
  return Math.sign(zRight - zLeft || 1) * magnitude;
}
