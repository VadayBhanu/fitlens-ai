export interface Env {
  DB: D1Database;
  ASSETS?: R2Bucket;
  ASSETS_KV?: KVNamespace;
  AI?: Ai;

  APP_ORIGIN: string;
  ALLOWED_ORIGINS: string;
  FREE_DAILY_TRYONS: string;
  MAX_ACTIVE_TRYONS: string;
  TEMP_PHOTO_RETENTION_HOURS: string;
  PASSWORD_PBKDF2_ITERATIONS: string;
  TRYON_PROVIDER: string;
  ENVIRONMENT: string;
  PUBLIC_API_ORIGIN?: string;
  /** Development only: allow image fetches from localhost (demo store, mock provider). */
  DEV_ALLOW_PRIVATE_HOSTS?: string;
  /** Development/testing only: point the FASHN adapter at a mock server. */
  FASHN_BASE_URL?: string;

  SIGNING_SECRET?: string;
  FASHN_API_KEY?: string;
  FASHN_PREMIUM_MODEL?: string;
  SERPAPI_KEY?: string;
  ADMIN_TOKEN?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  sessionId: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser; requestId: string };
};

export function intVar(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Private-network fetches are only ever allowed in development. */
export function allowPrivateHosts(env: Env): boolean {
  return env.ENVIRONMENT === "development" && env.DEV_ALLOW_PRIVATE_HOSTS === "true";
}
