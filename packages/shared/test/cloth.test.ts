import { describe, expect, it } from "vitest";
import { buildBodyModel, defaultSpec, GarmentCloth, outlineHalfWidth, v3, type BodyFrame3D } from "../src/cloth";
import { DEFAULT_PROFILE } from "../src/calibration";

// Scene units are pixels: +y up, +z toward the camera.
function frame(dx = 0, elbowAngle = 0): BodyFrame3D {
  const sL = { x: 200 + dx, y: 500, z: 0 };
  const sR = { x: 400 + dx, y: 500, z: 0 };
  const arm = (s: typeof sL, side: number) => {
    const e = { x: s.x + side * Math.sin(elbowAngle) * 130, y: s.y - Math.cos(elbowAngle) * 130, z: 0 };
    return { e, w: { x: e.x + side * Math.sin(elbowAngle) * 120, y: e.y - Math.cos(elbowAngle) * 120, z: 0 } };
  };
  const L = arm(sL, -1);
  const R = arm(sR, 1);
  return {
    shoulderL: sL,
    shoulderR: sR,
    hipL: { x: 230 + dx, y: 220, z: 0 },
    hipR: { x: 370 + dx, y: 220, z: 0 },
    elbowL: L.e,
    elbowR: R.e,
    wristL: L.w,
    wristR: R.w,
    head: { x: 300 + dx, y: 600, z: 10 }
  };
}

function maxDisplacement(c: GarmentCloth): number {
  let m = 0;
  for (let n = 0; n < c.torso.count; n++) m = Math.max(m, v3.dist(c.torso.position(n), c.torso.target(n)));
  return m;
}

function finite(c: GarmentCloth): boolean {
  return [...c.torso.positions].every(Number.isFinite) && (c.sleeves ?? []).every((s) => [...s.positions].every(Number.isFinite));
}

describe("body model", () => {
  it("derives an orthonormal torso frame facing the camera", () => {
    const b = buildBodyModel(frame());
    expect(b.across.x).toBeCloseTo(1);
    expect(b.up.y).toBeCloseTo(1);
    expect(b.forward.z).toBeCloseTo(1);
    expect(v3.dot(b.across, b.up)).toBeCloseTo(0);
    expect(b.shoulderWidth).toBeCloseTo(200);
    expect(b.capsules).toHaveLength(4);
  });
  it("guesses hanging arms when elbows are not tracked", () => {
    const { elbowL: _a, elbowR: _b, wristL: _c, wristR: _d, ...noArms } = frame();
    const b = buildBodyModel(noArms);
    expect(b.armTrackedL).toBe(false);
    expect(b.armL[1]!.y).toBeLessThan(b.armL[0]!.y);
  });
});

describe("body outline from calibration", () => {
  it("sizes the garment from the measured body, not the shoulder joints", () => {
    const slim = buildBodyModel(frame(), { ...DEFAULT_PROFILE, chestRatio: 1.05, waistRatio: 0.9, hipRatio: 1.0 });
    const broad = buildBodyModel(frame(), { ...DEFAULT_PROFILE, chestRatio: 1.5, waistRatio: 1.45, hipRatio: 1.5 });
    expect(outlineHalfWidth(broad, 0.3)).toBeGreaterThan(outlineHalfWidth(slim, 0.3) * 1.3);
    const ringWidth = (b: ReturnType<typeof buildBodyModel>) => {
      const c = new GarmentCloth(defaultSpec("top"));
      c.step(b, 1 / 30);
      const row = Math.round((c.torso.rings - 1) * 0.4);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < c.torso.segments; i++) {
        const x = c.torso.position(c.torso.index(row, i)).x;
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
      return max - min;
    };
    // Default body (chest 1.22 × shoulder-joint width): garment is wider than the joints.
    expect(ringWidth(buildBodyModel(frame()))).toBeGreaterThan(200 * 1.2);
    expect(ringWidth(broad)).toBeGreaterThan(ringWidth(slim) * 1.25);
  });
  it("uses calibrated arm lengths for untracked arms", () => {
    const { elbowL: _a, elbowR: _b, wristL: _c, wristR: _d, ...noArms } = frame();
    const b = buildBodyModel(noArms, { ...DEFAULT_PROFILE, upperArmRatio: 1.0 });
    expect(v3.dist(b.armL[0]!, b.armL[1]!)).toBeCloseTo(200, 0);
  });
});

