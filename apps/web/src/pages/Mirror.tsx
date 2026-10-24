import { inferCategory, type GarmentCategory } from "@fitlens/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PhotoInput } from "../components/PhotoInput";
import { Notice, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { canvasToBlob, downloadBlob, loadBitmap } from "../lib/image";
import { DEFAULT_ADJUSTMENTS, MirrorEngine, type FitAdjustments, type MirrorStatus } from "../mirror/engine";
import { prepareGarment, type PreparedGarment } from "../mirror/garment";
import { CanvasRecorder, MAX_RECORDING_SECONDS, validatePlayback } from "../mirror/recorder";

const SAMPLES: { label: string; url: string; category: GarmentCategory }[] = [
  { label: "Crew tee", url: "/demo-store/img/crew-tee-white.png", category: "top" },
  { label: "Denim jacket", url: "/demo-store/img/denim-jacket-indigo.png", category: "outerwear" },
  { label: "Camp shirt", url: "/demo-store/img/camp-shirt-sage.png", category: "top" }
];

interface Clip {
  blob: Blob;
  url: string;
  kind: "photo" | "video";
}

export default function Mirror() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<MirrorEngine | null>(null);
  const recorderRef = useRef<CanvasRecorder | null>(null);

  const [status, setStatus] = useState<MirrorStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [garment, setGarment] = useState<{ prepared: PreparedGarment; label: string; category: GarmentCategory } | null>(null);
  const [adjust, setAdjust] = useState<FitAdjustments>({ ...DEFAULT_ADJUSTMENTS });
  const [mirrored, setMirrored] = useState(true);
  const [skeleton, setSkeleton] = useState(false);
  const [withAudio, setWithAudio] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const loadGarment = useCallback(async (src: Blob | string, label: string, category: GarmentCategory) => {
    setError(null);
    try {
      const bitmap = await loadBitmap(src);
      const prepared = await prepareGarment(bitmap);
      bitmap.close();
      setGarment({ prepared, label, category });
    } catch {
      setError("We couldn't load that garment image.");
    }
  }, []);

  // Garment from a product selected in the extension/studio.
  useEffect(() => {
    const id = params.get("product");
    if (!id || !user) return;
    api
      .product(id)
      .then((p) => {
        if (p.garmentAssetUrl) void loadGarment(p.garmentAssetUrl, p.name, p.category === "other" ? inferCategory(p.name) : p.category);
        else setError("This product has no garment image yet. Upload one in the Try-On Studio.");
      })
      .catch(() => setError("We couldn't load that product."));
  }, [params, user, loadGarment]);

  useEffect(() => {
    if (!garment && !params.get("product")) void loadGarment(SAMPLES[1]!.url, SAMPLES[1]!.label, SAMPLES[1]!.category);
  }, [garment, params, loadGarment]);

  useEffect(() => {
    engineRef.current?.setGarment(garment?.prepared ?? null, garment?.category ?? "top");
  }, [garment]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.adjustments = adjust;
  }, [adjust]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.showSkeleton = skeleton;
  }, [skeleton]);

  // Stop the camera when leaving the page or hiding the tab.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && !recorderRef.current?.recording) engineRef.current?.pause();
      else if (!document.hidden) engineRef.current?.resume();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      engineRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - (recorderRef.current?.startedAt ?? Date.now())) / 1000)), 250);
    return () => clearInterval(id);
  }, [recording]);

  const start = async (deviceId?: string) => {
    if (!canvasRef.current || !videoRef.current) return;
    setError(null);
    setStarting(true);
    try {
      const engine = engineRef.current ?? new MirrorEngine(canvasRef.current, videoRef.current, setStatus);
      engineRef.current = engine;
      engine.adjustments = adjust;
      engine.showSkeleton = skeleton;
      engine.setGarment(garment?.prepared ?? null, garment?.category ?? "top");
      await engine.start(deviceId || undefined);
      recorderRef.current = new CanvasRecorder(canvasRef.current);
      setRunning(true);
      setCameras(await MirrorEngine.listCameras());
    } catch (e) {
      const err = e as Error;
      setError(
        err.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser's site settings, or use the Try-On Studio with a photo instead."
          : err.name === "NotFoundError"
            ? "No camera was found."
            : `The Live Mirror couldn't start: ${err.message}`
      );
    } finally {
      setStarting(false);
    }
  };

  const stop = () => {
    engineRef.current?.stop();
    setRunning(false);
    setStatus(null);
  };

  const capture = async () => {
    const c = canvasRef.current;
    if (!c) return;
    let source: HTMLCanvasElement = c;
    if (mirrored) {
      // Save what the user sees in the mirrored preview.
      source = document.createElement("canvas");
      source.width = c.width;
      source.height = c.height;
      const ctx = source.getContext("2d")!;
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(c, 0, 0);
    }
    const blob = await canvasToBlob(source, "image/jpeg", 0.92);
    setSaveState("idle");
    setClip({ blob, url: URL.createObjectURL(blob), kind: "photo" });
  };

  const toggleRecord = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      if (rec.recording) {
        const blob = await rec.stop();
        setRecording(false);
        await finishRecording(blob);
      } else {
        await rec.start(withAudio, async (blob) => {
          setRecording(false);
          await finishRecording(blob);
        });
        setElapsed(0);
        setRecording(true);
      }
    } catch (e) {
      setRecording(false);
      setError((e as Error).message);
    }
  };

  const finishRecording = async (blob: Blob) => {
    try {
      await validatePlayback(blob);
      setSaveState("idle");
      setClip({ blob, url: URL.createObjectURL(blob), kind: "video" });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveClip = async () => {
    if (!clip || !user) return;
    setSaveState("saving");
    try {
      const asset = await api.upload(clip.kind === "photo" ? "capture" : "recording", clip.blob);
      const productId = params.get("product") ?? undefined;
      await api.addToWardrobe({ kind: clip.kind === "photo" ? "capture" : "recording", mediaAssetId: asset.id, productId, note: garment?.label });
      setSaveState("saved");
    } catch (e) {
      setSaveState("idle");
      setError((e as Error).message);
    }
  };

  const stateDot = status?.state === "tracking" ? "ok" : status?.state === "partial" ? "" : "bad";

  return (
    <div className="container stack" style={{ gap: 20 }}>
      <div className="row between">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Live Mirror</span>
          <h2>Move in it</h2>
        </div>
        <span className="badge badge-iris">Runs on your device · video is never uploaded</span>
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        <div className="stack">
          <div className="mirror-stage">
            <canvas ref={canvasRef} className={mirrored ? "mirrored" : ""} aria-label="Live mirror preview" />
            <video ref={videoRef} hidden muted playsInline />
            {!running && (
              <div className="mirror-empty">
                <div className="stack" style={{ alignItems: "center" }}>
                  <p style={{ margin: 0 }}>Your camera turns on only when you press Start, and turns off when you leave this page.</p>
                  <button className="btn btn-primary" onClick={() => start(cameraId)} disabled={starting}>
                    {starting ? "Starting…" : "Start Live Mirror"}
                  </button>
                </div>
              </div>
            )}
            {running && status && (
              <>
                <div className="mirror-hud">
                  <span className="hud-pill"><span className={`dot ${stateDot}`} />{status.state === "tracking" ? "Tracking" : status.state === "partial" ? "Partial" : "Searching"}</span>
                  <span className="hud-pill">{status.fps} fps · {status.inferenceMs} ms{recording && <> · <span className="record-dot" /> {elapsed}s / {MAX_RECORDING_SECONDS}s</>}</span>
                </div>
                {status.state !== "tracking" && <div className="mirror-guide">{status.message}</div>}
              </>
            )}
          </div>
          {running && (
            <div className="row">
              <button className="btn btn-primary" onClick={capture}>Capture photo</button>
              <button className={`btn ${recording ? "btn-danger" : "btn-secondary"}`} onClick={toggleRecord}>
                {recording ? <><span className="record-dot" /> Stop recording</> : "Record clip"}
              </button>
              <label className="check" style={{ alignItems: "center" }}>
                <input type="checkbox" checked={withAudio} disabled={recording} onChange={(e) => setWithAudio(e.target.checked)} /> Include microphone
              </label>
              <button className="btn btn-ghost" onClick={stop} disabled={recording}>Stop camera</button>
            </div>
          )}
          {clip && (
            <div className="card stack">
              <div className="row between">
                <h3>{clip.kind === "photo" ? "Captured photo" : "Recorded clip"}</h3>
                <span className="badge">Camera recording with virtual garment overlay</span>
              </div>
              {clip.kind === "photo" ? <img src={clip.url} alt="Captured outfit" style={{ borderRadius: 12 }} /> : <video src={clip.url} controls playsInline style={{ borderRadius: 12, width: "100%" }} />}
              <div className="row">
                <button className="btn btn-secondary" onClick={() => downloadBlob(clip.blob, `fitlens-${Date.now()}.${clip.kind === "photo" ? "jpg" : clip.blob.type.includes("mp4") ? "mp4" : "webm"}`)}>Download</button>
                {user ? (
                  <button className="btn btn-primary" onClick={saveClip} disabled={saveState !== "idle"}>{saveState === "saved" ? "Saved ✓" : saveState === "saving" ? "Saving…" : "Save to wardrobe"}</button>
                ) : (
                  <Link className="btn btn-primary" to="/login?next=/mirror">Sign in to save</Link>
                )}
                <button className="btn btn-ghost" onClick={() => setClip(null)}>Discard</button>
              </div>
            </div>
          )}
        </div>

        <div className="stack">
          <section className="card stack">
            <h3>Garment</h3>
            {garment ? (
              <div className="row">
                <img className="thumb" src={garment.prepared.canvas.toDataURL()} alt="" style={{ objectFit: "contain" }} />
                <div>
                  <div style={{ fontWeight: 600 }}>{garment.label}</div>
                  <div className="muted small">
                    {garment.prepared.cutout === "transparent-source" ? "Transparent image" : garment.prepared.cutout === "background-removed" ? "Background removed automatically" : "Couldn't remove the background — a PNG with transparency works best"}
                  </div>
                </div>
              </div>
            ) : (
              <Spinner label="Loading garment…" />
            )}
            <div className="row">
              {SAMPLES.map((s) => (
                <button key={s.url} className="btn btn-secondary btn-sm" onClick={() => loadGarment(s.url, s.label, s.category)}>{s.label}</button>
              ))}
            </div>
            <details>
              <summary className="small muted" style={{ cursor: "pointer" }}>Use your own garment image</summary>
              <div style={{ marginTop: 12 }}>
                <PhotoInput label="Upload a front-facing garment photo" allowCamera={false} onFile={(f) => loadGarment(f, f.name.replace(/\.\w+$/, ""), inferCategory(f.name) === "outerwear" ? "outerwear" : "top")} />
              </div>
            </details>
            {garment && (
              <div className="row">
                <label className="small" htmlFor="mcat">Fit as</label>
                <select id="mcat" style={{ height: 36 }} value={garment.category} onChange={(e) => setGarment({ ...garment, category: e.target.value as GarmentCategory })}>
                  <option value="top">Top (short sleeves)</option>
                  <option value="outerwear">Outerwear (long sleeves)</option>
                  <option value="dress">Dress</option>
                </select>
              </div>
            )}
          </section>

          <section className="card stack">
            <h3>Adjust fit</h3>
            {([
              ["size", "Size", 0.8, 1.25, 0.01],
              ["width", "Width", 0.8, 1.3, 0.01],
              ["length", "Length", 0.8, 1.3, 0.01],
              ["offsetY", "Position", -0.2, 0.2, 0.005]
            ] as const).map(([key, label, min, max, step]) => (
              <div className="field" key={key}>
                <label htmlFor={`adj-${key}`}>{label}</label>
                <input id={`adj-${key}`} type="range" min={min} max={max} step={step} value={adjust[key]} onChange={(e) => setAdjust({ ...adjust, [key]: Number(e.target.value) })} />
              </div>
            ))}
            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => setAdjust({ ...DEFAULT_ADJUSTMENTS })}>Reset</button>
              <label className="check" style={{ alignItems: "center" }}><input type="checkbox" checked={mirrored} onChange={(e) => setMirrored(e.target.checked)} /> Mirror view</label>
              <label className="check" style={{ alignItems: "center" }}><input type="checkbox" checked={skeleton} onChange={(e) => setSkeleton(e.target.checked)} /> Show tracking</label>
            </div>
            {cameras.length > 1 && (
              <div className="field">
                <label htmlFor="cam">Camera</label>
                <select id="cam" value={cameraId} onChange={(e) => { setCameraId(e.target.value); void start(e.target.value); }} disabled={recording}>
                  {cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>)}
                </select>
              </div>
            )}
          </section>

          <Notice kind="info" title="What the Live Mirror can and can't do">
            It follows your shoulders, torso and arms for one person facing the camera, with slight turns. Big rotations, crossed arms and loose or flowing garments are approximated. For a
            photorealistic preview, use the <Link to={`/studio${params.get("product") ? `?product=${params.get("product")}` : ""}`}>Try-On Studio</Link>.
          </Notice>
        </div>
      </div>
    </div>
  );
}
