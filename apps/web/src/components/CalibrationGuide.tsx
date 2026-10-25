import type { CalibrationProgress } from "@fitlens/shared";

/** Outline the user lines up with (symmetric, so it reads the same mirrored or not). */
export function CalibrationOverlay({ progress }: { progress: CalibrationProgress | null }) {
  const ok = !!progress?.allOk;
  const color = ok ? "#19A889" : "rgba(246,244,255,0.85)";
  return (
    <div className="calib-overlay" aria-hidden="true">
      <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet">
        <g fill="none" stroke={color} strokeWidth="0.7" strokeDasharray={ok ? "0" : "2 1.4"} strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="80" cy="17" rx="5.2" ry="6.6" />
          <path d="M77.5 23.5 L77.5 26 M82.5 23.5 L82.5 26" />
          <path d="M72 28 Q80 26 88 28" />
          <path d="M72 28 L66.5 44 L64 55 M88 28 L93.5 44 L96 55" />
          <path d="M72.5 29 Q71 40 72.5 49 L74 56 L86 56 L87.5 49 Q89 40 87.5 29" />
          <path d="M74 56 L73.5 72 M86 56 L86.5 72" />
        </g>
      </svg>
      {progress && progress.progress > 0 && (
        <div className="calib-ring" style={{ ["--p" as string]: `${Math.round(progress.progress * 100)}%` }}>
          {Math.max(1, Math.ceil((1 - progress.progress) * 3))}
        </div>
      )}
    </div>
  );
}

export function CalibrationChecklist({ progress }: { progress: CalibrationProgress | null }) {
  if (!progress) return <p className="muted small" style={{ margin: 0 }}>Looking for you…</p>;
  return (
    <ul className="calib-list">
      {progress.checks.map((c) => (
        <li key={c.id} className={c.ok ? "ok" : ""}>
          <span aria-hidden="true">{c.ok ? "✓" : "○"}</span> {c.label}
          <span className="sr-only">{c.ok ? "done" : "not yet"}</span>
        </li>
      ))}
    </ul>
  );
}