describe("garment cloth simulation", () => {
  it("snaps to the rest shape on the first frame and stays stable at rest", () => {
    const c = new GarmentCloth(defaultSpec("top"));
    const body = buildBodyModel(frame());
    c.step(body, 1 / 30);
    expect(maxDisplacement(c)).toBe(0);
    for (let i = 0; i < 120; i++) c.step(body, 1 / 30);
    expect(finite(c)).toBe(true);
    // Gravity sags the loose hem slightly but the garment keeps its shape.
    expect(maxDisplacement(c)).toBeLessThan(body.shoulderWidth * 0.25);
  });

  it("pins the shoulder line to the body", () => {
    const c = new GarmentCloth(defaultSpec("top"));
    const body = buildBodyModel(frame());
    for (let i = 0; i < 30; i++) c.step(body, 1 / 30);
    for (let i = 0; i < c.torso.segments; i++) {
      const n = c.torso.index(0, i);
      expect(v3.dist(c.torso.position(n), c.torso.target(n))).toBeLessThan(1e-3);
    }
  });

  it("keeps cloth outside the torso collider", () => {
    const c = new GarmentCloth({ ...defaultSpec("top"), ease: 0.9 }); // too tight: collision must hold it out
    const body = buildBodyModel(frame(0, Math.PI / 2)); // arms out, so only the torso collider is involved
    for (let i = 0; i < 60; i++) c.step(body, 1 / 30);
    let inside = 0;
    for (let n = 0; n < c.torso.count; n++) {
      const p = c.torso.position(n);
      const d = v3.sub(p, body.hipMid);
      const y = v3.dot(d, body.up);
      if (y < 0 || y > body.torsoLength * 0.85) continue; // armpit area is shaped by the arm colliders
      const x = v3.dot(d, body.across);
      const z = v3.dot(d, body.forward);
      const t = 1 - y / body.torsoLength;
      if (t < 0.15) continue; // tapered near the arm joints
      const A = outlineHalfWidth(body, t) * 0.97;
      if ((x * x) / (A * A) + (z * z) / (A * 0.6 * (A * 0.6)) < 0.97) inside++;
    }
    expect(inside).toBe(0);
  });

  it("makes the hem lag behind fast motion, then settle", () => {
    const c = new GarmentCloth(defaultSpec("top"));
    for (let i = 0; i < 30; i++) c.step(buildBodyModel(frame(0)), 1 / 30);
    const hemIndex = c.torso.index(c.torso.rings - 1, c.torso.segments / 4); // front-centre hem
    let lag = 0;
    for (let i = 1; i <= 10; i++) {
      c.step(buildBodyModel(frame(i * 8)), 1 / 30); // moving right at 240 px/s
      lag = Math.max(lag, c.torso.target(hemIndex).x - c.torso.position(hemIndex).x);
    }
    expect(lag).toBeGreaterThan(2); // hem trails the body
    for (let i = 0; i < 90; i++) c.step(buildBodyModel(frame(80)), 1 / 30);
    expect(Math.abs(c.torso.target(hemIndex).x - c.torso.position(hemIndex).x)).toBeLessThan(lag);
  });

  it("sleeves follow the arms when they are raised", () => {
    const c = new GarmentCloth(defaultSpec("outerwear"));
    for (let i = 0; i < 20; i++) c.step(buildBodyModel(frame(0, 0.2)), 1 / 30);
    const cuff = (s: number) => {
      const tube = c.sleeves![s]!;
      let y = 0;
      for (let i = 0; i < tube.segments; i++) y += tube.position(tube.index(tube.rings - 1, i)).y;
      return y / tube.segments;
    };
    const down = cuff(1);
    for (let i = 0; i < 60; i++) c.step(buildBodyModel(frame(0, Math.PI / 2)), 1 / 30); // arms out horizontally
    expect(cuff(1)).toBeGreaterThan(down + 100);
    expect(finite(c)).toBe(true);
  });

  it("snaps instead of whipping after a tracking jump", () => {
    const c = new GarmentCloth(defaultSpec("dress"));
    for (let i = 0; i < 10; i++) c.step(buildBodyModel(frame(0)), 1 / 30);
    c.step(buildBodyModel(frame(400)), 1 / 30);
    expect(maxDisplacement(c)).toBe(0);
  });
});
