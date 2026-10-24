/**
 * One Euro filter (Casiez et al., CHI 2012): an adaptive low-pass filter that
 * smooths jitter at low speeds and stays responsive at high speeds — the right
 * trade-off for landmark tracking in a live mirror.
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.02,
    private readonly dCutoff = 1.0
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, timestampMs: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.tPrev = timestampMs;
      this.xPrev = x;
      return x;
    }
    const dt = Math.max((timestampMs - this.tPrev) / 1000, 1e-3);
    this.tPrev = timestampMs;
    const dx = (x - this.xPrev) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuroFilter.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.tPrev = null;
    this.dxPrev = 0;
  }
}

export interface Point2D {
  x: number;
  y: number;
  /** Optional relative depth (same units as x; smaller = closer to the camera). */
  z?: number;
}

export interface TrackedPoint extends Point2D {
  confidence: number;
}

/**
 * Confidence-aware smoother for a named set of 2D landmarks.
 * - High-confidence points are filtered with One Euro.
 * - Low-confidence points hold their last good value for `holdMs`, then drop.
 */
export class LandmarkSmoother<K extends string> {
  private readonly fx = new Map<K, OneEuroFilter>();
  private readonly fy = new Map<K, OneEuroFilter>();
  private readonly fz = new Map<K, OneEuroFilter>();
  private readonly last = new Map<K, { p: Point2D; t: number }>();

  constructor(
    private readonly minConfidence = 0.5,
    private readonly holdMs = 250,
    private readonly minCutoff = 1.2,
    private readonly beta = 0.02
  ) {}

  update(points: Record<K, TrackedPoint | undefined>, timestampMs: number): Partial<Record<K, Point2D>> {
    const out: Partial<Record<K, Point2D>> = {};
    for (const key of Object.keys(points) as K[]) {
      const p = points[key];
      if (p && p.confidence >= this.minConfidence) {
        if (!this.fx.has(key)) {
          this.fx.set(key, new OneEuroFilter(this.minCutoff, this.beta));
          this.fy.set(key, new OneEuroFilter(this.minCutoff, this.beta));
          // Depth from monocular pose is noisier than x/y: smooth it harder.
          this.fz.set(key, new OneEuroFilter(this.minCutoff * 0.5, this.beta * 0.5));
        }
        const s: Point2D = { x: this.fx.get(key)!.filter(p.x, timestampMs), y: this.fy.get(key)!.filter(p.y, timestampMs) };
        if (p.z !== undefined) s.z = this.fz.get(key)!.filter(p.z, timestampMs);
        this.last.set(key, { p: s, t: timestampMs });
        out[key] = s;
      } else {
        const held = this.last.get(key);
        if (held && timestampMs - held.t <= this.holdMs) {
          out[key] = held.p;
        } else {
          this.fx.get(key)?.reset();
          this.fy.get(key)?.reset();
          this.fz.get(key)?.reset();
          this.last.delete(key);
        }
      }
    }
    return out;
  }

  reset(): void {
    this.fx.clear();
    this.fy.clear();
    this.fz.clear();
    this.last.clear();
  }
}
