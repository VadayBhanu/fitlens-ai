import type { ReactNode } from "react";

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="muted small">{label}</span>}
    </span>
  );
}

export function Notice({ kind = "info", title, children }: { kind?: "info" | "warn" | "error" | "success"; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="stars" aria-label={`${rating} out of 5 stars`}>
      {"★★★★★".slice(0, full)}
      <span style={{ opacity: 0.3 }}>{"★★★★★".slice(full)}</span>
    </span>
  );
}

export function Logo() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0B1020" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="#6D5DF6" strokeWidth="6" />
      <circle cx="32" cy="32" r="7" fill="#BBA7FF" />
    </svg>
  );
}
