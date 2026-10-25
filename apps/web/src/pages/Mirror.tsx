import { DEFAULT_PROFILE, inferCategory, type BodyProfile, type CalibrationProgress, type GarmentCategory } from "@fitlens/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalibrationChecklist, CalibrationOverlay } from "../components/CalibrationGuide";
import { PhotoInput } from "../components/PhotoInput";
import { Notice, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { clearProfile, loadProfile, saveProfile } from "../lib/bodyProfile";
import { canvasToBlob, downloadBlob, loadBitmap } from "../lib/image";
import { DEFAULT_ADJUSTMENTS, MirrorEngine, type FitAdjustments, type MirrorStatus } from "../mirror/engine";
import { prepareGarment, type PreparedGarment } from "../mirror/garment";
import { FlatRenderer } from "../mirror/renderer2d";
import { ClothRenderer } from "../mirror/renderer3d";
import type { MirrorRenderer } from "../mirror/types";
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
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const renderersRef = useRef<Partial<Record<MirrorRenderer["kind"], MirrorRenderer>>>({});
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
  const [mode, setMode] = useState<MirrorRenderer["kind"]>(() => (ClothRenderer.isSupported() ? "cloth3d" : "flat"));
  const [withAudio, setWithAudio] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [profile, setProfile] = useState<BodyProfile | null>(() => loadProfile());
  const [calibrating, setCalibrating] = useState(false);
  const [calib, setCalib] = useState<CalibrationProgress | null>(null);
  const [requireHips, setRequireHips] = useState(true);
  const [justCalibrated, setJustCalibrated] = useState(false);
  const calibStartRef = useRef(0);

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
    if (engineRef.current) engineRef.current.showBodyModel = skeleton;
  }, [skeleton]);

  const getRenderer = useCallback((kind: MirrorRenderer["kind"]): MirrorRenderer => {
    const cache = renderersRef.current;
    if (!cache[kind]) cache[kind] = kind === "cloth3d" ? new ClothRenderer(canvas3dRef.current!) : new FlatRenderer(canvas2dRef.current!);
    return cache[kind]!;
  }, []);

  // Switch between 3D cloth simulation and the flat 2D renderer without restarting the camera.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || engine.rendererKind === mode) return;
    engine.setRenderer(getRenderer(mode));
    recorderRef.current = new CanvasRecorder(engine.canvas);
  }, [mode, getRenderer]);

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
      Object.values(renderersRef.current).forEach((r) => r?.dispose());
      renderersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - (recorderRef.current?.startedAt ?? Date.now())) / 1000)), 250);
    return () => clearInterval(id);
  }, [recording]);

  const beginCalibration = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setCalib(null);
    setJustCalibrated(false);
    setRequireHips(true);
    calibStartRef.current = Date.now();
    setCalibrating(true);
    engine.onCalibration = (p) => {
      setCalib(p);
      if (p.profile) {
        saveProfile(p.profile);
        setProfile(p.profile);
        setCalibrating(false);
        setJustCalibrated(true);
      }
    };
    await engine.startCalibration(true);
  }, []);

  const skipCalibration = () => {
    engineRef.current?.finishCalibration();
    setCalibrating(false);
  };

  const calibrateWithoutHips = () => {
    setRequireHips(false);
    engineRef.current?.setRequireHips(false);
  };

  const forgetProfile = () => {
    clearProfile();
    setProfile(null);
    if (engineRef.current) engineRef.current.profile = DEFAULT_PROFILE;
  };

  const start = async (deviceId?: string) => {
    if (!canvas3dRef.current || !canvas2dRef.current || !videoRef.current) return;
    setError(null);
    setStarting(true);
    try {
      let renderer: MirrorRenderer;
      try {
        renderer = getRenderer(mode);
      } catch {
        // WebGL unavailable or context lost: fall back to the flat renderer.
        renderer = getRenderer("flat");
        setMode("flat");
      }
      const engine = engineRef.current ?? new MirrorEngine(renderer, videoRef.current, setStatus);
      engineRef.current = engine;
      engine.setRenderer(renderer);
      engine.adjustments = adjust;
      engine.showBodyModel = skeleton;
      engine.setGarment(garment?.prepared ?? null, garment?.category ?? "top");
      engine.profile = profile ?? DEFAULT_PROFILE;
      await engine.start(deviceId || undefined);
      recorderRef.current = new CanvasRecorder(engine.canvas);
      setRunning(true);
      setCameras(await MirrorEngine.listCameras());
      // First time: guide the user through body calibration for an accurate fit.
      if (!profile && !engine.calibrating) await beginCalibration();
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
    engineRef.current?.finishCalibration();
    setCalibrating(false);
    engineRef.current?.stop();
    setRunning(false);
    setStatus(null);
  };

  const capture = async () => {
    const c = engineRef.current?.canvas;
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

  const stateDot = status?.state === "tracking" ? "ok" : status?.state === "partial" || status?.state === "face-hidden" ? "" : "bad";
  const hipsMissing = calibrating && requireHips && calib?.checks.find((c) => c.id === "hips")?.ok === false && Date.now() - calibStartRef.current > 6000;
  const stateLabel: Record<string, string> = { tracking: "Tracking", partial: "Partial", "face-hidden": "Face hidden", calibrating: "Calibrating" };

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
            <canvas ref={canvas3dRef} hidden={mode !== "cloth3d"} className={mirrored ? "mirrored" : ""} aria-label="Live mirror preview (3D cloth)" />
            <canvas ref={canvas2dRef} hidden={mode !== "flat"} className={mirrored ? "mirrored" : ""} aria-label="Live mirror preview (flat)" />
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
                  <span className="hud-pill"><span className={`dot ${calibrating ? (calib?.allOk ? "ok" : "") : stateDot}`} />{calibrating ? "Calibrating" : (stateLabel[status.state] ?? "Searching")}</span>
                  <span className="hud-pill">{status.fps} fps · {status.inferenceMs} ms{recording && <> · <span className="record-dot" /> {elapsed}s / {MAX_RECORDING_SECONDS}s</>}</span>
                </div>
                {calibrating ? (
                  <div className="mirror-guide">{calib?.instruction ?? "Stand back so your face, shoulders and hips are in view."}</div>
                ) : (
                  status.state !== "tracking" && <div className="mirror-guide">{status.message}</div>
                )}
              </>
            )}
            {running && calibrating && <CalibrationOverlay progress={calib} />}
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
          {running && calibrating && (
            <section className="card stack" aria-live="polite">
              <div className="row between">
                <h3>Body calibration</h3>
                <span className="badge badge-iris">Stays on this device</span>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Line up with the outline: whole face visible, shoulders and hips in view, facing the camera, arms slightly out. Hold still for the countdown and we'll measure
                your shoulders, chest, waist and hips so clothes fit your body.
              </p>
              <CalibrationChecklist progress={calib} />
              <div className="row">
                {hipsMissing && <button className="btn btn-secondary btn-sm" onClick={calibrateWithoutHips}>My hips won't fit in view</button>}
                <button className="btn btn-ghost btn-sm" onClick={skipCalibration}>Skip (use typical proportions)</button>
              </div>
              {!requireHips && <span className="muted small">Calibrating without hips: torso length and hip width will be estimated.</span>}
            </section>
          )}
          {justCalibrated && profile && !calibrating && (
            <Notice kind="success" title="Calibrated — the garment now fits your measured body">
              {profile.measuredOutline ? "Chest, waist and hip widths were measured from your outline." : "Proportions measured; body outline estimated (try again with your arms slightly out for a closer fit)."}
            </Notice>
          )}
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
            <h3>Rendering</h3>
            <div className="row" role="radiogroup" aria-label="Rendering mode">
              <button role="radio" aria-checked={mode === "cloth3d"} className={`btn btn-sm ${mode === "cloth3d" ? "btn-primary" : "btn-secondary"}`} disabled={recording || !ClothRenderer.isSupported()} onClick={() => setMode("cloth3d")}>3D cloth</button>
              <button role="radio" aria-checked={mode === "flat"} className={`btn btn-sm ${mode === "flat" ? "btn-primary" : "btn-secondary"}`} disabled={recording} onClick={() => setMode("flat")}>Flat (fast)</button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {mode === "cloth3d"
                ? "Simulated fabric in 3D: drapes with gravity, sways as you move, and your arms and head pass in front of it."
                : "A lightweight 2D overlay for older or slower devices."}
            </p>
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
              <label className="check" style={{ alignItems: "center" }}><input type="checkbox" checked={skeleton} onChange={(e) => setSkeleton(e.target.checked)} /> Show body model</label>
            </div>
            <h3>Body profile</h3>
            <p className="muted small" style={{ margin: 0 }}>
              {profile
                ? `Calibrated ${new Date(profile.calibratedAt).toLocaleDateString()} · ${profile.measuredOutline ? "outline measured" : "outline estimated"}${profile.hipsMeasured ? "" : " · hips estimated"}`
                : "Not calibrated — using typical proportions. Calibrate for a more accurate fit."}
            </p>
            <div className="row">
              <button className="btn btn-secondary btn-sm" disabled={!running || calibrating || recording} onClick={() => void beginCalibration()}>{profile ? "Recalibrate" : "Calibrate my body"}</button>
              {profile && <button className="btn btn-ghost btn-sm" onClick={forgetProfile} disabled={calibrating}>Forget profile</button>}
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
