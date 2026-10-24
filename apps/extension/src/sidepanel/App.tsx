import { formatMoney, type DealSearchDTO, type MeDTO, type ProductDTO, type TryOnDTO, type TryOnQuality } from "@fitlens/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from "../config";
import { STORAGE, type PageStatus, type Selection } from "../messages";
import { api, ApiError, setToken } from "./api";
import { preparePhoto, type Prepared } from "./image";

type Tab = "product" | "tryon" | "deals" | "settings";

function useStorage<T>(area: "session" | "local", key: string): T | undefined {
  const [value, setValue] = useState<T | undefined>();
  useEffect(() => {
    void chrome.storage[area].get(key).then((r) => setValue(r[key] as T | undefined));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, a: string) => {
      if (a === area && key in changes) setValue(changes[key]!.newValue as T | undefined);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [area, key]);
  return value;
}

async function openWeb(path: string) {
  const { webUrl } = await getSettings();
  await chrome.tabs.create({ url: webUrl + path });
}

export function App() {
  const [tab, setTab] = useState<Tab>("product");
  const [me, setMe] = useState<MeDTO | null | undefined>(undefined);
  const selection = useStorage<Selection>("session", STORAGE.selection);
  const pageStatus = useStorage<PageStatus>("session", STORAGE.pageStatus);
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importedKey = useRef<string | null>(null);

  const loadMe = useCallback(() => api.me().then(setMe).catch(() => setMe(null)), []);
  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // Import each new selection into the user's account (normalizes + copies the garment image).
  useEffect(() => {
    if (!selection || !me) return;
    const key = selection.product.imageUrl + selection.selectedAt;
    if (importedKey.current === key) return;
    importedKey.current = key;
    setImporting(true);
    setError(null);
    setTab("product");
    api
      .extract(selection.product)
      .then((r) => {
        setProduct(r.product);
        setWarnings(r.warnings);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setImporting(false));
  }, [selection, me]);

  if (me === undefined) return <div className="pad"><div className="spinner" /></div>;

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="mark" />FitLens</div>
        {me && <button className="link" onClick={() => openWeb("/wardrobe")}>Wardrobe ↗</button>}
      </header>
      {me ? (
        <>
          <nav className="tabs" role="tablist">
            {(["product", "tryon", "deals", "settings"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {{ product: "Product", tryon: "Try on", deals: "Deals", settings: "Settings" }[t]}
              </button>
            ))}
          </nav>
          <main className="pad">
            {error && <div className="notice err" role="alert">{error}</div>}
            {tab === "product" && (
              <ProductTab selection={selection} pageStatus={pageStatus} product={product} warnings={warnings} importing={importing} onProduct={setProduct} go={setTab} />
            )}
            {tab === "tryon" && <TryOnTab product={product} me={me} setMe={setMe} />}
            {tab === "deals" && <DealsTab product={product} />}
            {tab === "settings" && <SettingsTab me={me} onSignOut={() => setMe(null)} />}
          </main>
        </>
      ) : (
        <main className="pad">
          <SignIn onSignedIn={(m) => setMe(m)} />
          <details className="mt">
            <summary className="muted">Settings</summary>
            <SettingsForm />
          </details>
        </main>
      )}
    </div>
  );
}

function ProductTab(props: {
  selection?: Selection;
  pageStatus?: PageStatus;
  product: ProductDTO | null;
  warnings: string[];
  importing: boolean;
  onProduct: (p: ProductDTO) => void;
  go: (t: Tab) => void;
}) {
  const { selection, pageStatus, product, warnings, importing } = props;
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const uploadGarment = async (f: File) => {
    if (!product) return;
    setUploading(true);
    setErr(null);
    try {
      const prepared = await preparePhoto(f, "image/png");
      const asset = await api.upload("garment", prepared.blob);
      props.onProduct(await api.setGarment(product.id, asset.id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (!selection) {
    return (
      <div className="stack">
        {pageStatus?.state === "unsupported" && <div className="notice warn">{pageStatus.message}</div>}
        <div className="empty">
          <h2>Pick a garment</h2>
          <ol className="howto">
            <li>Open a clothing product page in any store.</li>
            <li>Click the FitLens toolbar button (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>).</li>
            <li>Hover the product photo and click <b>Try on</b>. You can also right-click any image and choose <b>Try on with FitLens</b>.</li>
          </ol>
        </div>
        <button className="btn secondary" onClick={() => openWeb("/demo-store/")}>Open the demo store</button>
        <button className="btn ghost" onClick={() => openWeb("/studio")}>Upload a garment photo instead</button>
      </div>
    );
  }

  const p = selection.product;
  return (
    <div className="stack">
      <div className="card">
        <img className="hero" src={product?.garmentAssetUrl ?? p.imageUrl} alt="" />
        <div className="stack tight">
          {p.brand && <span className="eyebrow">{p.brand}</span>}
          <strong>{p.name}</strong>
          <span className="muted small">{[p.color, p.size && `Size ${p.size}`, p.price && formatMoney(p.price)].filter(Boolean).join(" · ")}</span>
          <span className="muted small">{p.retailerDomain} · {p.extractionMethod === "json-ld" ? "Read from the store's product data" : p.extractionMethod === "open-graph" ? "Read from page metadata" : "Estimated from nearby text — check the details"}</span>
          {(p.gtin || p.styleNumber) && <span className="muted small">{p.styleNumber && `Style ${p.styleNumber}`}{p.gtin && ` · GTIN ${p.gtin}`}</span>}
        </div>
      </div>
      {importing && <div className="row"><div className="spinner" /><span className="muted">Importing product…</span></div>}
      {warnings.map((w) => <div key={w} className="notice warn">{w}</div>)}
      {err && <div className="notice err">{err}</div>}
      {product && !product.garmentAssetId && (
        <label className="btn secondary">
          {uploading ? "Uploading…" : "Upload the garment photo"}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadGarment(e.target.files[0])} />
        </label>
      )}
      {product && (
        <div className="stack tight">
          <button className="btn primary" disabled={!product.garmentAssetId} onClick={() => props.go("tryon")}>Try it on</button>
          <button className="btn secondary" onClick={() => openWeb(`/mirror?product=${product.id}`)}>Live Mirror ↗</button>
          <button className="btn secondary" onClick={() => props.go("deals")}>Compare prices</button>
        </div>
      )}
    </div>
  );
}

const QUALITIES: { id: TryOnQuality; label: string }[] = [
  { id: "fast", label: "Quick" },
  { id: "balanced", label: "Balanced" },
  { id: "premium", label: "HD" }
];

function TryOnTab({ product, me, setMe }: { product: ProductDTO | null; me: MeDTO; setMe: (m: MeDTO) => void }) {
  const [photo, setPhoto] = useState<Prepared | null>(null);
  const [quality, setQuality] = useState<TryOnQuality>("balanced");
  const [job, setJob] = useState<TryOnDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!product?.garmentAssetId) return <div className="empty"><p className="muted">Select a product first.</p></div>;

  const poll = async (id: string) => {
    let delay = 2500;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, delay));
      const j = await api.tryOn(id);
      setJob(j);
      if (["completed", "failed", "expired", "cancelled"].includes(j.status)) return j;
      delay = Math.min(delay * 1.3, 8000);
    }
    return null;
  };

  const generate = async () => {
    if (!photo) return;
    setErr(null);
    setSaved(false);
    try {
      setBusy("Uploading photo…");
      const asset = await api.upload("person", photo.blob);
      setBusy("Generating…");
      const created = await api.createTryOn(
        {
          personAssetId: asset.id,
          garmentAssetId: product.garmentAssetId,
          productId: product.id,
          category: product.category === "other" ? "top" : product.category,
          quality,
          inputQuality: { width: photo.stats.width, height: photo.stats.height, brightness: photo.stats.brightness, sharpness: photo.stats.sharpness }
        },
        crypto.randomUUID()
      );
      setJob(created);
      const final = await poll(created.id);
      if (final && final.status !== "completed") setErr(final.error?.message ?? "The try-on didn't complete.");
      void api.me().then(setMe).catch(() => undefined);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      {!me.consents.cloud_tryon ? (
        <div className="notice">
          To create a try-on, your photo and the garment image are sent to FitLens's try-on provider (FASHN AI). Results are saved privately to your account. You can withdraw this anytime.
          <button className="btn primary mt" onClick={() => api.consent(true).then(setMe).catch((e: Error) => setErr(e.message))}>I agree</button>
        </div>
      ) : null}
      <span className="muted small">{Math.max(me.usage.dailyTryOnLimit - me.usage.tryOnsToday, 0)} try-ons left today</span>
      {!photo ? (
        <div className="stack tight">
          <label className="drop">
            <strong>Add a photo of yourself</strong>
            <span className="muted small">Front-facing, upper body visible, good light</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  setPhoto(await preparePhoto(f));
                } catch (x) {
                  setErr((x as Error).message);
                }
              }}
            />
          </label>
          <button className="btn ghost" onClick={() => openWeb(`/studio?product=${product.id}`)}>Use my camera instead ↗</button>
        </div>
      ) : (
        <div className="row top">
          <img className="thumb" src={photo.url} alt="Your photo" />
          <div className="stack tight">
            {photo.assessment.blocking.map((b) => <div key={b} className="notice err small">{b}</div>)}
            {photo.assessment.warnings.map((w) => <div key={w} className="notice warn small">{w}</div>)}
            {photo.assessment.ok && !photo.assessment.warnings.length && <span className="ok small">✓ Photo looks good</span>}
            <button className="link" onClick={() => { setPhoto(null); setJob(null); }}>Choose another photo</button>
          </div>
        </div>
      )}
      <div className="seg" role="radiogroup" aria-label="Quality">
        {QUALITIES.map((q) => <button key={q.id} role="radio" aria-checked={quality === q.id} className={quality === q.id ? "on" : ""} onClick={() => setQuality(q.id)}>{q.label}</button>)}
      </div>
      <button className="btn primary" disabled={!photo?.assessment.ok || !me.consents.cloud_tryon || !!busy} onClick={generate}>{busy ?? "Generate try-on"}</button>
      {err && <div className="notice err">{err}{job?.error?.retryable && <button className="link" onClick={() => api.retry(job.id).then((j) => { setJob(j); return poll(j.id); }).catch((e: Error) => setErr(e.message))}> Try again</button>}</div>}
      {job?.status === "completed" && job.result && (
        <div className="stack">
          <img className="result" src={job.result.url} alt="Try-on result" />
          {job.warnings.map((w) => <div key={w} className="notice warn small">{w}</div>)}
          <div className="row">
            <button className="btn primary" disabled={saved} onClick={() => api.save({ kind: "tryon", mediaAssetId: job.result!.assetId, productId: product.id, tryOnId: job.id }).then(() => setSaved(true)).catch((e: Error) => setErr(e.message))}>
              {saved ? "Saved ✓" : "Save"}
            </button>
            <a className="btn secondary" href={job.result.url} download={`fitlens-${job.id}.png`} target="_blank" rel="noreferrer">Download</a>
          </div>
        </div>
      )}
    </div>
  );
}

