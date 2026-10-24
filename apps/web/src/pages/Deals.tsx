import type { DealSearchDTO, OfferDTO, ProductDTO, ReviewsDTO } from "@fitlens/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ProductSummary } from "../components/ProductCard";
import { Notice, Spinner, Stars } from "../components/ui";
import { api } from "../lib/api";
import { formatMoney, timeAgo } from "../lib/format";

function OfferRow({ o, recommended }: { o: OfferDTO; recommended?: boolean }) {
  return (
    <div className="offer">
      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong>{o.retailer}</strong>
          {recommended && <span className="badge badge-success">Recommended</span>}
          {o.match.status === "exact" ? <span className="badge badge-iris">Exact match</span> : <span className="badge">Similar item</span>}
          {o.source.isDemoData && <span className="badge badge-warn">Demo data</span>}
        </div>
        <span className="muted small">{o.title}</span>
        <span className="muted small">
          {[o.color, o.size && `Size ${o.size}`, o.available === true ? "In stock" : o.available === false ? "Out of stock" : "Stock unknown", o.returnPolicy].filter(Boolean).join(" · ")}
        </span>
        <details>
          <summary className="small muted" style={{ cursor: "pointer" }}>Why this match?</summary>
          <ul className="small muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {o.match.evidence.map((e) => <li key={e}>{e}</li>)}
            <li>Source: {o.source.provider} · checked {timeAgo(o.checkedAt)}</li>
          </ul>
        </details>
      </div>
      <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
        <div className="price">{formatMoney(o.total)}</div>
        <span className="muted small">{formatMoney(o.price)} + {o.shipping ? (o.shipping.amountMinor === 0 ? "free shipping" : `${formatMoney(o.shipping)} shipping`) : "shipping not listed"}</span>
        <a className="btn btn-secondary btn-sm" href={o.productUrl} target="_blank" rel="noopener noreferrer nofollow">View offer</a>
      </div>
    </div>
  );
}

export default function Deals() {
  const { productId = "" } = useParams();
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [deals, setDeals] = useState<DealSearchDTO | null>(null);
  const [reviews, setReviews] = useState<ReviewsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.product(productId), api.deals(productId), api.reviews(productId)])
      .then(([p, d, r]) => {
        setProduct(p);
        setDeals(d);
        setReviews(r);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [productId]);

  if (loading) return <div className="container"><Spinner label="Comparing offers across retailers…" /></div>;
  if (error || !product || !deals) return <div className="container"><Notice kind="error">{error ?? "Not found"}</Notice></div>;

  const recommendedId = deals.recommendation?.offerId;
  const original = product.price;
  const best = deals.exact.find((o) => o.id === recommendedId);
  const saving = best && original && best.total.currency === original.currency ? original.amountMinor - best.total.amountMinor : 0;

  return (
    <div className="container stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Deal Intelligence</span>
        <h2>Compare before you pay</h2>
      </div>
      <div className="card row between">
        <ProductSummary product={product} />
        <div className="row">
          <Link className="btn btn-secondary btn-sm" to={`/studio?product=${product.id}`}>Try it on</Link>
          <a className="btn btn-ghost btn-sm" href={product.productUrl} target="_blank" rel="noopener noreferrer">Original listing</a>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)" }}>
        <div className="stack">
          <section className="card stack">
            <div className="row between">
              <h3>Verified exact matches</h3>
              <span className="muted small">Checked {timeAgo(deals.checkedAt)}</span>
            </div>
            {deals.recommendation && best && (
              <Notice kind="success" title={saving > 0 ? `Save ${formatMoney({ amountMinor: saving, currency: best.total.currency })} at ${best.retailer}` : `Best verified offer: ${best.retailer}`}>
                <ul>{deals.recommendation.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </Notice>
            )}
            {deals.exact.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No offers could be verified as this exact product and variant.</p>
            ) : (
              <div>{deals.exact.map((o) => <OfferRow key={o.id} o={o} recommended={o.id === recommendedId} />)}</div>
            )}
          </section>

          {deals.similar.length > 0 && (
            <section className="card stack">
              <h3>Similar items</h3>
              <p className="muted small" style={{ margin: 0 }}>These look alike but couldn't be confirmed as the same product, color or size. They're never used for the recommendation.</p>
              <div>{deals.similar.map((o) => <OfferRow key={o.id} o={o} />)}</div>
            </section>
          )}
        </div>

        <div className="stack">
          {deals.missingInformation.length > 0 && (
            <Notice kind="info" title="What we couldn't verify">
              <ul>{deals.missingInformation.map((m) => <li key={m}>{m}</li>)}</ul>
            </Notice>
          )}
          <section className="card stack">
            <h3>Reviews</h3>
            {!reviews || reviews.status === "unavailable" ? (
              <p className="muted" style={{ margin: 0 }}>{reviews?.message ?? "Reviews couldn't be verified."}</p>
            ) : (
              <>
                <div className="row"><Stars rating={reviews.averageRating ?? 0} /><strong>{reviews.averageRating}</strong><span className="muted small">from {reviews.count} reviews</span></div>
                {reviews.summary && (
                  <Notice kind="info" title="AI summary of these reviews">
                    {reviews.summary.text}
                    <div className="muted small" style={{ marginTop: 6 }}>Based on {reviews.summary.sourceIds.length} reviews below · {reviews.summary.model}</div>
                  </Notice>
                )}
                {reviews.reviews.slice(0, 8).map((r) => (
                  <div key={r.id} className="stack" style={{ gap: 4, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <Stars rating={r.rating} />
                      {r.title && <strong className="small">{r.title}</strong>}
                      {r.isDemo && <span className="badge badge-warn">Demo</span>}
                    </div>
                    <span className="small">{r.text}</span>
                    <span className="muted small">
                      {[r.author, r.retailer, r.publishedAt && new Date(r.publishedAt).toLocaleDateString()].filter(Boolean).join(" · ")}
                      {r.sourceUrl && <> · <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">source</a></>}
                    </span>
                  </div>
                ))}
              </>
            )}
          </section>
          <section className="card stack">
            <h3>Data sources</h3>
            {deals.providers.map((p) => (
              <div key={p.name} className="row between small">
                <span>{p.name}</span>
                <span className={`badge ${p.status === "ok" ? "badge-success" : p.status === "unavailable" ? "badge-warn" : ""}`}>{p.status.replace("_", " ")}</span>
              </div>
            ))}
            <p className="muted small" style={{ margin: 0 }}>Totals include known shipping, not tax. Prices can change; confirm on the retailer's site.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
