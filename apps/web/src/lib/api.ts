import {
  USER_FACING_ERRORS,
  type ApiErrorBody,
  type AssetDTO,
  type AssetPurpose,
  type AuthDTO,
  type ConsentPurpose,
  type CreateTryOnInput,
  type CreateWardrobeItemInput,
  type DealSearchDTO,
  type ErrorCode,
  type MeDTO,
  type ProductDTO,
  type ReviewsDTO,
  type SelectedProductInput,
  type TryOnDTO,
  type WardrobeItemDTO
} from "@fitlens/shared";
import { API_URL } from "./config";

const TOKEN_KEY = "fitlens.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — session lasts for this tab only */
  }
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | "NETWORK",
    message: string,
    public readonly retryable = false
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, opts: { json?: unknown; body?: BodyInit; headers?: Record<string, string>; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-FitLens-Client": "web", ...opts.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Can't reach FitLens right now. Check your connection and try again.", true);
  }
  if (res.status === 204) return undefined as T;
  if (opts.raw && res.ok) return (await res.blob()) as T;
  const data = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401) setToken(null);
    throw new ApiRequestError(res.status, err?.code ?? "INTERNAL", err?.message ?? USER_FACING_ERRORS.INTERNAL, err?.retryable ?? res.status >= 500);
  }
  return data as T;
}

export const api = {
  health: () => request<{ status: string; services: Record<string, unknown> }>("GET", "/v1/health"),
  signup: (body: { email: string; password: string; displayName?: string; acceptTerms: true; confirmAdult: true }) => request<AuthDTO>("POST", "/v1/auth/signup", { json: body }),
  login: (body: { email: string; password: string }) => request<AuthDTO>("POST", "/v1/auth/login", { json: body }),
  logout: () => request<void>("POST", "/v1/auth/logout"),
  me: () => request<MeDTO>("GET", "/v1/auth/me"),
  setConsent: (purpose: ConsentPurpose, granted: boolean) => request<MeDTO>("POST", "/v1/auth/consents", { json: { purpose, granted } }),

  upload: (purpose: AssetPurpose, blob: Blob, keep = false) =>
    request<AssetDTO>("POST", `/v1/assets?purpose=${purpose}${keep ? "&keep=1" : ""}`, { body: blob, headers: { "Content-Type": blob.type || "application/octet-stream" } }),
  asset: (id: string) => request<AssetDTO>("GET", `/v1/assets/${id}`),
  keepAsset: (id: string) => request<AssetDTO>("POST", `/v1/assets/${id}/keep`),
  deleteAsset: (id: string) => request<void>("DELETE", `/v1/assets/${id}`),

  extractProduct: (p: SelectedProductInput) => request<{ product: ProductDTO; warnings: string[] }>("POST", "/v1/products/extract", { json: p }),
  products: () => request<{ products: ProductDTO[] }>("GET", "/v1/products"),
  product: (id: string) => request<ProductDTO>("GET", `/v1/products/${id}`),
  setGarment: (id: string, assetId: string) => request<ProductDTO>("PUT", `/v1/products/${id}/garment`, { json: { assetId } }),
  deals: (id: string) => request<DealSearchDTO>("POST", `/v1/products/${id}/deals`),
  reviews: (id: string) => request<ReviewsDTO>("GET", `/v1/products/${id}/reviews`),

  createTryOn: (input: Partial<CreateTryOnInput> & Pick<CreateTryOnInput, "personAssetId" | "garmentAssetId">, idempotencyKey: string) =>
    request<TryOnDTO>("POST", "/v1/tryons", { json: input, headers: { "Idempotency-Key": idempotencyKey } }),
  tryOn: (id: string) => request<TryOnDTO>("GET", `/v1/tryons/${id}`),
  tryOns: () => request<{ tryOns: TryOnDTO[] }>("GET", "/v1/tryons"),
  retryTryOn: (id: string) => request<TryOnDTO>("POST", `/v1/tryons/${id}/retry`),
  cancelTryOn: (id: string) => request<TryOnDTO>("POST", `/v1/tryons/${id}/cancel`),

  wardrobe: () => request<{ items: WardrobeItemDTO[] }>("GET", "/v1/wardrobe"),
  addToWardrobe: (input: CreateWardrobeItemInput) => request<{ id: string }>("POST", "/v1/wardrobe", { json: input }),
  removeFromWardrobe: (id: string) => request<void>("DELETE", `/v1/wardrobe/${id}`),

  exportData: () => request<Blob>("GET", "/v1/account/export", { raw: true }),
  deleteAccount: () => request<void>("DELETE", "/v1/account")
};

/** Poll a try-on job until it reaches a terminal state, with backoff. */
export async function waitForTryOn(id: string, onUpdate: (j: TryOnDTO) => void, signal?: AbortSignal): Promise<TryOnDTO> {
  let delay = 2500;
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const job = await api.tryOn(id);
    onUpdate(job);
    if (["completed", "failed", "cancelled", "expired"].includes(job.status)) return job;
    if (Date.now() - started > 11 * 60_000) return job;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 8000);
  }
}
