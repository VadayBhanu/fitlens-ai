import {
  buildBodyModel,
  DEFAULT_ANCHORS,
  defaultSpec,
  GarmentCloth,
  type BodyFrame3D,
  type ClothKind,
  type ClothTube,
  type GarmentAnchors,
  type GarmentCategory,
  type Point2D,
  type Vec3
} from "@fitlens/shared";
import * as THREE from "three";
import type { PreparedGarment } from "./garment";
import type { MirrorRenderer, RenderFrame, TrackedPose } from "./types";

/**
 * 3D cloth mode.
 *
 * Scene: an orthographic camera matched 1:1 to the video pixels, so the 3D
 * body model lines up exactly with the person in the frame while still having
 * real depth (from MediaPipe's per-landmark z). The camera image is the scene
 * background. The garment is a simulated cloth mesh (torso + sleeves, see
 * `GarmentCloth`) that collides with the body, is lit by lights adapted to
 * the room brightness, and is depth-tested against invisible arm/hand/head
 * occluders — so a forearm in front of the body correctly hides the shirt.
 */
export class ClothRenderer implements MirrorRenderer {
  readonly kind = "cloth3d" as const;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 20000);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a48, 1.0);
  private readonly key = new THREE.DirectionalLight(0xffffff, 1.3);
  private readonly fill = new THREE.DirectionalLight(0xffffff, 0.35);
  private readonly garmentGroup = new THREE.Group();
  private readonly occluders = new THREE.Group();
  private readonly occluderMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
  private readonly debugMaterial = new THREE.MeshBasicMaterial({ color: 0xbba7ff, transparent: true, opacity: 0.45 });
  private videoTexture: THREE.VideoTexture | null = null;
  private cloth: GarmentCloth | null = null;
  private meshes: { tube: ClothTube; mesh: THREE.Mesh; update: () => void }[] = [];
  private materials: THREE.MeshStandardMaterial[] = [];
  private textures: THREE.Texture[] = [];
  private width = 1;
  private height = 1;
  private lastTime = 0;
  private frameCount = 0;
  private readonly lumaCanvas = document.createElement("canvas");
  private readonly capsules: { cyl: THREE.Mesh; a: THREE.Mesh; b: THREE.Mesh }[] = [];
  private readonly headMesh: THREE.Mesh;
  private readonly hands: THREE.Mesh[] = [];

  static isSupported(): boolean {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  }

  constructor(readonly canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer lets captures (toBlob) and recordings read the exact frame shown.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);
    this.camera.position.set(0, 0, 10000);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.hemi, this.key, this.key.target, this.fill, this.fill.target, this.garmentGroup, this.occluders);
    this.lumaCanvas.width = 16;
    this.lumaCanvas.height = 9;

    const unitSphere = new THREE.SphereGeometry(1, 16, 12);
    const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    for (let k = 0; k < 4; k++) {
      const cap = { cyl: new THREE.Mesh(unitCylinder, this.occluderMaterial), a: new THREE.Mesh(unitSphere, this.occluderMaterial), b: new THREE.Mesh(unitSphere, this.occluderMaterial) };
      this.capsules.push(cap);
      this.occluders.add(cap.cyl, cap.a, cap.b);
    }
    for (let k = 0; k < 2; k++) {
      const h = new THREE.Mesh(unitSphere, this.occluderMaterial);
      this.hands.push(h);
      this.occluders.add(h);
    }
    this.headMesh = new THREE.Mesh(unitSphere, this.occluderMaterial);
    this.occluders.add(this.headMesh);
    // Occluders write depth only, before the garment, so the real arm/head shows through.
    this.occluders.traverse((o) => (o.renderOrder = -1));
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = height;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
    this.key.position.set(width * 0.35, height * 1.3, 4000);
    this.key.target.position.set(width / 2, height / 2, 0);
    this.fill.position.set(width * 0.9, height * 0.4, 3000);
    this.fill.target.position.set(width / 2, height / 2, 0);
  }

  setGarment(garment: PreparedGarment | null, category: GarmentCategory): void {
    this.clearGarment();
    if (!garment) return;
    const kind: ClothKind = category === "outerwear" ? "outerwear" : category === "dress" ? "dress" : "top";
    const anchors = DEFAULT_ANCHORS[kind];
    this.cloth = new GarmentCloth(defaultSpec(kind));

    const torsoTex = this.texture(buildTorsoAtlas(garment, anchors));
    this.addTube(this.cloth.torso, torsoTex);
    if (this.cloth.sleeves) {
      const long = kind === "outerwear";
      this.addTube(this.cloth.sleeves[0], this.texture(buildSleeveAtlas(garment, anchors, "left", long)));
      this.addTube(this.cloth.sleeves[1], this.texture(buildSleeveAtlas(garment, anchors, "right", long)));
    }
  }

  private texture(canvas: HTMLCanvasElement): THREE.Texture {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.textures.push(t);
    return t;
  }

  private addTube(tube: ClothTube, map: THREE.Texture): void {
    const { geometry, update } = tubeGeometry(tube);
    const material = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.86, metalness: 0, alphaTest: 0.45 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.materials.push(material);
    this.meshes.push({ tube, mesh, update });
    this.garmentGroup.add(mesh);
  }

  private clearGarment(): void {
    for (const m of this.meshes) {
      this.garmentGroup.remove(m.mesh);
      m.mesh.geometry.dispose();
    }
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.meshes = [];
    this.materials = [];
    this.textures = [];
    this.cloth = null;
  }

  private toScene(p: Point2D, zRef: number, zLimit: number): Vec3 {
    const z = -(p.z ?? zRef);
    return { x: p.x, y: this.height - p.y, z: Math.max(-zRef - zLimit, Math.min(-zRef + zLimit, z)) };
  }

  private bodyFrame(pose: TrackedPose): BodyFrame3D {
    const b = pose.body;
    const sw = Math.hypot(b.rightShoulder.x - b.leftShoulder.x, b.rightShoulder.y - b.leftShoulder.y);
    const zRef = ((b.leftShoulder.z ?? 0) + (b.rightShoulder.z ?? 0)) / 2;
    // Monocular depth is approximate; keep it within anatomically plausible bounds.
    const torsoZ = (p: Point2D) => this.toScene(p, zRef, sw * 0.6);
    const limbZ = (p?: Point2D) => (p ? this.toScene(p, zRef, sw * 1.2) : undefined);
    const hips = pose.hipsEstimated ? { ...b.leftHip, z: zRef } : b.leftHip;
    const hipsR = pose.hipsEstimated ? { ...b.rightHip, z: zRef } : b.rightHip;
    return {
      shoulderL: torsoZ(b.leftShoulder),
      shoulderR: torsoZ(b.rightShoulder),
      hipL: torsoZ(hips),
      hipR: torsoZ(hipsR),
      elbowL: limbZ(b.leftElbow),
      elbowR: limbZ(b.rightElbow),
      wristL: limbZ(pose.leftWrist),
      wristR: limbZ(pose.rightWrist),
      head: limbZ(pose.head)
    };
  }

  private adaptLighting(video: HTMLVideoElement): void {
    if (this.frameCount++ % 15 !== 0) return;
    const ctx = this.lumaCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, 16, 9);
    const d = ctx.getImageData(0, 0, 16, 9).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    const luma = sum / (d.length / 4) / 255; // 0..1
    const target = 0.55 + luma * 1.1;
    this.hemi.intensity += (target - this.hemi.intensity) * 0.5;
    this.key.intensity += (0.7 + luma * 1.2 - this.key.intensity) * 0.5;
  }

  render({ video, pose, opacity, adjustments, timeMs, showBodyModel, profile }: RenderFrame): void {
    if (!this.videoTexture || this.videoTexture.image !== video) {
      this.videoTexture?.dispose();
      this.videoTexture = new THREE.VideoTexture(video);
      this.videoTexture.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = this.videoTexture;
    }
    this.adaptLighting(video);
    const dt = this.lastTime ? (timeMs - this.lastTime) / 1000 : 1 / 30;
    this.lastTime = timeMs;

    const visible = !!pose && !!this.cloth && opacity > 0.01;
    this.garmentGroup.visible = visible;
    this.occluders.visible = !!pose;
    if (!pose) this.cloth?.reset();

    if (pose) {
      const body = buildBodyModel(this.bodyFrame(pose), profile);
      this.placeOccluders(body, showBodyModel);
      if (this.cloth) {
        this.cloth.spec.widthScale = adjustments.width;
        this.cloth.spec.lengthScale = adjustments.length;
        this.cloth.step(body, dt);
        for (const m of this.meshes) m.update();
        for (const mat of this.materials) {
          mat.opacity = opacity;
          const transparent = opacity < 0.99;
          if (mat.transparent !== transparent) {
            mat.transparent = transparent;
            mat.needsUpdate = true;
          }
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  private placeOccluders(body: ReturnType<typeof buildBodyModel>, debug: boolean): void {
    const mat = debug ? this.debugMaterial : this.occluderMaterial;
    const up = new THREE.Vector3(0, 1, 0);
    body.capsules.forEach((c, k) => {
      const cap = this.capsules[k]!;
      const a = new THREE.Vector3(c.a.x, c.a.y, c.a.z);
      const b = new THREE.Vector3(c.b.x, c.b.y, c.b.z);
      const len = a.distanceTo(b);
      cap.cyl.position.copy(a).add(b).multiplyScalar(0.5);
      cap.cyl.scale.set(c.r, Math.max(len, 1e-3), c.r);
      cap.cyl.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      cap.a.position.copy(a);
      cap.b.position.copy(b);
      cap.a.scale.setScalar(c.r);
      cap.b.scale.setScalar(c.r);
      [cap.cyl, cap.a, cap.b].forEach((m) => (m.material = mat));
    });
    const handR = body.shoulderWidth * 0.13;
    [body.armL, body.armR].forEach((arm, k) => {
      const hand = this.hands[k]!;
      const e = arm[1]!;
      const w = arm[2]!;
      // Hand centre sits a little past the wrist along the forearm.
      hand.position.set(w.x + (w.x - e.x) * 0.25, w.y + (w.y - e.y) * 0.25, w.z + (w.z - e.z) * 0.25);
      hand.scale.setScalar(handR);
      hand.material = mat;
      hand.visible = k === 0 ? body.armTrackedL : body.armTrackedR;
    });
    if (body.head) {
      this.headMesh.visible = true;
      this.headMesh.position.set(body.head.c.x, body.head.c.y - body.head.r * 0.15, body.head.c.z);
      this.headMesh.scale.set(body.head.r * 0.85, body.head.r * 1.05, body.head.r * 0.85);
      this.headMesh.material = mat;
    } else this.headMesh.visible = false;
  }

  dispose(): void {
    this.clearGarment();
    this.videoTexture?.dispose();
    this.renderer.dispose();
  }
}

/**
 * Tube mesh with a seam column duplicated so UVs can wrap. Segment 0 is on the
 * image-left edge; the front half (facing the camera) samples the left half of
 * the atlas with an orthographic (sin θ) mapping that matches a front product
 * photo; the back half samples the right half.
 */
function tubeGeometry(tube: ClothTube): { geometry: THREE.BufferGeometry; update: () => void } {
  const R = tube.rings;
  const N = tube.segments;
  const cols = N + 1;
  const positions = new Float32Array(R * cols * 3);
  const uvs = new Float32Array(R * cols * 2);
  const index: number[] = [];
  for (let r = 0; r < R; r++) {
    const v = 1 - r / (R - 1);
    for (let i = 0; i <= N; i++) {
      const th = -Math.PI / 2 + (2 * Math.PI * i) / N;
      const s = (Math.sin(th) + 1) / 2;
      const front = Math.cos(th) > -1e-9 && i < N;
      const o = (r * cols + i) * 2;
      uvs[o] = front ? s * 0.5 : 0.5 + (1 - s) * 0.5;
      uvs[o + 1] = v;
    }
  }
  for (let r = 0; r < R - 1; r++) {
    for (let i = 0; i < N; i++) {
      const a = r * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const update = () => {
    const src = tube.positions;
    for (let r = 0; r < R; r++) {
      for (let i = 0; i <= N; i++) {
        const s = (r * N + (i % N)) * 3;
        const d = (r * cols + i) * 3;
        positions[d] = src[s]!;
        positions[d + 1] = src[s + 1]!;
        positions[d + 2] = src[s + 2]!;
      }
    }
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  };
  return { geometry, update };
}

/** Average colour of opaque pixels — used for the unseen back of the garment. */
function averageColor(ctx: CanvasRenderingContext2D, w: number, h: number): string {
  const d = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3]! > 200) {
      r += d[i]!;
      g += d[i + 1]!;
      b += d[i + 2]!;
      n++;
    }
  }
  if (!n) return "rgb(128,128,128)";
  // Slightly darker: the back is usually in shadow relative to the front photo.
  return `rgb(${Math.round((r / n) * 0.9)},${Math.round((g / n) * 0.9)},${Math.round((b / n) * 0.9)})`;
}

/** Fill `x..x+w` with the back colour, shaped by the horizontally-flipped front silhouette. */
function paintBack(atlas: CanvasRenderingContext2D, front: HTMLCanvasElement, x: number, w: number, h: number, color: string): void {
  const back = document.createElement("canvas");
  back.width = w;
  back.height = h;
  const b = back.getContext("2d")!;
  b.fillStyle = color;
  b.fillRect(0, 0, w, h);
  const grad = b.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.12)");
  grad.addColorStop(0.5, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.12)");
  b.fillStyle = grad;
  b.fillRect(0, 0, w, h);
  b.globalCompositeOperation = "destination-in";
  b.save();
  b.translate(w, 0);
  b.scale(-1, 1);
  b.drawImage(front, 0, 0, w, h);
  b.restore();
  atlas.drawImage(back, x, 0);
}

export function buildTorsoAtlas(g: PreparedGarment, a: GarmentAnchors): HTMLCanvasElement {
  const S = 1024;
  const front = document.createElement("canvas");
  front.width = S / 2;
  front.height = S;
  const f = front.getContext("2d", { willReadFrequently: true })!;
  const x0 = a.leftSleeveCut * g.width;
  const x1 = a.rightSleeveCut * g.width;
  f.drawImage(g.canvas, x0, 0, x1 - x0, g.height, 0, 0, S / 2, S);
  const atlas = document.createElement("canvas");
  atlas.width = S;
  atlas.height = S;
  const ctx = atlas.getContext("2d")!;
  ctx.drawImage(front, 0, 0);
  paintBack(ctx, front, S / 2, S / 2, S, averageColor(f, S / 2, S));
  return atlas;
}

/**
 * Rectify one sleeve from the flat product photo into an upright strip: the
 * sleeve axis (shoulder seam → cuff) becomes vertical, so it wraps cleanly
 * around the 3D sleeve tube.
 */
export function buildSleeveAtlas(g: PreparedGarment, a: GarmentAnchors, side: "left" | "right", long: boolean): HTMLCanvasElement {
  const cut = (side === "left" ? a.leftSleeveCut : a.rightSleeveCut) * g.width;
  const shoulder = side === "left" ? a.leftShoulder : a.rightShoulder;
  const cuff = side === "left" ? a.leftCuff : a.rightCuff;
  // The sleeve's top edge runs from the shoulder point to the armpit; its axis
  // runs from the middle of that edge to the middle of the cuff.
  const shoulderPt = { x: shoulder.x * g.width, y: Math.max(shoulder.y, 0.02) * g.height };
  const armpitPt = { x: cut, y: a.armpitY * g.height };
  const p = { x: (shoulderPt.x + armpitPt.x) / 2, y: (shoulderPt.y + armpitPt.y) / 2 };
  const c = { x: cuff.x * g.width, y: cuff.y * g.height };
  const len = Math.hypot(c.x - p.x, c.y - p.y) * 1.04 || 1;
  const d = { x: (c.x - p.x) / len, y: (c.y - p.y) / len };
  const n = { x: d.y, y: -d.x }; // points toward image-right
  const topWidth = Math.abs((armpitPt.x - shoulderPt.x) * n.x + (armpitPt.y - shoulderPt.y) * n.y);
  const measured = measureSleeveWidth(g, p, d, n, len);
  const width = Math.max(measured ?? 0, topWidth, len * (long ? 0.18 : 0.45));

  const W = 256;
  const H = 512;
  const front = document.createElement("canvas");
  front.width = W;
  front.height = H;
  const f = front.getContext("2d", { willReadFrequently: true })!;
  const sx = W / width;
  const sy = H / len;
  // canvas = (W/2 + sx·n·(q−p), sy·d·(q−p))
  f.setTransform(sx * n.x, sy * d.x, sx * n.y, sy * d.y, W / 2 - sx * (n.x * p.x + n.y * p.y), -sy * (d.x * p.x + d.y * p.y));
  f.beginPath();
  // Only the sleeve's side of the photo, so torso pixels don't leak in.
  if (side === "left") f.rect(0, 0, cut + 2, g.height);
  else f.rect(cut - 2, 0, g.width - cut + 2, g.height);
  f.clip();
  f.drawImage(g.canvas, 0, 0);
  f.setTransform(1, 0, 0, 1, 0, 0);
  const color = averageColor(f, W, H);
  // A sleeve is a closed fabric tube: fill any background the flat photo left
  // around it with the fabric colour so the 3D sleeve is solid. Its length is
  // set by the simulated geometry, not by photo transparency.
  f.globalCompositeOperation = "destination-over";
  f.fillStyle = color;
  f.fillRect(0, 0, W, H);
  f.globalCompositeOperation = "source-over";

  const atlas = document.createElement("canvas");
  atlas.width = W * 2;
  atlas.height = H;
  const ctx = atlas.getContext("2d")!;
  ctx.drawImage(front, 0, 0);
  ctx.fillStyle = color;
  ctx.fillRect(W, 0, W, H);
  const shade = ctx.createLinearGradient(W, 0, 2 * W, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.1)");
  shade.addColorStop(0.5, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.1)");
  ctx.fillStyle = shade;
  ctx.fillRect(W, 0, W, H);
  return atlas;
}

function measureSleeveWidth(g: PreparedGarment, p: Point2D, d: Point2D, n: Point2D, len: number): number | null {
  const ctx = g.canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, g.width, g.height).data;
  const alphaAt = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= g.width || yi >= g.height) return 0;
    return data[(yi * g.width + xi) * 4 + 3]!;
  };
  const widths: number[] = [];
  for (const t of [0.35, 0.5, 0.65]) {
    const cx = p.x + d.x * len * t;
    const cy = p.y + d.y * len * t;
    if (alphaAt(cx, cy) < 60) continue;
    let w = 0;
    for (const sgn of [-1, 1]) {
      let k = 0;
      while (k < len && alphaAt(cx + n.x * k * sgn, cy + n.y * k * sgn) > 60) k++;
      w += k;
    }
    widths.push(w);
  }
  if (!widths.length) return null;
  widths.sort((x, y) => x - y);
  return Math.max(len * 0.15, Math.min(len * 1.2, widths[widths.length >> 1]! * 1.05));
}
