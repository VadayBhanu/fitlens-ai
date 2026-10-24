/**
 * Records the composited mirror canvas — exactly what is rendered on screen —
 * using MediaRecorder. Optional microphone audio is requested separately from
 * the camera, only when the user turns it on.
 */

export const MAX_RECORDING_SECONDS = 60;

export function pickMimeType(): string {
  const candidates = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audio: MediaStream | null = null;
  private timer = 0;
  startedAt = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(withAudio: boolean, onAutoStop: (blob: Blob) => void): Promise<void> {
    if (typeof MediaRecorder === "undefined") throw new Error("Recording isn't supported in this browser.");
    const stream = this.canvas.captureStream(30);
    if (withAudio) {
      this.audio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.audio.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    const mimeType = pickMimeType();
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: 4_000_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
    this.startedAt = Date.now();
    this.timer = window.setTimeout(async () => onAutoStop(await this.stop()), MAX_RECORDING_SECONDS * 1000);
  }

  stop(): Promise<Blob> {
    clearTimeout(this.timer);
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec || rec.state === "inactive") return reject(new Error("Not recording"));
      rec.onstop = () => {
        this.audio?.getTracks().forEach((t) => t.stop());
        this.audio = null;
        const type = (rec.mimeType || "video/webm").split(";")[0]!;
        const blob = new Blob(this.chunks, { type });
        this.recorder = null;
        if (!blob.size) reject(new Error("The recording is empty."));
        else resolve(blob);
      };
      rec.stop();
    });
  }
}

/** Verify a recorded clip actually decodes and plays before offering it. */
export function validatePlayback(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(blob);
    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done(() => resolve(Number.isFinite(v.duration) ? v.duration : 0));
    v.onerror = () => done(() => reject(new Error("The recording couldn't be played back.")));
    v.src = url;
  });
}
