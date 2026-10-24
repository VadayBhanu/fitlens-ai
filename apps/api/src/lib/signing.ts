import type { Env } from "../env";
import { hmacHex, timingSafeEqual } from "./crypto";

/**
 * Short-lived signed media URLs. Lets <img>/<video> tags and the try-on
 * provider read a private asset without exposing a bearer token.
 */

export function signingSecret(env: Env): string {
  if (!env.SIGNING_SECRET || env.SIGNING_SECRET.length < 16) {
    throw new Error("SIGNING_SECRET is not configured (min 16 chars).");
  }
  return env.SIGNING_SECRET;
}

export function apiOrigin(env: Env, requestUrl?: string): string {
  if (env.PUBLIC_API_ORIGIN) return env.PUBLIC_API_ORIGIN.replace(/\/$/, "");
  if (requestUrl) return new URL(requestUrl).origin;
  return "";
}

export async function signedAssetUrl(env: Env, origin: string, assetId: string, ttlSeconds = 3600): Promise<string> {
  // Round expiry up to a 5-minute boundary so URLs are cacheable between polls.
  const exp = Math.ceil((Date.now() / 1000 + ttlSeconds) / 300) * 300;
  const sig = await hmacHex(signingSecret(env), `${assetId}.${exp}`);
  return `${origin}/v1/files/${assetId}?exp=${exp}&sig=${sig}`;
}

export async function verifyAssetSignature(env: Env, assetId: string, exp: string | undefined, sig: string | undefined): Promise<boolean> {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  const expected = await hmacHex(signingSecret(env), `${assetId}.${exp}`);
  return timingSafeEqual(expected, sig);
}
