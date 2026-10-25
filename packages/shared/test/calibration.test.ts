import { describe, expect, it } from "vitest";
import { BodyCalibrator, buildProfile, DEFAULT_PROFILE, evaluateCalibration, measureMaskWidth, sampleBody, type CalibLandmarks, type PersonMask } from "../src/calibration";

const W = 1280;
const H = 720;
const v = (x: number, y: number, visibility = 0.95, z = 0) => ({ x, y, z, visibility });

/** A person standing centred, facing the camera, arms in an A-pose. */
function goodPose(dx = 0): CalibLandmarks {
  return {
    nose: v(640 + dx, 150),
    eyeL: v(625 + dx, 140),
    eyeR: v(655 + dx, 140),
    shoulderL: v(560 + dx, 260),
    shoulderR: v(720 + dx, 260),
    elbowL: v(515 + dx, 370),
    elbowR: v(765 + dx, 370),
    wristL: v(490 + dx, 470),
    wristR: v(790 + dx, 470),
    hipL: v(590 + dx, 490),
    hipR: v(690 + dx, 490)
  };
}

/** Elliptical torso silhouette in a mask matching goodPose: chest 1.3×, waist 1.1×, hips 1.25× shoulder width. */
function torsoMask(): PersonMask {
  const data = new Float32Array(W * H);
  const sw = 160;
  const half = (y: number) => {
    const t = (y - 260) / 230;
    if (t < 0 || t > 1.05) return 0;
    const stops = [[0, 0.62], [0.3, 0.65], [0.68, 0.55], [1, 0.625], [1.05, 0.625]];
    for (let k = 0; k < stops.length - 1; k++) {
      const [t0, w0] = stops[k]!;
      const [t1, w1] = stops[k + 1]!;
      if (t <= t1!) return (w0! + (w1! - w0!) * ((t - t0!) / (t1! - t0!))) * sw;
    }
    return 0;
  };
  for (let y = 0; y < H; y++) {
    const h = half(y);
    for (let x = Math.round(640 - h); x < 640 + h; x++) data[y * W + x] = 1;
  }
  return { data, width: W, height: H, threshold: 0.5 };
}

describe("calibration checks", () => {
  it("passes every check for a good pose", () => {
    const checks = evaluateCalibration(goodPose(), W, H, 0);
    expect(checks.filter((c) => !c.ok).map((c) => c.id)).toEqual([]);
  });
  it("asks the user to centre, come closer, show hips, face the camera and lift arms", () => {
    const off = evaluateCalibration(goodPose(300), W, H, 0);
    expect(off.find((c) => c.id === "centered")!.ok).toBe(false);

    const far = goodPose();
    far.shoulderL = v(590, 260);
    far.shoulderR = v(690, 260); // 100 px of 1280 = 7.8% of the frame
    const farChecks = evaluateCalibration(far, W, H, 0);
    expect(farChecks.find((c) => c.id === "distance")!.hint).toMatch(/closer/);

    const noHips = goodPose();
    noHips.hipL = v(590, 760, 0.2);
    expect(evaluateCalibration(noHips, W, H, 0).find((c) => c.id === "hips")!.ok).toBe(false);
    expect(evaluateCalibration(noHips, W, H, 0, false).find((c) => c.id === "hips")!.ok).toBe(true);

    const turned = goodPose();
    turned.shoulderR = v(720, 300);
    expect(evaluateCalibration(turned, W, H, 0).find((c) => c.id === "facing")!.ok).toBe(false);

    const armsDown = goodPose();
    armsDown.elbowL = v(560, 380);
    armsDown.elbowR = v(720, 380);
    expect(evaluateCalibration(armsDown, W, H, 0).find((c) => c.id === "arms")!.ok).toBe(false);

    const noFace = goodPose();
    noFace.nose = v(640, 150, 0.1);
    expect(evaluateCalibration(noFace, W, H, 0).find((c) => c.id === "face")!.ok).toBe(false);

    expect(evaluateCalibration(goodPose(), W, H, 0.2).find((c) => c.id === "still")!.ok).toBe(false);
  });
});

describe("body measurement", () => {
  it("measures widths through a mask", () => {
    const m = torsoMask();
    const w = measureMaskWidth(m, { x: 640, y: 330 }, { x: 1, y: 0 }, 1000);
    expect(w).toBeGreaterThan(200);
    expect(measureMaskWidth(m, { x: 100, y: 330 }, { x: 1, y: 0 }, 1000)).toBeNull();
  });
  it("derives proportions and the real outline", () => {
    const s = sampleBody(goodPose(), W, H, torsoMask())!;
    expect(s.torso).toBeCloseTo(230 / 160, 2);
    expect(s.chest!).toBeGreaterThan(1.2);
    expect(s.chest!).toBeLessThan(1.4);
    expect(s.waist!).toBeLessThan(s.chest!);
    expect(s.hip!).toBeGreaterThan(s.waist!);
    expect(s.upperArm).toBeGreaterThan(0.6);
  });
  it("falls back to defaults for anything it couldn't measure", () => {
    const p = buildProfile([]);
    expect(p.chestRatio).toBe(DEFAULT_PROFILE.chestRatio);
    expect(p.measuredOutline).toBe(false);
  });
});

describe("BodyCalibrator", () => {
  it("completes after holding a good pose, and restarts when the pose breaks", () => {
    const cal = new BodyCalibrator({ holdMs: 1000, minSamples: 5 });
    const mask = torsoMask();
    let r = cal.update(goodPose(), W, H, 0, mask);
    expect(r.profile).toBeNull();
    for (let t = 100; t <= 500; t += 100) r = cal.update(goodPose(), W, H, t, mask);
    expect(r.progress).toBeGreaterThan(0.2);
    r = cal.update(goodPose(300), W, H, 600, mask); // walked off-centre
    expect(r.progress).toBe(0);
    expect(r.instruction).toMatch(/middle/);
    // The "hold still" check needs the jump to leave its 600 ms motion window first.
    for (let t = 700; t <= 2600; t += 100) r = cal.update(goodPose(), W, H, t, mask);
    expect(r.profile).not.toBeNull();
    expect(r.profile!.measuredOutline).toBe(true);
    expect(r.profile!.hipsMeasured).toBe(true);
    expect(r.profile!.chestRatio).toBeGreaterThan(1.2);
  });
});
