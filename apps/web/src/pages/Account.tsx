import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Notice } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { downloadBlob } from "../lib/image";

export default function Account() {
  const { user, setUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const toggleConsent = async (granted: boolean) => {
    const previous = user;
    // Optimistic: reflect the choice immediately, roll back if the server refuses.
    setUser({ ...user, consents: { ...user.consents, cloud_tryon: granted } });
    try {
      setUser(await api.setConsent("cloud_tryon", granted));
    } catch (e) {
      setUser(previous);
      setError((e as Error).message);
    }
  };

  const exportData = async () => {
    try {
      downloadBlob(await api.exportData(), "fitlens-data-export.json");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    try {
      await api.deleteAccount();
      // Leave the protected page before clearing the session so we land on the home page.
      navigate("/", { replace: true });
      await signOut();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="container stack" style={{ gap: 24, maxWidth: 820 }}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Account</span>
        <h2>{user.displayName ?? user.email}</h2>
        <span className="muted small">{user.email} · member since {new Date(user.createdAt).toLocaleDateString()}</span>
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      <section className="card stack">
        <h3>Usage</h3>
        <p className="muted" style={{ margin: 0 }}>{user.usage.tryOnsToday} of {user.usage.dailyTryOnLimit} photo try-ons used today. The allowance resets at midnight UTC.</p>
      </section>

      <section className="card stack">
        <h3>Privacy controls</h3>
        <label className="check">
          <input type="checkbox" checked={user.consents.cloud_tryon} onChange={(e) => toggleConsent(e.target.checked)} />
          <span>
            <strong>Cloud photo try-on</strong>
            <br />
            <span className="muted">Allow FitLens to send my photo and the garment image to its try-on provider (FASHN AI) when I request a try-on. Turning this off stops new try-ons; the Live Mirror keeps working because it runs on your device.</span>
          </span>
        </label>
      </section>

      <section className="card stack">
        <h3>Your data</h3>
        <div className="row">
          <button className="btn btn-secondary" onClick={exportData}>Export my data (JSON)</button>
          <button className="btn btn-ghost" onClick={() => { navigate("/", { replace: true }); void signOut(); }}>Sign out</button>
        </div>
      </section>

      <section className="card stack" style={{ borderColor: "color-mix(in srgb, var(--danger) 40%, var(--border))" }}>
        <h3>Delete account</h3>
        <p className="muted" style={{ margin: 0 }}>This permanently deletes your account, photos, try-ons, recordings, reels and wardrobe. It can't be undone.</p>
        <div className="field">
          <label htmlFor="confirm">Type DELETE to confirm</label>
          <input id="confirm" type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </div>
        <div><button className="btn btn-danger" disabled={confirmText !== "DELETE" || busy} onClick={deleteAccount}>{busy ? "Deleting…" : "Permanently delete my account"}</button></div>
      </section>
    </div>
  );
}
