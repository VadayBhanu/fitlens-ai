import { ErrorCode } from "@fitlens/shared";
import { ApiError } from "./http";
import { MAX_IMAGE_BYTES } from "./media";

/**
 * Guarded fetch for user-influenced URLs (product images). Blocks non-HTTP(S)
 * schemes, credentials in URLs, IP-literal and internal hostnames, non-standard
 * ports, unbounded redirects and oversized bodies.
 */

const BLOCKED_HOST = /(^localhost$)|(\.localhost$)|(\.local$)|(\.internal$)|(\.home\.arpa$)|(^metadata\.google\.internal$)/i;

export function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

export function assertSafeExternalUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(ErrorCode.VALIDATION_FAILED, "Invalid image URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ApiError(ErrorCode.VALIDATION_FAILED, "Only http(s) image URLs are supported.");
  if (url.username || url.password) throw new ApiError(ErrorCode.VALIDATION_FAILED, "URLs with credentials are not allowed.");
  if (allowPrivate) return url;
  if (url.port && url.port !== "443" && url.port !== "80") throw new ApiError(ErrorCode.VALIDATION_FAILED, "Non-standard ports are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST.test(host) || isPrivateIPv4(host) || host.includes(":") || !host.includes(".")) {
    throw new ApiError(ErrorCode.VALIDATION_FAILED, "That image host is not allowed.");
  }
  return url;
}

export async function safeFetchBytes(raw: string, opts: { maxBytes?: number; maxRedirects?: number; allowPrivate?: boolean } = {}): Promise<{ bytes: Uint8Array; finalUrl: string }> {
  const { maxBytes = MAX_IMAGE_BYTES, maxRedirects = 3, allowPrivate = false } = opts;
  let current = assertSafeExternalUrl(raw, allowPrivate);
  for (let i = 0; i <= maxRedirects; i++) {
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: "manual",
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.5", "User-Agent": "FitLensBot/1.0 (+https://github.com/fitlens)" },
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new ApiError(ErrorCode.IMAGE_FETCH_FAILED, undefined, undefined, true);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = assertSafeExternalUrl(new URL(loc, current).toString(), allowPrivate);
      continue;
    }
    if (!res.ok || !res.body) throw new ApiError(ErrorCode.IMAGE_FETCH_FAILED, `The image server responded with ${res.status}.`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new ApiError(ErrorCode.PAYLOAD_TOO_LARGE);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiError(ErrorCode.PAYLOAD_TOO_LARGE);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    return { bytes, finalUrl: current.toString() };
  }
  throw new ApiError(ErrorCode.IMAGE_FETCH_FAILED, "Too many redirects.");
}