function DealsTab({ product }: { product: ProductDTO | null }) {
  const [deals, setDeals] = useState<DealSearchDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!product) return;
    setDeals(null);
    api.deals(product.id).then(setDeals).catch((e: Error) => setErr(e.message));
  }, [product]);
  if (!product) return <div className="empty"><p className="muted">Select a product first.</p></div>;
  if (err) return <div className="notice err">{err}</div>;
  if (!deals) return <div className="row"><div className="spinner" /><span className="muted">Comparing retailers…</span></div>;
  const rec = deals.exact.find((o) => o.id === deals.recommendation?.offerId);
  return (
    <div className="stack">
      {rec ? (
        <div className="notice ok-bg">
          <strong>Best verified offer: {rec.retailer} — {formatMoney(rec.total)}</strong>
          <ul>{deals.recommendation!.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      ) : (
        <div className="notice">No offers could be verified as this exact product and variant.</div>
      )}
      {deals.exact.map((o) => (
        <a key={o.id} className="offer" href={o.productUrl} target="_blank" rel="noopener noreferrer nofollow">
          <div>
            <strong>{o.retailer}</strong> {o.source.isDemoData && <span className="tag warn">Demo</span>}
            <div className="muted small">{[o.size && `Size ${o.size}`, o.shipping ? (o.shipping.amountMinor ? `+${formatMoney(o.shipping)} ship` : "Free shipping") : "Shipping not listed"].filter(Boolean).join(" · ")}</div>
          </div>
          <strong>{formatMoney(o.total)}</strong>
        </a>
      ))}
      {deals.similar.length > 0 && <span className="muted small">{deals.similar.length} similar (unverified) items</span>}
      {deals.missingInformation.slice(0, 2).map((m) => <span key={m} className="muted small">• {m}</span>)}
      <button className="btn secondary" onClick={() => openWeb(`/deals/${product.id}`)}>Full comparison & reviews ↗</button>
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (m: MeDTO) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.login(email, password);
      await setToken(r.token);
      onSignedIn(r.user);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <h2>Sign in to FitLens</h2>
      <p className="muted small">Try clothes on from any store and compare verified prices.</p>
      {err && <div className="notice err">{err}</div>}
      <label className="field">Email<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field">Password<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <button type="button" className="btn ghost" onClick={() => openWeb("/signup")}>Create an account ↗</button>
    </form>
  );
}

