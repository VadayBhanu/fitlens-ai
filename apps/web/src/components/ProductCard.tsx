import type { ProductDTO } from "@fitlens/shared";
import { formatMoney } from "../lib/format";

export function ProductSummary({ product, compact = false }: { product: ProductDTO; compact?: boolean }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
      <img className="thumb" src={product.garmentAssetUrl ?? product.imageUrl} alt="" style={compact ? { width: 56, height: 56 } : undefined} />
      <div style={{ minWidth: 0 }}>
        {product.brand && <div className="eyebrow" style={{ color: "var(--text-muted)" }}>{product.brand}</div>}
        <div style={{ fontWeight: 600 }}>{product.name}</div>
        <div className="muted small">
          {[product.color, product.size && `Size ${product.size}`, product.price && formatMoney(product.price), product.retailerDomain].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}
