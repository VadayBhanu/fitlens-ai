import type { WardrobeItemDTO } from "@fitlens/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Notice, Progress, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatMoney, timeAgo } from "../lib/format";
import { downloadBlob, downloadUrl } from "../lib/image";
import { renderReel } from "../lib/reel";

export default function Wardrobe() {
  const [items, setItems] = useState<WardrobeItemDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reel, setReel] = useState<{ progress: number; blob?: Blob; url?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api.wardrobe().then((r) => setItems(r.items)).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const remove = async (item: WardrobeItemDTO) => {
    if (!confirm("Remove this look from your wardrobe? The image will be deleted.")) return;
    try {
      await api.removeFromWardrobe(item.id);
      if (item.media && item.kind !== "product") await api.deleteAsset(item.media.assetId).catch(() => undefined);
      setItems((xs) => xs?.filter((x) => x.id !== item.id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const images = (items ?? []).filter((i) => i.media?.mimeType.startsWith("image/"));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 10 ? s : [...s, id]));

  const makeReel = async () => {
    const slides = images.filter((i) => selected.includes(i.id)).map((i) => ({ imageUrl: i.media!.url, caption: i.product?.name ?? i.note ?? undefined }));
    setReel({ progress: 0 });
    try {
      const blob = await renderReel(slides, (p) => setReel((r) => ({ ...(r ?? {}), progress: p })));
      setReel({ progress: 1, blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setReel(null);
      setError((e as Error).message);
    }
  };

  const saveReel = async () => {
    if (!reel?.blob) return;
    setSaving(true);
    try {
      const asset = await api.upload("reel", reel.blob);
      await api.addToWardrobe({ kind: "reel", mediaAssetId: asset.id, note: "Fashion reel" });
      setReel(null);
      setSelected([]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container stack" style={{ gap: 24 }}>
      <div className="row between">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Digital Wardrobe</span>
          <h2>Your saved looks</h2>
        </div>
        {images.length > 0 && <span className="muted small">Select up to 10 looks to make a reel</span>}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!items && !error && <Spinner label="Loading wardrobe…" />}
      {items?.length === 0 && (
        <div className="card stack" style={{ alignItems: "flex-start" }}>
          <p className="muted" style={{ margin: 0 }}>Nothing saved yet. Try something on, or capture a look in the Live Mirror.</p>
          <div className="row"><Link className="btn btn-primary" to="/studio">Open Studio</Link><Link className="btn btn-secondary" to="/mirror">Live Mirror</Link></div>
        </div>
      )}

      {selected.length > 0 && !reel && (
        <div className="card row between">
          <span>{selected.length} look{selected.length > 1 ? "s" : ""} selected</span>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>Clear</button>
            <button className="btn btn-primary btn-sm" onClick={makeReel}>Create vertical reel</button>
          </div>
        </div>
      )}
      {reel && (
        <div className="card stack">
          <h3>Fashion reel</h3>
          {!reel.url ? (
            <>
              <span className="muted small">Rendering on your device…</span>
              <Progress value={reel.progress} />
            </>
          ) : (
            <>
              <video src={reel.url} controls playsInline style={{ maxHeight: 520, borderRadius: 12, background: "#000" }} />
              <div className="row">
                <button className="btn btn-primary" onClick={saveReel} disabled={saving}>{saving ? "Saving…" : "Save to wardrobe"}</button>
                <button className="btn btn-secondary" onClick={() => downloadBlob(reel.blob!, `fitlens-reel.${reel.blob!.type.includes("mp4") ? "mp4" : "webm"}`)}>Download</button>
                <button className="btn btn-ghost" onClick={() => setReel(null)}>Discard</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="cards">
        {items?.map((item) => (
          <article key={item.id} className="card pad-0">
            <div className="media-frame" style={{ borderRadius: 0 }}>
              {item.media?.mimeType.startsWith("video/") ? (
                <video src={item.media.url} controls playsInline preload="metadata" />
              ) : item.media ? (
                <img src={item.media.url} alt={item.product?.name ?? "Saved look"} loading="lazy" />
              ) : item.product ? (
                <img src={item.product.imageUrl} alt={item.product.name} loading="lazy" />
              ) : null}
              {item.media?.mimeType.startsWith("image/") && (
                <label className="hud-pill" style={{ position: "absolute", top: 8, left: 8, pointerEvents: "auto" }}>
                  <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} aria-label="Select for reel" />
                </label>
              )}
            </div>
            <div className="stack" style={{ padding: 14, gap: 6 }}>
              <div className="row between">
                <span className="badge">{item.kind}</span>
                <span className="muted small">{timeAgo(item.createdAt)}</span>
              </div>
              {item.product && (
                <div className="small">
                  <strong>{item.product.name}</strong>
                  <div className="muted">{[item.product.brand, item.product.price && formatMoney(item.product.price)].filter(Boolean).join(" · ")}</div>
                </div>
              )}
              {!item.product && item.note && <div className="small muted">{item.note}</div>}
              <div className="row" style={{ gap: 6 }}>
                {item.media && <button className="btn btn-ghost btn-sm" onClick={() => downloadUrl(item.media!.url, `fitlens-${item.id}.${item.media!.mimeType.split("/")[1]}`)}>Download</button>}
                {item.product && <Link className="btn btn-ghost btn-sm" to={`/deals/${item.product.id}`}>Deals</Link>}
                <button className="btn btn-ghost btn-sm" onClick={() => remove(item)}>Remove</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
