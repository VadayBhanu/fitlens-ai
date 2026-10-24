# Security, Privacy and Responsible AI

FitLens processes faces and bodies, so privacy and security are part of the architecture, not add-ons.

## Privacy-first operating model

| Principle | Implementation |
|---|---|
| Local-first live camera | The Live Mirror runs MediaPipe and the renderer in the browser. Frames are never uploaded; only captures or recordings the user explicitly saves are. |
| Camera only on intent | The camera starts after a click and stops when the user leaves the page. It pauses when the tab is hidden (unless recording). |
| Explicit consent for cloud generation | `cloud_tryon` consent is required server-side before any photo goes to the provider. Consent changes are versioned (`policy_version`) and revocable. |
| Minimal extension permissions | `activeTab`, `scripting`, `storage`, `sidePanel`, `contextMenus`. **No host permissions.** The content script is injected only into the tab where the user activates FitLens. |
| Data minimization | Photos are re-encoded client-side (strips EXIF and GPS) and downscaled to ≤2048 px. Source photos auto-delete after 24 h. Audit logs store hashed IPs. |
| User control | Delete any item, export all data (JSON), delete the account (all media is purged from storage). |
| No training | Photos are used only to fulfil the user's request. |

## Threat model

| Threat | Mitigation | Where |
|---|---|---|
| Malicious page content (XSS, prompt injection) | DOM data is parsed as data, cleaned (`cleanText`), length-capped and Zod-validated. The overlay lives in a closed Shadow DOM. React escapes output. Review text sent to the LLM is quoted and the model is told to ignore instructions in it. | `packages/shared/src/extraction.ts`, `apps/extension/src/*`, `routes/products.ts` |
| Spoofed extension messages | The service worker accepts selections only from its own content scripts on http(s) pages and re-validates them with Zod. | `apps/extension/src/background.ts` |
| Unauthorized media access | Every asset, product, job and wardrobe row is owner-checked. Missing and not-owned return the same 404. Files are served only through HMAC-signed, expiring URLs. | `lib/assets.ts`, `lib/signing.ts` |
| Leaked credentials | Provider keys are Worker secrets (never shipped to clients). Session tokens are random 256-bit values stored as SHA-256 hashes. Passwords use PBKDF2-SHA256 with a per-user salt and constant-time comparison (also run for unknown users, to keep timing uniform). | `lib/crypto.ts`, `routes/auth.ts` |
| SSRF via image URLs | http(s) only; no credentials in URLs, no IP literals or private ranges, no `localhost`, `.local` or `.internal`, standard ports only. Redirects are followed manually and re-validated (max 3). 15 s timeout. Streaming size cap. | `lib/ssrf.ts` |
| Malicious uploads | Type is detected from the file signature (JPEG/PNG/WebP; WebM/MP4 for recordings), dimension bounds come from parsed headers, and size limits apply. SVG/HTML are never accepted. Responses are served with `nosniff`. | `lib/media.ts` |
| Cost exhaustion | Per-user daily quota, hourly rate limits, a concurrency cap, idempotency keys, no automatic retries of expensive generations, and a retry cap. | `routes/tryons.ts`, `lib/ratelimit.ts` |
| Brute force | Per-IP and per-email login limits; per-IP signup limits. | `routes/auth.ts` |
| CORS abuse | Exact-origin allow-list (prefix wildcard only when explicitly configured). Bearer tokens, not cookies, so no CSRF surface. | `src/index.ts` |
| Clickjacking / content injection on the web app | CSP, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, Permissions-Policy limiting camera and microphone to self. | `apps/web/public/_headers` |
| Manipulated or misleading offers | Exact matching needs identifier and variant agreement. Every offer carries its source, demo flag and timestamp. Similar items are never recommended. | `packages/shared/src/matching.ts` |
| Provider compromise or outage | Adapter isolation, short-lived signed URLs (15 min) for provider reads, outputs re-validated like uploads before storage. | `jobs/tryon.ts` |
| Admin endpoint abuse | Disabled unless `ADMIN_TOKEN` (≥16 chars) is set; compared via hashed constant-time equality. | `routes/admin.ts` |

## Responsible AI

- **Adults only** (18+ attestation at signup). Users attest they only upload photos of themselves or of people who agreed.
- **Conservative moderation** is requested from the try-on provider (`moderation_level: conservative`). Only ordinary garment categories are supported.
- **Honest output:** every result carries the warning "AI-generated preview: check color, logo and details" plus input-quality warnings. Reframing is detected and noted. Live recordings and AI generations are labeled differently.
- **No sizing claims:** visual try-on is never presented as fit or size verification.
- **Abuse handling:** publish an abuse contact and act on reports. Deleting an account purges all media.

## Retention

| Data | Retention |
|---|---|
| Live camera frames | Not stored |
| Uploaded person photo | Deleted after 24 h unless the user keeps it (cron-enforced) |
| Garment images | Kept with the product until the user deletes it or their account |
| Try-on results, captures, recordings, reels | Until the user deletes them or their account |
| Sessions | 30 days; purged after expiry |
| Rate-limit counters | 24 h |
| Usage and consent records | Lifetime of the account |
| Audit events | Retained for security; actor unlinked on account deletion |

Third-party provider retention (e.g. FASHN's own output CDN) is governed by their terms. Disclose it accurately in your privacy policy.

## Reporting a vulnerability

Email the operator's security contact. Please don't open public issues for security reports.
