import { computeGarmentLayout, DEFAULT_ANCHORS, type GarmentAnchors, type GarmentCategory, type Point2D } from "@fitlens/shared";
import type { PreparedGarment } from "./garment";
import { renderGarment } from "./renderer";
import type { MirrorRenderer, RenderFrame } from "./types";

/** Fast 2D mode: piecewise-affine garment mesh on a 2D canvas (no WebGL needed). */
export class FlatRenderer implements MirrorRenderer {
  readonly kind = "flat" as const;
  private garment: PreparedGarment | null = null;
  private anchors: GarmentAnchors = DEFAULT_ANCHORS.top;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  setGarment(garment: PreparedGarment | null, category: GarmentCategory): void {
    this.garment = garment;
    this.anchors = category === "outerwear" ? DEFAULT_ANCHORS.outerwear : category === "dress" ? DEFAULT_ANCHORS.dress : DEFAULT_ANCHORS.top;
  }

  render({ video, pose, opacity, adjustments, showBodyModel }: RenderFrame): void {
    const ctx = this.ctx;
    ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    if (!pose) return;
    const body = pose.body;
    if (showBodyModel) drawSkeleton(ctx, [body.leftShoulder, body.rightShoulder, body.leftElbow, body.rightElbow, pose.leftWrist, pose.rightWrist, body.leftHip, body.rightHip]);
    if (!this.garment || opacity <= 0.01) return;
    const layout = computeGarmentLayout(body, this.anchors, {
      hemExtension: 0.12 * adjustments.length + (adjustments.length - 1) * 0.6,
      shoulderEase: 1.18 * adjustments.width
    });
    const minX = Math.min(layout.torso[0].x, layout.torso[3].x);
    const maxX = Math.max(layout.torso[1].x, layout.torso[2].x);
    const inside = (p?: Point2D) => !!p && p.x > minX + 10 && p.x < maxX - 10;
    renderGarment(ctx, this.garment, this.anchors, layout, { opacity, leftArmInFront: inside(body.leftElbow), rightArmInFront: inside(body.rightElbow) });
  }

  dispose(): void {}
}

function drawSkeleton(ctx: CanvasRenderingContext2D, pts: (Point2D | undefined)[]): void {
  const [ls, rs, le, re, lw, rw, lh, rh] = pts;
  const lines: [Point2D | undefined, Point2D | undefined][] = [[ls, rs], [ls, le], [le, lw], [rs, re], [re, rw], [ls, lh], [rs, rh], [lh, rh]];
  ctx.save();
  ctx.strokeStyle = "rgba(187,167,255,0.9)";
  ctx.lineWidth = 3;
  for (const [a, b] of lines) {
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.fillStyle = "#6D5DF6";
  for (const p of pts) {
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
