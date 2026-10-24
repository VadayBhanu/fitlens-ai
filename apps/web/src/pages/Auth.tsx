import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Notice } from "../components/ui";
import { ApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth";

function useNext(): string {
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/studio";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/studio";
}

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 440 }}>
      <form className="card stack" onSubmit={submit}>
        <h2>Welcome back</h2>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="muted small">New to FitLens? <Link to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></p>
      </form>
    </div>
  );
}

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [form, setForm] = useState({ email: "", password: "", displayName: "", terms: false, adult: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.terms || !form.adult) return setError("Please confirm you are 18+ and accept the terms.");
    setBusy(true);
    setError(null);
    try {
      await signUp(form.email, form.password, form.displayName || undefined);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Sign up failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <form className="card stack" onSubmit={submit}>
        <h2>Create your FitLens account</h2>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="field">
          <label htmlFor="name">Name (optional)</label>
          <input id="name" type="text" autoComplete="name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="new-password" minLength={10} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <span className="muted small">At least 10 characters.</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.adult} onChange={(e) => setForm({ ...form, adult: e.target.checked })} />
          <span>I am 18 or older.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.checked })} />
          <span>I accept the <Link to="/terms" target="_blank">Terms</Link> and have read the <Link to="/privacy" target="_blank">Privacy Policy</Link>. I will only upload photos of myself or of people who have agreed.</span>
        </label>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
        <p className="muted small">Already have an account? <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></p>
      </form>
    </div>
  );
}
