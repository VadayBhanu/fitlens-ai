import { providerCategory, type GarmentCategory, type TryOnQuality } from "@fitlens/shared";
import type { Env } from "../env";

/**
 * Virtual try-on provider adapter. Each provider maps its own request schema
 * and status vocabulary onto this interface so the rest of the system never
 * depends on a specific vendor.
 */
export interface TryOnSubmit {
  /** An https URL or a data: URL the provider can read. */
  personImage: string;
  garmentImage: string;
  quality: TryOnQuality;
  category: GarmentCategory;
}

export type ProviderJobState =
  | { state: "queued" | "running" }
  | { state: "done"; outputUrl: string }
  | { state: "failed"; message: string; retryable: boolean };

export class ProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly notConfigured = false) {
    super(message);
  }
}

export interface VirtualTryOnProvider {
  readonly name: string;
  readonly configured: boolean;
  /** Approximate provider credits consumed per completed job (for usage metering). */
  creditsFor(quality: TryOnQuality): number;
  createJob(input: TryOnSubmit): Promise<{ providerJobId: string }>;
  getJob(providerJobId: string): Promise<ProviderJobState>;
}

const FASHN_BASE = "https://api.fashn.ai/v1";

/**
 * FASHN virtual try-on (https://fashn.ai). Uses POST /v1/run + GET /v1/status/:id.
 * - fast     → tryon-v1.6, mode "performance"
 * - balanced → tryon-v1.6, mode "balanced"
 * - premium  → tryon-v1.6, mode "quality" (or FASHN_PREMIUM_MODEL=tryon-max)
 */
export class FashnProvider implements VirtualTryOnProvider {
  readonly name = "fashn";
  constructor(
    private readonly apiKey: string | undefined,
    private readonly premiumModel = "tryon-v1.6",
    private readonly baseUrl = FASHN_BASE
  ) {}

  get configured(): boolean {
    return !!this.apiKey;
  }

  creditsFor(quality: TryOnQuality): number {
    if (quality === "premium" && this.premiumModel === "tryon-max") return 4;
    return 1;
  }

  private async call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!this.apiKey) throw new ProviderError("FASHN_API_KEY is not configured.", false, true);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(25_000)
      });
    } catch (e) {
      throw new ProviderError(`Network error contacting FASHN: ${(e as Error).message}`, true);
    }
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      const msg = errorMessage(body.error) ?? (typeof body.message === "string" ? body.message : `HTTP ${res.status}`);
      if (res.status === 401 || res.status === 403) throw new ProviderError(`FASHN rejected the API key: ${msg}`, false, true);
      throw new ProviderError(`FASHN error: ${msg}`, res.status === 429 || res.status >= 500);
    }
    return body;
  }

  async createJob(input: TryOnSubmit): Promise<{ providerJobId: string }> {
    const useMax = input.quality === "premium" && this.premiumModel === "tryon-max";
    const body = useMax
      ? { model_name: "tryon-max", inputs: { model_image: input.personImage, product_image: input.garmentImage } }
      : {
          model_name: "tryon-v1.6",
          inputs: {
            model_image: input.personImage,
            garment_image: input.garmentImage,
            category: providerCategory(input.category),
            mode: input.quality === "fast" ? "performance" : input.quality === "premium" ? "quality" : "balanced",
            garment_photo_type: "auto",
            moderation_level: "conservative",
            num_samples: 1,
            output_format: "png"
          }
        };
    const res = await this.call("/run", { method: "POST", body: JSON.stringify(body) });
    const err = errorMessage(res.error);
    if (err) throw new ProviderError(err, false);
    if (typeof res.id !== "string") throw new ProviderError("FASHN did not return a prediction id.", true);
    return { providerJobId: res.id };
  }

  async getJob(id: string): Promise<ProviderJobState> {
    const res = await this.call(`/status/${encodeURIComponent(id)}`, { method: "GET" });
    switch (res.status) {
      case "starting":
      case "in_queue":
        return { state: "queued" };
      case "processing":
        return { state: "running" };
      case "completed": {
        const out = Array.isArray(res.output) ? res.output.find((o) => typeof o === "string") : undefined;
        if (!out) return { state: "failed", message: "Provider completed without an output image.", retryable: true };
        return { state: "done", outputUrl: out as string };
      }
      case "failed":
      case "canceled":
      case "time_out":
        return { state: "failed", message: errorMessage(res.error) ?? `Provider status: ${String(res.status)}`, retryable: res.status === "time_out" };
      default:
        return { state: "running" };
    }
  }
}

function errorMessage(e: unknown): string | undefined {
  if (!e) return undefined;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    const message = typeof o.message === "string" ? o.message : "";
    return [name, message].filter(Boolean).join(": ") || undefined;
  }
  return undefined;
}

export function tryOnProvider(env: Env): VirtualTryOnProvider {
  // Additional providers (self-hosted IDM-VTON, etc.) plug in here.
  const baseUrl = env.ENVIRONMENT === "development" && env.FASHN_BASE_URL ? env.FASHN_BASE_URL : FASHN_BASE;
  return new FashnProvider(env.FASHN_API_KEY, env.FASHN_PREMIUM_MODEL || "tryon-v1.6", baseUrl);
}
