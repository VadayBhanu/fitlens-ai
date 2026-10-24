import { describe, expect, it } from "vitest";
import { LandmarkSmoother, OneEuroFilter } from "../src/filters";
import { computeGarmentLayout, DEFAULT_ANCHORS, quadPoint, triangleTransform } from "../src/geometry";
import { assessPersonPhoto, computeImageStats } from "../src/quality";

describe("OneEuroFilter", () => {
  it("smooths noise around a constant", () => {
    const f = new OneEuroFilter(1, 0.0);
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(100 + (i % 2 ? 3 : -3), i * 33);
    expect(Math.abs(out - 100)).toBeLessThan(2);
  });
  it("follows large motion", () => {
    const f = new OneEuroFilter(1, 0.05);
    let out = 0;
    for (let i = 0; i < 30; i++) out = f.filter(i * 20, i * 33);
    expect(out).toBeGreaterThan(29 * 20 * 0.8);
  });
});

describe("LandmarkSmoother", () => {
  it("holds low-confidence points briefly then drops them", () => {
    const s = new LandmarkSmoother<"a">(0.5, 100);
    expect(s.update({ a: { x: 1, y: 1, confidence: 0.9 } }, 0).a).toBeDefined();
    expect(s.update({ a: { x: 9, y: 9, confidence: 0.1 } }, 50).a).toEqual({ x: 1, y: 1 });
    expect(s.update({ a: undefined }, 200).a).toBeUndefined();
  });
});

describe("garment layout", () => {
  const body = {
    leftShoulder: { x: 200, y: 200 },
    rightShoulder: { x: 400, y: 200 },
    leftHip: { x: 230, y: 480 },
    rightHip: { x: 370, y: 480 },
    leftElbow: { x: 160, y: 330 },
    rightElbow: { x: 440, y: 330 }
  };
  it("centres the torso panel between the shoulders and extends below the hips", () => {
    const l = computeGarmentLayout(body, DEFAULT_ANCHORS.top);
    const topMid = quadPoint(l.torso, 0.5, 0);
    const bottomMid = quadPoint(l.torso, 0.5, 1);
    expect(topMid.x).toBeCloseTo(300, 0);
    expect(topMid.y).toBeLessThan(200);
    expect(bottomMid.y).toBeGreaterThan(480);
    expect(l.torso[1].x - l.torso[0].x).toBeGreaterThan(200);
    expect(l.leftSleeve?.armAngle).toBeGreaterThan(Math.PI / 2);
    expect(l.rightSleeve?.armAngle).toBeLessThan(Math.PI / 2);
  });
  it("omits sleeves without elbows", () => {
    const { leftElbow: _l, rightElbow: _r, ...noArms } = body;
    const l = computeGarmentLayout(noArms, DEFAULT_ANCHORS.top);
    expect(l.leftSleeve).toBeNull();
  });
  it("computes affine triangle transforms", () => {
    const t = triangleTransform({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 10 }, { x: 12, y: 10 }, { x: 10, y: 13 });
    expect(t).toEqual([2, 0, 0, 3, 10, 10]);
    expect(triangleTransform({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe("photo quality", () => {
  function img(w: number, h: number, fn: (x: number, y: number) => number) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const p = (y * w + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
    return d;
  }
  it("flags flat, dark images as blocking", () => {
    const s = computeImageStats(img(64, 64, () => 20), 64, 64, 1000, 1400);
    const q = assessPersonPhoto(s, 1);
    expect(q.ok).toBe(false);
    expect(q.blocking.join(" ")).toMatch(/dark/);
    expect(q.blocking.join(" ")).toMatch(/blurry/);
  });
  it("accepts a detailed, well-lit image", () => {
    const s = computeImageStats(img(64, 64, (x, y) => ((x + y) % 2 ? 200 : 90)), 64, 64, 1000, 1400);
    expect(assessPersonPhoto(s, 1).ok).toBe(true);
  });
  it("blocks multiple people", () => {
    const s = { width: 1000, height: 1400, brightness: 128, sharpness: 500 };
    expect(assessPersonPhoto(s, 2).ok).toBe(false);
  });
});
