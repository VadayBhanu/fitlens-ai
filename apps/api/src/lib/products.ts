import { ErrorCode, type ProductDTO } from "@fitlens/shared";
import type { Env } from "../env";
import { ApiError } from "./http";
import { signedAssetUrl } from "./signing";

export interface ProductRow {
  id: string;
  user_id: string;
  name: string;
  brand: string | null;
  category: ProductDTO["category"];
  color: string | null;
  size: string | null;
  style_number: string | null;
  gtin: string | null;
  sku: string | null;
  description: string | null;
  image_url: string;
  product_url: string;
  retailer_domain: string;
  price_minor: number | null;
  currency: string | null;
  garment_asset_id: string | null;
  extraction_method: ProductDTO["extractionMethod"];
  extraction_confidence: number;
  created_at: string;
}

export async function getOwnedProduct(env: Env, userId: string, id: string): Promise<ProductRow> {
  const row = await env.DB.prepare("SELECT * FROM products WHERE id = ?1").bind(id).first<ProductRow>();
  if (!row || row.user_id !== userId) throw new ApiError(ErrorCode.NOT_FOUND);
  return row;
}

export async function productDto(env: Env, origin: string, r: ProductRow): Promise<ProductDTO> {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    category: r.category,
    color: r.color,
    size: r.size,
    styleNumber: r.style_number,
    gtin: r.gtin,
    imageUrl: r.image_url,
    productUrl: r.product_url,
    retailerDomain: r.retailer_domain,
    price: r.price_minor !== null && r.currency ? { amountMinor: r.price_minor, currency: r.currency } : null,
    garmentAssetId: r.garment_asset_id,
    garmentAssetUrl: r.garment_asset_id ? await signedAssetUrl(env, origin, r.garment_asset_id) : null,
    extractionMethod: r.extraction_method,
    extractionConfidence: r.extraction_confidence,
    createdAt: r.created_at
  };
}
