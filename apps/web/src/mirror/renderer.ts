import { angle, quadPoint, triangleTransform, type GarmentAnchors, type GarmentLayout, type Point2D, type SleevePlacement } from "@fitlens/shared";
import type { PreparedGarment } from "./garment";

/**
 * Piecewise garment renderer. The torso panel is warped through a bilinear
 * grid of affine-mapped triangles (so it follows shoulders, hips and lean),
 * and each sleeve is a rigid part rotated about the shoulder seam to follow
 * the upper arm.
 */

const COLS = 4;
const ROWS = 6;

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s: [Point2D, Point2D, Point2D],
  t: [Point2D, Point2D, Point2D]
): void {
  const m = triangleTransform(s[0], s[1], s[2], t[0], t[1], t[2]);
  if (!m) return;
  // Expand the clip triangle ~0.8px around its centroid to hide seams.
  const cx = (t[0].x + t[1].x + t[2].x) / 3;
  const cy = (t[0].y + t[1].y + t[2].y) / 3;
  const grow = (p: Point2D) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 0.8, y: p.y + (dy / len) * 0.8 };
  };
  const [a, b, c] = t.map(grow) as [Point2D, Point2D, Point2D];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawTorso(ctx: CanvasRenderingContext2D, g: PreparedGarment, a: GarmentAnchors, layout: GarmentLayout): void {
  const x0 = a.leftSleeveCut * g.width;
  const x1 = a.rightSleeveCut * g.width;
  const src = (u: number, v: number): Point2D => ({ x: x0 + (x1 - x0) * u, y: g.height * v });
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      const u0 = col / COLS, u1 = (col + 1) / COLS, v0 = r / ROWS, v1 = (r + 1) / ROWS;
      const s00 = src(u0, v0), s10 = src(u1, v0), s01 = src(u0, v1), s11 = src(u1, v1);
      const t00 = quadPoint(layout.torso, u0, v0), t10 = quadPoint(layout.torso, u1, v0);
      const t01 = quadPoint(layout.torso, u0, v1), t11 = quadPoint(layout.torso, u1, v1);
      drawTriangle(ctx, g.canvas, [s00, s10, s11], [t00, t10, t11]);
      drawTriangle(ctx, g.canvas, [s00, s11, s01], [t00, t11, t01]);
    }
  }
}

function drawSleeve(
  ctx: CanvasRenderingContext2D,
  g: PreparedGarment,
  a: GarmentAnchors,
  layout: GarmentLayout,
  placement: SleevePlacement,
  side: "left" | "right"
): void {
  const cut = side === "left" ? a.leftSleeveCut : a.rightSleeveCut;
  const shoulder = side === "left" ? a.leftShoulder : a.rightShoulder;
  const cuff = side === "left" ? a.leftCuff : a.rightCuff;
  const pivotSrc = { x: cut * g.width, y: Math.max(shoulder.y, 0.02) * g.height };
  const cuffSrc = { x: cuff.x * g.width, y: cuff.y * g.height };
  const restAngle = angle(pivotSrc, cuffSrc);
  // Garment px → canvas px, from the torso panel's top edge.
  const topWidth = Math.hypot(layout.torso[1].x - layout.torso[0].x, layout.torso[1].y - layout.torso[0].y);
  const scale = topWidth / ((a.rightSleeveCut - a.leftSleeveCut) * g.width);
  const rotation = placement.armAngle - restAngle;

  ctx.save();
  // Clip to the sleeve's half of the source image (in source space, after transform).
  ctx.translate(placement.pivot.x, placement.pivot.y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.translate(-pivotSrc.x, -pivotSrc.y);
  ctx.beginPath();
  // Overlap the torso by a few px so the seam is hidden under the torso panel.
  const overlap = 0.02 * g.width;
  if (side === "left") ctx.rect(0, 0, pivotSrc.x + overlap, g.height);
  else ctx.rect(pivotSrc.x - overlap, 0, g.width - pivotSrc.x + overlap, g.height);
  ctx.clip();
  ctx.drawImage(g.canvas, 0, 0);
  ctx.restore();
}

export interface RenderOptions {
  opacity: number;
  /** Draw a sleeve over the torso when the arm crosses in front of the body. */
  leftArmInFront: boolean;
  rightArmInFront: boolean;
}

export function renderGarment(
  ctx: CanvasRenderingContext2D,
  g: PreparedGarment,
  anchors: GarmentAnchors,
  layout: GarmentLayout,
  opts: RenderOptions
): void {
  if (opts.opacity <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = opts.opacity;
  ctx.imageSmoothingQuality = "high";
  if (layout.leftSleeve && !opts.leftArmInFront) drawSleeve(ctx, g, anchors, layout, layout.leftSleeve, "left");
  if (layout.rightSleeve && !opts.rightArmInFront) drawSleeve(ctx, g, anchors, layout, layout.rightSleeve, "right");
  drawTorso(ctx, g, anchors, layout);
  if (layout.leftSleeve && opts.leftArmInFront) drawSleeve(ctx, g, anchors, layout, layout.leftSleeve, "left");
  if (layout.rightSleeve && opts.rightArmInFront) drawSleeve(ctx, g, anchors, layout, layout.rightSleeve, "right");
  ctx.restore();
}
