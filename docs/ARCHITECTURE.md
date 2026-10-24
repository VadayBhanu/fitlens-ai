# Architecture

## System overview

```
┌──────────────── Browser ────────────────────────────────────────────────┐
│ Chrome extension (MV3)                    Web studio (React SPA)        │
│  ├ service worker: activation, validation  ├ Try-On Studio              │
│  ├ content script: hover-to-select (on     ├ Live Mirror (MediaPipe +   │
│  │   demand, shadow DOM, no host perms)    │   canvas mesh renderer)    │
│  └ side panel: product, try-on, deals      ├ Deals & reviews            │
│                                            └ Wardrobe, reels, account   │
└──────────────┬──────────────────────────────────────┬───────────────────┘
               │ HTTPS, Bearer session token           │
┌──────────────▼──────────────────────────────────────▼───────────────────┐
│ FitLens API — Cloudflare Worker (Hono)                                  │
│  auth · assets · products · tryons · deals · reviews · wardrobe ·       │
│  account · admin                                                        │
│  ├ D1 (SQLite): users, sessions, consents, assets, products, offers,    │
│  │   try-on jobs, media, wardrobe, usage, audit, rate limits            │
│  ├ R2 (or KV): private media, served via HMAC-signed short-lived URLs   │
│  ├ Cron */5: reconcile try-on jobs, purge expired photos & sessions     │
│  └ Provider adapters: FASHN (try-on), retailer feeds + SerpApi          │
│      (offers), Workers AI (review summaries)                            │
└─────────────────────────────────────────────────────────────────────────┘
```

## Package boundaries

| Package | Responsibility | Depends on |
|---|---|---|
| `packages/shared` | Contracts (Zod), money, product identity matching, extraction parsing, filters, garment geometry, photo quality | `zod` |
| `apps/api` | HTTP API, persistence, provider adapters, jobs | shared, hono |
| `apps/web` | Studio UI, LiveMirror engine (`src/mirror`), reels | shared, react, @mediapipe/tasks-vision |
| `apps/extension` | Page selection, side panel | shared, react |

Three subsystems are deliberately independent and replaceable:

- **Vision** (`apps/web/src/lib/pose.ts`, `packages/shared/src/filters.ts`): where the person is and how they move.
- **Renderer** (`apps/web/src/mirror/renderer.ts`, `packages/shared/src/geometry.ts`): how the garment is placed and drawn.
- **AI providers** (`apps/api/src/providers`): photorealistic synthesis and shopping data.

Upgrading a model or vendor doesn't touch the extension or shopping logic.

## Key flows

### Product selection
1. User clicks the toolbar button, the shortcut or the image context menu. The service worker opens the side panel and injects `content.js` into that tab only (`activeTab`).
2. On click, `extract.ts` builds a `SelectedProductInput`: JSON-LD Product (matched to the clicked image) → Open Graph → nearby card text → image alt / page title. It records the extraction method and a confidence value.
3. The service worker validates the input with Zod, accepts it only from content scripts on http(s) pages, and stores it in `chrome.storage.session`.
4. The side panel picks it up and calls `POST /v1/products/extract`. The API normalizes it, upserts it per user, and imports the garment image through the SSRF-guarded fetcher into private storage.

### Photo try-on
```
client: quality check (resolution, exposure, Laplacian blur, MediaPipe person count)
  → POST /v1/assets?purpose=person   (signature-sniffed, dimension-checked, 24 h expiry)
  → POST /v1/tryons (Idempotency-Key) → consent? quota? concurrency? asset ownership & roles?
      → job row (queued) → provider.createJob (signed URL or data URL) → processing
  → GET /v1/tryons/:id (polled with backoff) → throttled provider poll (claimed by an atomic UPDATE)
      → completed: fetch output → validate like an upload → store privately → rendered_media
  → cron reconciles stragglers; jobs with no progress for 10 min expire (retryable)
```
Job states: `queued → processing → completed`, plus terminal `failed`, `cancelled` and `expired`. A completed job can still carry warnings.

### LiveMirror
```
getUserMedia (after click) → <video> → canvas.drawImage
  → PoseLandmarker.detectForVideo (GPU, CPU fallback; adaptive rate)
  → map landmarks to image-left/right → LandmarkSmoother (One Euro + confidence hold/drop)
  → hips estimated if out of frame → user fit adjustments
  → computeGarmentLayout (torso quad + sleeve placements)
  → renderGarment: sleeves (rigid, rotated about the shoulder seam), torso (4×6 bilinear grid of affine triangles),
    sleeves drawn over the torso when an arm crosses in front
  → opacity fades with tracking state → same canvas feeds capture (toBlob) and recording (captureStream + MediaRecorder)
```
The canvas holds the true camera orientation. "Mirror view" is a CSS flip, and captures honor it.

### Deal intelligence
`matchProducts()` (shared) returns `exact | similar | mismatch` with evidence:
- **exact**: same valid GTIN with no color or size conflict, **or** same brand and style number with the variant confirmed and no conflict.
- **similar**: a style match without variant confirmation, or title similarity ≥ 0.35.
- **mismatch**: different brand or GTIN. These are dropped.

`recommendOffer()` considers exact offers only: the cheapest known total, preferring free returns within 5%. Every offer keeps its provider, demo flag and `checkedAt`. Snapshots are stored for price history.

## Data model

See `apps/api/migrations/0001_init.sql`. Conventions: UUID primary keys, ISO-8601 UTC timestamps, integer minor-unit money, no binaries in SQL, ownership checked on every personal row, idempotent job creation (unique `user_id + idempotency_key`).

## Technology decisions

| Decision | Choice | Why |
|---|---|---|
| Hosting | Cloudflare Workers, D1, R2, Pages | Generous free tiers, global edge, one vendor and one CLI |
| API framework | Hono | Small, fast, Workers-native |
| Jobs | Poll-on-read plus cron reconciliation | Works on the free plan without paid queues; idempotent and claim-guarded |
| Auth | Email + PBKDF2 password, opaque session tokens (hashed at rest) | No third-party dependency; sessions can be revoked |
| Media access | HMAC-signed, expiring URLs | Works in `<img>`, `<video>` and for providers without exposing tokens |
| Live fitting | MediaPipe Pose + 2D deformable mesh on canvas | Runs on-device in real time on ordinary laptops; private |
| Photo fitting | Specialized hosted try-on (FASHN) behind an adapter | Best quality per engineering hour; swappable |
| Extension build | esbuild (IIFE content script, ESM worker) | Simple, fast, MV3-compatible |
| Web build | Vite + React SPA | Static hosting on Pages; code-split routes |

## Roadmap (beyond 1.0)

- Move pose inference into a Web Worker with OffscreenCanvas
- Segmentation-based occlusion for hair and hands
- Rigged 3D garments and cloth simulation for premium items
- Neural video refinement as an optional "Neural Studio" mode
- Size Confidence Engine (manufacturer size charts plus user measurements, with uncertainty)
- Multi-garment outfits with layering
- Billing (Stripe) for paid generation tiers
