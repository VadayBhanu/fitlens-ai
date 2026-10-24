import { pickMimeType } from "../mirror/recorder";

export interface ReelSlide {
  imageUrl: string;
  caption?: string;
}

/**
 * Deterministic vertical fashion reel (1080×1920): Ken Burns pan/zoom,
 * cross-fades and captions, rendered locally and encoded with MediaRecorder.
 * This is an edit of the user's own looks, not AI-generated footage.
 */
export async function renderReel(slides: ReelSlide[], onProgress: (p: number) => void, secondsPerSlide = 2.6): Promise<Blob> {
  if (!slides.length) throw new Error("Choose at least one look.");
  if (typeof MediaRecorder === "undefined") throw new Error("Video export isn't supported in this browser.");
  const W = 1080, H = 1920, FPS = 30, FADE = 0.5;
  const images = await Promise.all(
    slides.map(async (s) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = s.imageUrl;
      await img.decode();
      return img;
    })
  );
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(FPS);
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const total = slides.length * secondsPerSlide;
  const drawSlide = (i: number, t: number, alpha: number) => {
    const img = images[i]!;
    const zoom = 1.04 + 0.08 * t;
    const s = Math.max(W / img.width, H / img.height) * zoom;
    const dw = img.width * s, dh = img.height * s;
    const dx = (W - dw) / 2 + (i % 2 ? -1 : 1) * 30 * t;
    const dy = (H - dh) / 2;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#0B1020";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, dx, dy, dw, dh);
    const caption = slides[i]!.caption;
    if (caption) {
      const grad = ctx.createLinearGradient(0, H - 420, 0, H);
      grad.addColorStop(0, "rgba(11,16,32,0)");
      grad.addColorStop(1, "rgba(11,16,32,0.85)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, H - 420, W, 420);
      ctx.fillStyle = "#F6F4FF";
      ctx.font = "600 64px Inter, system-ui, sans-serif";
      ctx.textAlign = "left";
      wrap(ctx, caption, 80, H - 200, W - 160, 76);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(246,244,255,0.85)";
    ctx.font = "600 34px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("FitLens", W - 60, 100);
  };

  return new Promise((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: (rec.mimeType || "video/webm").split(";")[0] }));
    rec.onerror = () => reject(new Error("Video encoding failed."));
    rec.start(500);
    const start = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      if (elapsed >= total) {
        rec.stop();
        onProgress(1);
        return;
      }
      const i = Math.min(Math.floor(elapsed / secondsPerSlide), slides.length - 1);
      const local = (elapsed - i * secondsPerSlide) / secondsPerSlide;
      drawSlide(i, local, 1);
      const intoNext = elapsed - (i + 1) * secondsPerSlide + FADE;
      if (i + 1 < slides.length && intoNext > 0) drawSlide(i + 1, 0, Math.min(intoNext / FADE, 1));
      onProgress(elapsed / total);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(/\s+/);
  let line = "";
  const lines: string[] = [];
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}
