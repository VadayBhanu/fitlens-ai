# FitLens REST API (v1)

Base URL: your Worker URL, e.g. `https://fitlens-api.<subdomain>.workers.dev`.
All bodies are JSON unless noted. Authenticated endpoints need `Authorization: Bearer <token>`.

## Errors

```json
{ "error": { "code": "QUOTA_EXHAUSTED", "message": "You've used today's try-on allowance…", "retryable": false, "details": {} } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `BAD_REQUEST` | 400 | Malformed request |
| `VALIDATION_FAILED` | 422 | Input failed schema validation (`details` lists fields) |
| `UNAUTHENTICATED` | 401 | Missing, invalid or expired session |
| `FORBIDDEN` | 403 | Not allowed (also used for expired media links) |
| `NOT_FOUND` | 404 | Missing or not owned by you (deliberately the same response for both) |
| `CONFLICT` | 409 | Duplicate account; job can't be retried |
| `RATE_LIMITED` | 429 | Too many requests or too many active jobs |
| `QUOTA_EXHAUSTED` | 429 | Daily try-on allowance used |
| `CONSENT_REQUIRED` | 403 | `cloud_tryon` consent not granted |
| `UNSUPPORTED_MEDIA` | 415 | Not a JPEG/PNG/WebP (or WebM/MP4 for recordings) |
| `PAYLOAD_TOO_LARGE` | 413 | Images > 12 MB, videos > 60 MB |
| `IMAGE_FETCH_FAILED` | 422 | Couldn't import a product image |
| `PROVIDER_NOT_CONFIGURED` | 503 | Try-on provider key missing |
| `PROVIDER_UNAVAILABLE` | 503 | Provider error or timeout (retryable) |
| `GENERATION_FAILED` | 422 | Provider couldn't generate from these inputs |

## Health
`GET /v1/health` reports database, storage and provider status.

## Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/auth/signup` | `{ email, password (≥10), displayName?, acceptTerms: true, confirmAdult: true }` | `201 { token, expiresAt, user }` |
| POST | `/v1/auth/login` | `{ email, password }` | `{ token, expiresAt, user }` |
| POST | `/v1/auth/logout` | – | `204` |
| GET | `/v1/auth/me` | – | `MeDTO` (consents, usage) |
| POST | `/v1/auth/consents` | `{ purpose: "cloud_tryon" \| "product_analytics", granted }` | `MeDTO` |

## Assets (private media)
| Method | Path | Notes |
|---|---|---|
| POST | `/v1/assets?purpose=person\|garment\|capture\|recording\|reel[&keep=1]` | Raw file bytes as the body. Type is detected from the file signature. Person photos expire after 24 h unless `keep=1`. |
| GET | `/v1/assets/:id` | `AssetDTO` with a fresh signed `url` (valid for about 1 h) |
| POST | `/v1/assets/:id/keep` | Remove the expiry |
| DELETE | `/v1/assets/:id` | Delete the file and any wardrobe references |
| GET | `/v1/files/:id?exp=&sig=` | Public, signature-protected file delivery |

## Products
| Method | Path | Notes |
|---|---|---|
| POST | `/v1/products/extract` | `SelectedProductInput` → `{ product, warnings }`. Imports the garment image. Idempotent per (user, productUrl, imageUrl). |
| GET | `/v1/products` | Recent products |
| GET | `/v1/products/:id` | `ProductDTO` |
| PUT | `/v1/products/:id/garment` | `{ assetId }`: use an uploaded garment image |
| DELETE | `/v1/products/:id` | – |
| POST | `/v1/products/:id/deals` | `DealSearchDTO`: `exact[]`, `similar[]`, `recommendation`, `missingInformation[]`, `providers[]` |
| GET | `/v1/products/:id/reviews` | `ReviewsDTO` with an optional sourced AI summary |

## Try-ons
| Method | Path | Notes |
|---|---|---|
| POST | `/v1/tryons` | Header `Idempotency-Key`. Body `{ personAssetId, garmentAssetId, productId?, quality: fast\|balanced\|premium, category, inputQuality? }` → `202 TryOnDTO` |
| GET | `/v1/tryons/:id` | Poll; advances the job |
| GET | `/v1/tryons` | Recent jobs |
| POST | `/v1/tryons/:id/retry` | Only for retryable `failed`/`expired` jobs; max 3 attempts |
| POST | `/v1/tryons/:id/cancel` | – |

## Wardrobe
| Method | Path | Body |
|---|---|---|
| GET | `/v1/wardrobe` | – |
| POST | `/v1/wardrobe` | `{ kind: tryon\|capture\|recording\|reel\|product, productId?, mediaAssetId?, tryOnId?, note? }` |
| DELETE | `/v1/wardrobe/:id` | – |

## Account
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/account/export` | JSON download of all your records |
| DELETE | `/v1/account` | Deletes the account, all media and records; ends all sessions |

## Admin (requires `Authorization: Bearer $ADMIN_TOKEN`)
| Method | Path | Notes |
|---|---|---|
| POST | `/v1/admin/catalog` | Upsert a retailer feed (≤500 items) |
| POST | `/v1/admin/reviews` | Insert reviews (≤1000) |

## Limits
Signup: 10/h per IP. Login: 30 per 15 min per IP and 10 per 15 min per email. Uploads: 120/h. Product extraction: 120/h. Try-ons: 20/h, `FREE_DAILY_TRYONS`/day and `MAX_ACTIVE_TRYONS` concurrent. Deal searches: 60/h.
