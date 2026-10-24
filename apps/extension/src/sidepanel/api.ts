import {
  USER_FACING_ERRORS,
  type ApiErrorBody,
  type AssetDTO,
  type AuthDTO,
  type DealSearchDTO,
  type MeDTO,
  type ProductDTO,
  type SelectedProductInput,
  type TryOnDTO
} from "@fitlens/shared";
import { getSettings } from "../config";
import { STORAGE } from "../messages";

export async function getToken(): Promise<string | null> {
  const r = await chrome.storage.local.get(STORAGE.token);
  return (r[STORAGE.token] as string | undefined) ?? null;
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await chrome.storage.local.set({ [STORAGE.token]: token });
  else await chrome.storage.local.remove(STORAGE.token);
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryable = false) {
    super(message);
  }
}

async function request<T>(method: string, path: string, opts: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const { apiUrl } = await getSettings();
  const token = await getToken();
  const headers: Record<string, string> = { "X-FitLens-Client": "extension", ...opts.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(apiUrl + path, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach FitLens. Check your connection or the API URL in Settings.", true);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    if (res.status === 401) await setToken(null);
    throw new ApiError(res.status, e?.code ?? "INTERNAL", e?.message ?? USER_FACING_ERRORS.INTERNAL, e?.retryable ?? false);
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) => request<AuthDTO>("POST", "/v1/auth/login", { json: { email, password } }),
  logout: () => request<void>("POST", "/v1/auth/logout"),
  me: () => request<MeDTO>("GET", "/v1/auth/me"),
  consent: (granted: boolean) => request<MeDTO>("POST", "/v1/auth/consents", { json: { purpose: "cloud_tryon", granted } }),
  extract: (p: SelectedProductInput) => request<{ product: ProductDTO; warnings: string[] }>("POST", "/v1/products/extract", { json: p }),
  upload: (purpose: "person" | "garment", blob: Blob) => request<AssetDTO>("POST", `/v1/assets?purpose=${purpose}`, { body: blob, headers: { "Content-Type": blob.type } }),
  setGarment: (productId: string, assetId: string) => request<ProductDTO>("PUT", `/v1/products/${productId}/garment`, { json: { assetId } }),
  createTryOn: (body: Record<string, unknown>, key: string) => request<TryOnDTO>("POST", "/v1/tryons", { json: body, headers: { "Idempotency-Key": key } }),
  tryOn: (id: string) => request<TryOnDTO>("GET", `/v1/tryons/${id}`),
  retry: (id: string) => request<TryOnDTO>("POST", `/v1/tryons/${id}/retry`),
  deals: (productId: string) => request<DealSearchDTO>("POST", `/v1/products/${productId}/deals`),
  save: (body: Record<string, unknown>) => request<{ id: string }>("POST", "/v1/wardrobe", { json: body })
};
