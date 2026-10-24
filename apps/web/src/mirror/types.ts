import type { GarmentCategory, Point2D, UpperBody } from "@fitlens/shared";
import type { PreparedGarment } from "./garment";

/** Smoothed pose in canvas pixels (y down). `z` is relative depth in the same units (smaller = closer). */
export interface TrackedPose {
  body: UpperBody;
  leftWrist?: Point2D;
  rightWrist?: Point2D;
  head?: Point2D;
  /** True when hips were out of frame and estimated from the shoulders. */
  hipsEstimated: boolean;
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

export interface RenderFrame {
  video: HTMLVideoElement;
  pose: TrackedPose | null;
  opacity: number;
  adjustments: FitAdjustments;
  timeMs: number;
  showBodyModel: boolean;
}

/** A compositor that draws the camera frame plus the garment into its own canvas. */
export interface MirrorRenderer {
  readonly kind: "flat" | "cloth3d";
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  setGarment(garment: PreparedGarment | null, category: GarmentCategory): void;
  render(frame: RenderFrame): void;
  dispose(): void;
}
