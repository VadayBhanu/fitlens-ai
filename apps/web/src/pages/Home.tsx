import { Link } from "react-router-dom";
import { EXTENSION_URL } from "../lib/config";

const features = [
  { icon: "1", title: "Pick it while you shop", body: "Click the FitLens button on a product image on any store. We read the product details the store publishes, including color, size and identifiers." },
  { icon: "2", title: "See it on you", body: "Upload or take a photo and get a photorealistic preview of the garment on your own body, made by a specialized try-on model." },
  { icon: "3", title: "Move in it", body: "The Live Mirror tracks your shoulders and arms on your device and keeps the garment aligned as you move. No video leaves your computer." },
  { icon: "4", title: "Capture and share", body: "Save photos, record short clips from the mirror, and turn your favorite looks into vertical reels." },
  { icon: "5", title: "Compare before you pay", body: "We only call an offer an exact match when the barcode or style number and the variant match. Lookalikes are labeled as lookalikes." },
  { icon: "6", title: "Private by default", body: "Source photos are deleted after 24 hours unless you keep them. You can export or delete everything at any time." }
];

export function Home() {
  return (
    <div className="container stack" style={{ gap: 56 }}>
      <section className="hero">
        <div className="stack" style={{ gap: 20 }}>
          <span className="eyebrow">Virtual fitting room · Smart shopping</span>
          <h1>Try it on before you buy it.</h1>
          <p className="lead">
            FitLens shows clothes from your favorite stores on you, lets you move in them with a live mirror, and finds the best verified price for the exact same item.
          </p>
          <div className="row">
            <Link to="/studio" className="btn btn-primary">Open Try-On Studio</Link>
            <Link to="/mirror" className="btn btn-secondary">Try the Live Mirror</Link>
          </div>
          <p className="muted small">
            {EXTENSION_URL ? <a href={EXTENSION_URL}>Add the Chrome extension</a> : "Chrome extension: load it from the repository (see the setup guide)."} ·{" "}
            <a href="/demo-store/">Explore the demo store</a>
          </p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <img src="/demo-store/img/denim-jacket-indigo.png" alt="" />
        </div>
      </section>

      <section className="stack">
        <h2>Discover it → wear it → capture it → compare → buy with confidence</h2>
        <div className="grid-3">
          {features.map((f) => (
            <div key={f.title} className="card flat stack" style={{ gap: 10 }}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p className="muted" style={{ margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Honest by design</h2>
        <div className="grid-2">
          <p className="muted" style={{ margin: 0 }}>
            AI try-on shows how a garment is likely to look. It isn't a sizing measurement. Every result comes with notes on what to double-check, and you can regenerate or delete it.
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Prices show where they came from and when they were checked. Demo data is always labeled. If we can't verify an exact match, we say so and tell you what's missing.
          </p>
        </div>
      </section>
    </div>
  );
}
