import { z } from "zod";

/**
 * Runtime-validated contracts shared by the extension, web studio and API.
 * TypeScript types disappear at runtime, so every boundary parses with these.
 */

export const GarmentCategory = z.enum(["top", "outerwear", "bottom", "dress", "other"]);
export type GarmentCategory = z.infer<typeof GarmentCategory>;

export const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "ISO 4217 currency code expected");

export const Money = z.object({
  amountMinor: z.number().int().nonnegative().max(100_000_000),
  currency: Currency
});
export type Money = z.infer<typeof Money>;

const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const HttpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((u) => u.startsWith("https://") || u.startsWith("http://"), "http(s) URL expected");

export const ExtractionMethod = z.enum(["json-ld", "site-adapter", "open-graph", "nearby-text", "user-upload"]);
export type ExtractionMethod = z.infer<typeof ExtractionMethod>;

/** What the extension sends when the shopper selects a garment on a page. */
export const SelectedProductInput = z.object({
  name: shortText(300),
  brand: optionalText(120),
  category: GarmentCategory.default("other"),
  color: optionalText(60),
  size: optionalText(30),
  styleNumber: optionalText(80),
  gtin: optionalText(14),
  sku: optionalText(80),
  description: optionalText(2000),
  imageUrl: HttpsUrl,
  productUrl: HttpsUrl,
  retailerDomain: shortText(253),
  price: Money.optional(),
  extractionMethod: ExtractionMethod,
  extractionConfidence: z.number().min(0).max(1)
});
export type SelectedProductInput = z.infer<typeof SelectedProductInput>;

export interface ProductDTO {
  id: string;
  name: string;
  brand: string | null;
  category: GarmentCategory;
  color: string | null;
  size: string | null;
  styleNumber: string | null;
  gtin: string | null;
  imageUrl: string;
  productUrl: string;
  retailerDomain: string;
  price: Money | null;
  garmentAssetId: string | null;
  garmentAssetUrl: string | null;
  extractionMethod: ExtractionMethod;
  extractionConfidence: number;
  createdAt: string;
}

export const AssetPurpose = z.enum(["person", "garment", "capture", "recording", "reel"]);
export type AssetPurpose = z.infer<typeof AssetPurpose>;

export interface AssetDTO {
  id: string;
  purpose: AssetPurpose;
  mimeType: string;
  bytes: number;
  url: string;
  expiresAt: string | null;
  createdAt: string;
}

export const InputQuality = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  brightness: z.number().min(0).max(255),
  sharpness: z.number().min(0),
  personDetected: z.boolean().optional(),
  peopleCount: z.number().int().min(0).optional()
});
export type InputQuality = z.infer<typeof InputQuality>;

export const TryOnQuality = z.enum(["fast", "balanced", "premium"]);
export type TryOnQuality = z.infer<typeof TryOnQuality>;

export const CreateTryOnInput = z.object({
  personAssetId: z.string().min(1).max(64),
  garmentAssetId: z.string().min(1).max(64),
  productId: z.string().min(1).max(64).optional(),
  quality: TryOnQuality.default("balanced"),
  category: GarmentCategory.default("top"),
  inputQuality: InputQuality.optional()
});
export type CreateTryOnInput = z.infer<typeof CreateTryOnInput>;

export const TryOnStatus = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "expired"
]);
export type TryOnStatus = z.infer<typeof TryOnStatus>;

export const TERMINAL_TRYON_STATUSES: readonly TryOnStatus[] = ["completed", "failed", "cancelled", "expired"];

export interface TryOnDTO {
  id: string;
  status: TryOnStatus;
  quality: TryOnQuality;
  category: GarmentCategory;
  productId: string | null;
  personAssetId: string;
  garmentAssetId: string;
  result: { mediaId: string; assetId: string; url: string } | null;
  warnings: string[];
  error: { code: string; message: string; retryable: boolean } | null;
  createdAt: string;
  updatedAt: string;
}

export const MatchStatus = z.enum(["exact", "similar", "mismatch"]);
export type MatchStatus = z.infer<typeof MatchStatus>;

export interface OfferDTO {
  id: string;
  retailer: string;
  retailerDomain: string;
  title: string;
  productUrl: string;
  imageUrl: string | null;
  price: Money;
  shipping: Money | null;
  total: Money;
  available: boolean | null;
  color: string | null;
  size: string | null;
  returnPolicy: string | null;
  match: { status: MatchStatus; score: number; evidence: string[] };
  source: { provider: string; isDemoData: boolean };
  checkedAt: string;
}

export interface DealSearchDTO {
  productId: string;
  exact: OfferDTO[];
  similar: OfferDTO[];
  recommendation: { offerId: string; reasons: string[] } | null;
  missingInformation: string[];
  providers: { name: string; status: "ok" | "unavailable" | "not_configured"; message?: string }[];
  checkedAt: string;
}

export interface ReviewDTO {
  id: string;
  rating: number;
  title: string | null;
  text: string;
  author: string | null;
  sourceUrl: string | null;
  retailer: string | null;
  publishedAt: string | null;
  isDemo: boolean;
}

export interface ReviewsDTO {
  productId: string;
  reviews: ReviewDTO[];
  averageRating: number | null;
  count: number;
  summary: { text: string; sourceIds: string[]; generatedAt: string; model: string } | null;
  status: "ok" | "unavailable";
  message?: string;
}

export const CreateWardrobeItemInput = z.object({
  productId: z.string().min(1).max(64).optional(),
  mediaAssetId: z.string().min(1).max(64).optional(),
  tryOnId: z.string().min(1).max(64).optional(),
  kind: z.enum(["tryon", "capture", "recording", "reel", "product"]),
  note: optionalText(500)
}).refine((v) => v.productId || v.mediaAssetId, "productId or mediaAssetId is required");
export type CreateWardrobeItemInput = z.infer<typeof CreateWardrobeItemInput>;

export interface WardrobeItemDTO {
  id: string;
  kind: "tryon" | "capture" | "recording" | "reel" | "product";
  note: string | null;
  product: Pick<ProductDTO, "id" | "name" | "brand" | "imageUrl" | "productUrl" | "retailerDomain" | "price"> | null;
  media: { assetId: string; url: string; mimeType: string } | null;
  createdAt: string;
}

export const SignUpInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  displayName: optionalText(80),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the terms" }) }),
  confirmAdult: z.literal(true, { errorMap: () => ({ message: "FitLens is available to adults (18+) only" }) })
});
export type SignUpInput = z.infer<typeof SignUpInput>;

export const LogInInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200)
});
export type LogInInput = z.infer<typeof LogInInput>;

export const ConsentPurpose = z.enum(["cloud_tryon", "product_analytics"]);
export type ConsentPurpose = z.infer<typeof ConsentPurpose>;

export const CONSENT_POLICY_VERSION = "2026-10-01";

export interface MeDTO {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  consents: Record<ConsentPurpose, boolean>;
  usage: { tryOnsToday: number; dailyTryOnLimit: number };
}

export interface AuthDTO {
  token: string;
  expiresAt: string;
  user: MeDTO;
}
