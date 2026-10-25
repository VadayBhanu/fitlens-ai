import { assessPersonPhoto, inferCategory, type GarmentCategory, type ProductDTO, type QualityAssessment, type TryOnDTO, type TryOnQuality } from "@fitlens/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BeforeAfter } from "../components/BeforeAfter";
import { PhotoInput } from "../components/PhotoInput";
import { ProductSummary } from "../components/ProductCard";
import { Notice, Progress, Spinner } from "../components/ui";
import { api, ApiRequestError, waitForTryOn } from "../lib/api";
import { useAuth } from "../lib/auth";
import { newIdempotencyKey, timeAgo } from "../lib/format";
import { downloadUrl, prepareImage, type PreparedImage } from "../lib/image";
import { countPeople } from "../lib/pose";

interface Garment {
  assetId: string;
  url: string;
  category: GarmentCategory;
  product: ProductDTO | null;
}

const QUALITY: { id: TryOnQuality; label: string; hint: string }[] = [
  { id: "fast", label: "Quick", hint: "Fastest preview" },
  { id: "balanced", label: "Balanced", hint: "Recommended" },
  { id: "premium", label: "HD", hint: "Most detail, slower" }
];

export default function Studio() {
  const { user, setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const productId = params.get("product");

  const [garment, setGarment] = useState<Garment | null>(null);
  const [recent, setRecent] = useState<ProductDTO[]>([]);
  const [person, setPerson] = useState<PreparedImage | null>(null);
  const [assessment, setAssessment] = useState<QualityAssessment | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmedPerson, setConfirmedPerson] = useState(false);
  const [keepPhoto, setKeepPhoto] = useState(false);
  const [quality, setQuality] = useState<TryOnQuality>("balanced");
  const [job, setJob] = useState<TryOnDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const photoReady = !!assessment?.ok && (!assessment.personNotDetected || confirmedPerson);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    api.products().then((r) => setRecent(r.products.filter((p) => p.garmentAssetId).slice(0, 8))).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!productId) return;
    api
      .product(productId)
      .then((p) => {
        if (p.garmentAssetId && p.garmentAssetUrl) setGarment({ assetId: p.garmentAssetId, url: p.garmentAssetUrl, category: p.category === "other" ? inferCategory(p.name) : p.category, product: p });
        else setGarment(null);
        if (!p.garmentAssetId) setError("We couldn't import this product's image. Upload a photo of the garment below.");
      })
      .catch((e: ApiRequestError) => setError(e.message));
  }, [productId]);

  const chooseProduct = (p: ProductDTO) => {
    setParams({ product: p.id });
    setJob(null);
  };

  const uploadGarment = async (file: File) => {
    setError(null);
    setBusy("Uploading garment…");
    try {
      const prepared = await prepareImage(file, 2048, "image/png");
      const asset = await api.upload("garment", prepared.blob);
      if (garment?.product) await api.setGarment(garment.product.id, asset.id);
      setGarment({ assetId: asset.id, url: asset.url, category: garment?.category ?? inferCategory(file.name), product: garment?.product ?? null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const choosePerson = async (file: File) => {
    setError(null);
    setJob(null);
    setSaved(false);
    setChecking(true);
    setConfirmedPerson(false);
    try {
      const prepared = await prepareImage(file);
      setPerson(prepared);
      const people = await countPeople(prepared.bitmap);
      setAssessment(assessPersonPhoto(prepared.stats, people));
    } catch (e) {
      setError((e as Error).message);
      setPerson(null);
      setAssessment(null);
    } finally {
      setChecking(false);
    }
  };

  const grantConsent = async () => {
    try {
      setUser(await api.setConsent("cloud_tryon", true));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const generate = async (opts: { regenerate?: boolean } = {}) => {
    if (!garment || !person || !photoReady) return;
    setError(null);
    setSaved(false);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      setBusy("Uploading your photo securely…");
      const asset = await api.upload("person", person.blob, keepPhoto);
      setBusy("Starting try-on…");
      const created = await api.createTryOn(
        {
          personAssetId: asset.id,
          garmentAssetId: garment.assetId,
          productId: garment.product?.id,
          category: garment.category === "other" ? "top" : garment.category,
          quality,
          inputQuality: { width: person.stats.width, height: person.stats.height, brightness: person.stats.brightness, sharpness: person.stats.sharpness }
        },
        newIdempotencyKey()
      );
      setJob(created);
      setBusy(opts.regenerate ? "Regenerating…" : "Generating your look…");
      const final = await waitForTryOn(created.id, setJob, abortRef.current.signal);
      setJob(final);
      if (final.status !== "completed") setError(final.error?.message ?? "The try-on didn't complete.");
      void api.me().then(setUser).catch(() => undefined);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    if (!job) return;
    setError(null);
    setBusy("Retrying…");
    try {
      const r = await api.retryTryOn(job.id);
      setJob(r);
      setJob(await waitForTryOn(r.id, setJob));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!job?.result) return;
    try {
      await api.addToWardrobe({ kind: "tryon", mediaAssetId: job.result.assetId, productId: job.productId ?? undefined, tryOnId: job.id });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const consent = user?.consents.cloud_tryon ?? false;
  const usage = user?.usage;
  const step = !garment ? 1 : !person ? 2 : job?.status === "completed" ? 4 : 3;

  return (
    <div className="container stack" style={{ gap: 24 }}>
      <div className="row between">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Try-On Studio</span>
          <h2>See it on you</h2>
        </div>
        {usage && <span className="badge">{Math.max(usage.dailyTryOnLimit - usage.tryOnsToday, 0)} of {usage.dailyTryOnLimit} try-ons left today</span>}
      </div>
      <ol className="steps" aria-label="Progress">
        {["Garment", "Your photo", "Generate", "Result"].map((s, i) => (
          <li key={s} className={i + 1 === step ? "active" : i + 1 < step ? "done" : ""} aria-current={i + 1 === step ? "step" : undefined}>
            <span className="n">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid-2">
        <div className="stack">
          <section className="card stack">
            <h3>1 · Garment</h3>
            {garment ? (
              <div className="stack">
                {garment.product ? <ProductSummary product={{ ...garment.product, garmentAssetUrl: garment.url }} /> : (
                  <div className="row"><img className="thumb" src={garment.url} alt="" /><span className="muted">Uploaded garment</span></div>
                )}
                <div className="row">
                  <label className="small" htmlFor="cat">Type</label>
                  <select id="cat" value={garment.category} onChange={(e) => setGarment({ ...garment, category: e.target.value as GarmentCategory })} style={{ height: 36 }}>
                    <option value="top">Top</option>
                    <option value="outerwear">Outerwear</option>
                    <option value="bottom">Bottom</option>
                    <option value="dress">Dress / one-piece</option>
                    <option value="other">Let the AI decide</option>
                  </select>
                  {garment.product && <Link className="btn btn-ghost btn-sm" to={`/deals/${garment.product.id}`}>Compare prices</Link>}
                  <Link className="btn btn-ghost btn-sm" to={`/mirror${garment.product ? `?product=${garment.product.id}` : ""}`}>Live Mirror</Link>
                </div>
                <details>
                  <summary className="small muted" style={{ cursor: "pointer" }}>Use a different garment image</summary>
                  <div style={{ marginTop: 12 }}><PhotoInput label="Upload a garment photo" onFile={uploadGarment} allowCamera={false} /></div>
                </details>
              </div>
            ) : (
              <div className="stack">
                <p className="muted" style={{ margin: 0 }}>Select a product with the FitLens extension while shopping, pick a recent one, or upload a garment photo.</p>
                {recent.length > 0 && (
                  <div className="stack" style={{ gap: 8 }}>
                    {recent.map((p) => (
                      <button key={p.id} className="btn btn-secondary" style={{ height: "auto", padding: 10, justifyContent: "flex-start", borderRadius: 12 }} onClick={() => chooseProduct(p)}>
                        <ProductSummary product={p} compact />
                      </button>
                    ))}
                  </div>
                )}
                <PhotoInput label="Upload a garment photo" onFile={uploadGarment} allowCamera={false} />
              </div>
            )}
          </section>

          <section className="card stack">
            <h3>2 · Your photo</h3>
            {!person && <PhotoInput label="Add a photo of yourself" onFile={choosePerson} />}
            {checking && <Spinner label="Checking photo quality…" />}
            {person && (
              <div className="stack">
                <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <img className="thumb" src={person.previewUrl} alt="Your photo" style={{ width: 96, height: 128 }} />
                  <div className="stack" style={{ gap: 8 }}>
                    {assessment && assessment.ok && assessment.warnings.length === 0 && <span className="badge badge-success">✓ Photo looks good — person detected</span>}
                    {assessment && !assessment.ok && (
                      <Notice kind="error" title="Please use a different photo">
                        <ul>{assessment.blocking.map((b) => <li key={b}>{b}</li>)}</ul>
                      </Notice>
                    )}
                    {assessment && assessment.warnings.length > 0 && (
                      <Notice kind="warn"><ul>{assessment.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Notice>
                    )}
                    {assessment?.ok && assessment.personNotDetected && (
                      <label className="check">
                        <input type="checkbox" checked={confirmedPerson} onChange={(e) => setConfirmedPerson(e.target.checked)} />
                        <span>Yes, this photo shows me (face and upper body). Continue anyway.</span>
                      </label>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => { setPerson(null); setAssessment(null); setJob(null); setConfirmedPerson(false); }}>Choose another photo</button>
                  </div>
                </div>
                <label className="check">
                  <input type="checkbox" checked={keepPhoto} onChange={(e) => setKeepPhoto(e.target.checked)} />
                  <span>Keep this photo for future try-ons. Otherwise it's deleted automatically after 24 hours.</span>
                </label>
              </div>
            )}
            <p className="muted small" style={{ margin: 0 }}>Tips: face the camera, show your upper body, use even lighting, and avoid crossed arms or bags covering your torso.</p>
          </section>

          <section className="card stack">
            <h3>3 · Generate</h3>
            <div className="row" role="radiogroup" aria-label="Quality">
              {QUALITY.map((q) => (
                <button key={q.id} role="radio" aria-checked={quality === q.id} className={`btn btn-sm ${quality === q.id ? "btn-primary" : "btn-secondary"}`} onClick={() => setQuality(q.id)} title={q.hint}>
                  {q.label}
                </button>
              ))}
            </div>
            {!consent ? (
              <Notice kind="info" title="Your permission is needed">
                To create a try-on, your photo and the garment image are sent to our try-on provider (FASHN AI). The result is saved privately to your account. You can withdraw this permission any time in Account.
                <div style={{ marginTop: 10 }}><button className="btn btn-primary btn-sm" onClick={grantConsent}>I agree, continue</button></div>
              </Notice>
            ) : (
              <button className="btn btn-primary btn-block" disabled={!garment || !person || !photoReady || !!busy} onClick={() => generate()}>
                {busy ?? "Generate try-on"}
              </button>
            )}
            {busy && job && <Progress value={job.status === "processing" ? 0.6 : job.status === "queued" ? 0.25 : 1} />}
          </section>
        </div>

        <section className="card stack" aria-live="polite">
          <h3>4 · Result</h3>
          {!job && <div className="media-frame mirror-empty" style={{ position: "relative" }}><span className="muted">Your try-on will appear here.</span></div>}
          {job && job.status !== "completed" && !["failed", "expired", "cancelled"].includes(job.status) && (
            <div className="media-frame" style={{ display: "grid", placeItems: "center" }}>
              <div className="stack" style={{ alignItems: "center" }}>
                <Spinner />
                <span className="muted">Usually takes 10–40 seconds…</span>
                <button className="btn btn-ghost btn-sm" onClick={() => api.cancelTryOn(job.id).then(setJob).finally(() => abortRef.current?.abort())}>Cancel</button>
              </div>
            </div>
          )}
          {job && ["failed", "expired"].includes(job.status) && (
            <Notice kind="error" title="The try-on didn't work this time">
              {job.error?.message}
              {job.error?.retryable && <div style={{ marginTop: 10 }}><button className="btn btn-secondary btn-sm" onClick={retry} disabled={!!busy}>Try again</button></div>}
            </Notice>
          )}
          {job?.status === "completed" && job.result && person && (
            <div className="stack">
              <BeforeAfter before={person.previewUrl} after={job.result.url} />
              {job.warnings.length > 0 && (
                <Notice kind="warn" title="Check before you buy">
                  <ul>{job.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </Notice>
              )}
              <div className="row">
                <button className="btn btn-primary" onClick={save} disabled={saved}>{saved ? "Saved to wardrobe ✓" : "Save to wardrobe"}</button>
                <button className="btn btn-secondary" onClick={() => downloadUrl(job.result!.url, `fitlens-${job.id}.png`)}>Download</button>
                <button className="btn btn-ghost" onClick={() => generate({ regenerate: true })} disabled={!!busy}>Regenerate</button>
              </div>
              <span className="muted small">Generated {timeAgo(job.updatedAt)} · AI-generated preview, not a sizing measurement.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