function SettingsTab({ me, onSignOut }: { me: MeDTO; onSignOut: () => void }) {
  return (
    <div className="stack">
      <div className="card col">
        <strong>{me.displayName ?? me.email}</strong>
        <span className="muted small">{me.email}</span>
        <div className="row mt">
          <button className="btn secondary" onClick={() => openWeb("/account")}>Privacy & account ↗</button>
          <button className="btn ghost" onClick={async () => { await api.logout().catch(() => undefined); await setToken(null); onSignOut(); }}>Sign out</button>
        </div>
      </div>
      <SettingsForm />
      <p className="muted small">FitLens only reads a page after you click its button on that tab. It never reads pages in the background.</p>
    </div>
  );
}

function SettingsForm() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void getSettings().then(setS);
  }, []);
  return (
    <form className="stack tight mt" onSubmit={async (e) => { e.preventDefault(); await saveSettings(s); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
      <label className="field">API URL<input type="url" value={s.apiUrl} onChange={(e) => setS({ ...s, apiUrl: e.target.value })} /></label>
      <label className="field">Web app URL<input type="url" value={s.webUrl} onChange={(e) => setS({ ...s, webUrl: e.target.value })} /></label>
      <button className="btn secondary">{saved ? "Saved ✓" : "Save settings"}</button>
    </form>
  );
}
