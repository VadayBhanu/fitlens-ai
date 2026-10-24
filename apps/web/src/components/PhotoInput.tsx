import { useEffect, useRef, useState } from "react";

/**
 * Pick a photo from disk (drag/drop or browse) or take one with the camera.
 * The camera only starts after an explicit click and stops as soon as the
 * photo is taken or the dialog closes.
 */
export function PhotoInput({ onFile, label, allowCamera = true }: { onFile: (f: File) => void; label: string; allowCamera?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [camera, setCamera] = useState(false);

  return (
    <div className="stack">
      <div
        className={`dropzone${drag ? " drag" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        <strong>{label}</strong>
        <div className="muted small">Drag & drop, or click to browse · JPEG, PNG or WebP</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {allowCamera && !camera && (
        <button type="button" className="btn btn-secondary" onClick={() => setCamera(true)}>
          Take a photo with your camera
        </button>
      )}
      {camera && (
        <CameraCapture
          onCancel={() => setCamera(false)}
          onCapture={(f) => {
            setCamera(false);
            onFile(f);
          }}
        />
      )}
    </div>
  );
}

function CameraCapture({ onCapture, onCancel }: { onCapture: (f: File) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
      })
      .catch((e: Error) => setError(e.name === "NotAllowedError" ? "Camera permission was denied. You can upload a photo instead." : "We couldn't start your camera."));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onCapture(new File([b], "camera.jpg", { type: "image/jpeg" })), "image/jpeg", 0.92);
  };

  const timed = () => {
    let n = 3;
    setCountdown(n);
    const id = setInterval(() => {
      n -= 1;
      if (n === 0) {
        clearInterval(id);
        setCountdown(null);
        snap();
      } else setCountdown(n);
    }, 1000);
  };

  return (
    <div className="card stack">
      {error ? (
        <p className="muted">{error}</p>
      ) : (
        <div className="media-frame" style={{ aspectRatio: "16 / 9", background: "#000" }}>
          <video ref={videoRef} muted playsInline style={{ transform: "scaleX(-1)" }} />
          {countdown !== null && (
            <div className="mirror-empty" style={{ fontSize: 72, fontWeight: 800, color: "#fff" }} aria-live="assertive">{countdown}</div>
          )}
        </div>
      )}
      <div className="row">
        {!error && <button type="button" className="btn btn-primary" onClick={snap}>Capture</button>}
        {!error && <button type="button" className="btn btn-secondary" onClick={timed}>3-second timer</button>}
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
      <p className="muted small">Stand facing the camera with your upper body visible, in even lighting.</p>
    </div>
  );
}
