# FitLens AI: Complete Setup, Deployment and Operations Guide

This guide takes you from an empty machine to a production FitLens deployment: a Chrome extension on the Chrome Web Store, a web studio on Cloudflare Pages, and an API on Cloudflare Workers, all hosted on free tiers where they exist.

**Contents**

1. [What you'll set up](#1-what-youll-set-up)
2. [Accounts and costs](#2-accounts-and-costs)
3. [Install tools](#3-install-tools)
4. [Run everything locally](#4-run-everything-locally)
5. [Load the extension in Chrome](#5-load-the-extension-in-chrome)
6. [Try the complete flow locally](#6-try-the-complete-flow-locally)
7. [Deploy the API to Cloudflare Workers](#7-deploy-the-api-to-cloudflare-workers)
8. [Deploy the web studio to Cloudflare Pages](#8-deploy-the-web-studio-to-cloudflare-pages)
9. [Connect the extension to production](#9-connect-the-extension-to-production)
10. [Publish on the Chrome Web Store](#10-publish-on-the-chrome-web-store)
11. [Automate deployments with GitHub Actions](#11-automate-deployments-with-github-actions)
12. [Load real retailer offers and reviews](#12-load-real-retailer-offers-and-reviews)
13. [Custom domain](#13-custom-domain-optional)
14. [Operations: monitoring, backups, limits](#14-operations)
15. [Configuration reference](#15-configuration-reference)
16. [Troubleshooting](#16-troubleshooting)
17. [Launch checklist](#17-launch-checklist)

---

## 1. What you'll set up

```
 Chrome extension ──┐                         ┌── FASHN try-on API (photo generation)
 (store pages,      │   HTTPS + bearer token  │
  side panel)       ├──────────────► FitLens API (Cloudflare Worker) ──┼── SerpApi Google Shopping (optional)
 Web studio ────────┘                 │   │   │                       └── Workers AI (review summaries, optional)
 (Cloudflare Pages)                   D1  R2  Cron (every 5 min: job reconciliation + photo retention)
                                   (SQL) (private media)
 Live Mirror: MediaPipe runs in the browser. Camera video never leaves the device.
```

| Component | Folder | Hosted on |
|---|---|---|
| API | `apps/api` | Cloudflare Workers, D1 (SQLite), R2 (object storage), Cron Triggers |
| Web studio | `apps/web` | Cloudflare Pages |
| Extension | `apps/extension` | Chrome Web Store |
| Shared logic | `packages/shared` | bundled into all three |

## 2. Accounts and costs

| Service | Needed for | Cost (check current pricing pages) |
|---|---|---|
| **GitHub** | Source code, CI/CD | Free |
| **Cloudflare** | API, database, storage, web hosting | Free plan: Workers (100k requests/day), D1 (5 GB), Pages. **R2** has a free 10 GB tier but asks for a payment method to activate. You can skip R2 and use Workers KV instead (see §7.3). |
| **FASHN AI** (fashn.ai) | Photo try-on generation | **Paid per image** (credit-based). Required for photo try-on. Everything else works without it. |
| **SerpApi** (serpapi.com) | Live Google Shopping offers | Optional; small free monthly allowance |
| **Chrome Web Store developer account** | Publishing the extension | One-time US$5 registration fee |

> Cloudflare's free Workers plan limits CPU time per request. Password hashing (PBKDF2, 100k iterations) is the heaviest operation. If sign-ins ever fail with "exceeded CPU", lower `PASSWORD_PBKDF2_ITERATIONS` or move to Workers Paid ($5/month). Existing passwords keep working after a change because each user's iteration count is stored.

## 3. Install tools

- **Node.js 20+** (22 recommended): https://nodejs.org. Check with `node -v`.
- **Git**: https://git-scm.com
- **Google Chrome** 116 or newer
- Optional: **zip** (for packaging the extension; preinstalled on macOS and Linux)

Then:

```bash
git clone https://github.com/<your-username>/fitlens-ai.git
cd fitlens-ai
npm install
```

`npm install` installs every workspace, including Wrangler (Cloudflare's CLI) as a local dev dependency. Run it with `npx wrangler …`.

## 4. Run everything locally

### 4.1 API secrets for local development

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Edit `apps/api/.dev.vars`:

```ini
SIGNING_SECRET=<any random string of 32+ characters>
FASHN_API_KEY=<your FASHN key, optional for local work>
SERPAPI_KEY=
ADMIN_TOKEN=<random string, 16+ characters>
```

Generate random strings with `openssl rand -hex 32`.

### 4.2 Database

```bash
npm run db:migrate:local      # creates tables in a local D1 (SQLite) database
npm run db:seed-demo:local    # optional: fictional demo retailers, offers and reviews
```

### 4.3 Start the servers (three terminals)

```bash
npm run dev:api        # API on http://localhost:8787   (check http://localhost:8787/v1/health)
npm run dev:web        # Web studio on http://localhost:5173
npm run dev:extension  # rebuilds apps/extension/dist on every change
```

Local development needs no Cloudflare account: Wrangler simulates D1, R2 and the Worker on your machine.

> **Testing product imports from the local demo store:** the API normally refuses to download images from `localhost` (SSRF protection). To let it import images from `http://localhost:5173/demo-store/`, add `DEV_ALLOW_PRIVATE_HOSTS=true` to `.dev.vars`. This only takes effect while `ENVIRONMENT=development`.

## 5. Load the extension in Chrome

1. Run `npm run dev:extension` (or `npm run build -w @fitlens/extension`).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `apps/extension/dist` folder.
5. Pin FitLens to the toolbar (puzzle icon → pin).

By default the extension talks to `http://localhost:8787` (API) and `http://localhost:5173` (web). You can change both in the side panel under **Settings**.

## 6. Try the complete flow locally

1. Open http://localhost:5173/signup and create an account (18+ and terms checkboxes are required).
2. Open http://localhost:5173/demo-store/. Choose a size on the **Denim Trucker Jacket**.
3. Click the **FitLens toolbar button**. The side panel opens and a bar appears on the page.
4. Sign in to the side panel, hover the jacket photo and click **✨ Try on**.
5. The side panel imports the product. It shows the style number and GTIN read from the store's structured data.
6. **Try on**: grant consent, add a front-facing photo of yourself and click **Generate try-on**. This requires `FASHN_API_KEY`.
7. **Deals**: shows the verified exact matches from the demo feed. The size L listing is deliberately *not* treated as a match.
8. **Live Mirror ↗** opens the web studio's mirror with the same garment. Click **Start Live Mirror**, move around, capture a photo and record a clip.
9. Visit **Wardrobe** in the web studio, select a few looks and click **Create vertical reel**.

## 7. Deploy the API to Cloudflare Workers

### 7.1 Sign in to Cloudflare

```bash
cd apps/api
npx wrangler login          # opens a browser to authorize Wrangler
```

### 7.2 Create the database

```bash
npx wrangler d1 create fitlens
```

Copy the printed `database_id` into `apps/api/wrangler.toml`, replacing `00000000-0000-0000-0000-000000000000`. If you use the GitHub deploy workflow (§11), you can leave the placeholder and store the ID as a secret instead.

Apply the schema:

```bash
npx wrangler d1 migrations apply fitlens --remote
```

Optional demo data (fictional offers, clearly labeled "Demo" in the UI):

```bash
npx wrangler d1 execute fitlens --remote --file=seeds/demo.sql
```

### 7.3 Create private storage

**Option A: R2 (recommended).** Enable R2 in the Cloudflare dashboard (R2 → Get started; it asks for a payment method even for the free tier). Then:

```bash
npx wrangler r2 bucket create fitlens-assets
```

Keep the bucket private. Never enable public access; FitLens serves media through short-lived signed URLs.

**Option B: Workers KV (no payment method needed).**

```bash
npx wrangler kv namespace create ASSETS_KV
```

In `wrangler.toml`, comment out the `[[r2_buckets]]` block and uncomment the `[[kv_namespaces]]` block with the printed ID. KV's free plan allows about 1,000 writes per day and 25 MB per file, which is enough to start. Switch to R2 as you grow.

### 7.4 Set secrets

```bash
npx wrangler secret put SIGNING_SECRET    # paste: openssl rand -hex 32
npx wrangler secret put FASHN_API_KEY     # from https://app.fashn.ai → API keys
npx wrangler secret put SERPAPI_KEY       # optional
npx wrangler secret put ADMIN_TOKEN       # optional; enables /v1/admin/* feed ingestion
```

### 7.5 Set production variables

In `apps/api/wrangler.toml` under `[vars]`, change these (or pass them with `--var` as the deploy workflow does):

```toml
APP_ORIGIN = "https://fitlens-web.pages.dev"            # your web URL (§8)
ALLOWED_ORIGINS = "https://fitlens-web.pages.dev,chrome-extension://<your-extension-id>"
ENVIRONMENT = "production"
```

Optional: uncomment the `[ai]` binding to enable AI review summaries (Workers AI free daily allowance).

### 7.6 Deploy

```bash
npx wrangler deploy
```

Wrangler prints your API URL, e.g. `https://fitlens-api.<your-subdomain>.workers.dev`. Check it:

```bash
curl https://fitlens-api.<your-subdomain>.workers.dev/v1/health
```

`services.tryOnProvider` should be `configured`, `storage` should be `r2` or `kv`, and `signing` should be `configured`.

The cron trigger (every 5 minutes) runs automatically. It finishes stalled try-on jobs and deletes expired temporary photos.

## 8. Deploy the web studio to Cloudflare Pages

```bash
cd ../..                                    # repository root
VITE_API_URL=https://fitlens-api.<your-subdomain>.workers.dev npm run build -w @fitlens/web
npx wrangler pages project create fitlens-web --production-branch=main
npx wrangler pages deploy apps/web/dist --project-name=fitlens-web
```

Your site is now at `https://fitlens-web.pages.dev` (the exact URL is printed). If that URL differs from `APP_ORIGIN` and `ALLOWED_ORIGINS` in §7.5, update them and run `npx wrangler deploy` again in `apps/api`.

`apps/web/public/_headers` sets security headers (CSP, frame denial, camera permission policy). `_redirects` enables client-side routing. The demo store is served at `/demo-store/`.

## 9. Connect the extension to production

Build the extension with your production URLs baked in:

```bash
FITLENS_API_URL=https://fitlens-api.<your-subdomain>.workers.dev \
FITLENS_WEB_URL=https://fitlens-web.pages.dev \
npm run package:extension
```

This creates `apps/extension/release/fitlens-extension-1.0.0.zip`.

**Allowing the extension's origin.** The API only accepts browser requests from origins listed in `ALLOWED_ORIGINS`. An extension's origin is `chrome-extension://<id>`:

- While testing an unpacked build, copy the ID from `chrome://extensions` and add it, or keep `chrome-extension://*` temporarily.
- For the store version, upload the ZIP once as a draft (§10) to get its permanent ID, then set `ALLOWED_ORIGINS=https://fitlens-web.pages.dev,chrome-extension://<store-id>` and redeploy the API.

## 10. Publish on the Chrome Web Store

1. Register at https://chrome.google.com/webstore/devconsole (one-time $5 fee).
2. Click **New item** and upload `apps/extension/release/fitlens-extension-<version>.zip`.
3. **Store listing**: description, at least one 1280×800 screenshot (side panel plus a try-on result works well), the 128×128 icon from `apps/extension/public/icons/icon128.png`, category *Shopping*.
4. **Privacy practices** tab: declare **personally identifiable information** (email), **personal communications** (none), **website content** (product details on pages the user activates FitLens on), and **user activity** (none). Justify each permission:
   - `activeTab` + `scripting`: inject the selector only on the tab where the user clicks FitLens.
   - `sidePanel`: the FitLens UI.
   - `storage`: sign-in token, settings and the current selection.
   - `contextMenus`: "Try on with FitLens" on images.
   - No host permissions; the extension can't read pages in the background.
5. Link your privacy policy: `https://<your-web-url>/privacy`.
6. Submit for review. Reviews usually take from a few days to a couple of weeks.
7. After approval, set the repository variable `EXTENSION_STORE_URL` so the website links to the listing.

To release an update, bump `version` in `apps/extension/public/manifest.json`, rebuild the ZIP and upload it.

## 11. Automate deployments with GitHub Actions

Two workflows are included:

- **CI** (`.github/workflows/ci.yml`) runs on every push and pull request: typecheck, unit tests, builds, the API integration test and the Playwright end-to-end suite. It uploads the extension ZIP as an artifact.
- **Deploy** (`.github/workflows/deploy.yml`) runs on pushes to `main` when enabled. It migrates D1, deploys the Worker, builds and deploys Pages, and packages a production extension ZIP.

### 11.1 Create a Cloudflare API token

Cloudflare dashboard → My Profile → **API Tokens** → Create Token → **Custom token** with these permissions:

- Account → **Workers Scripts**: Edit
- Account → **D1**: Edit
- Account → **Cloudflare Pages**: Edit
- Account → **Workers R2 Storage**: Edit (if using R2)
- Account → **Workers KV Storage**: Edit (if using KV)
- Account → **Account Settings**: Read

Your **Account ID** is on the right side of the Workers & Pages overview page.

### 11.2 Add repository secrets and variables

GitHub → your repository → **Settings → Secrets and variables → Actions**.

**Secrets**

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token from §11.1 |
| `CLOUDFLARE_ACCOUNT_ID` | your account ID |
| `D1_DATABASE_ID` | from `wrangler d1 create` |

**Variables**

| Name | Example |
|---|---|
| `DEPLOY_ENABLED` | `true` |
| `API_URL` | `https://fitlens-api.<subdomain>.workers.dev` |
| `WEB_URL` | `https://fitlens-web.pages.dev` |
| `EXTENSION_ID` | your Chrome Web Store extension ID |
| `PAGES_PROJECT` | `fitlens-web` |
| `ENABLE_WORKERS_AI` | `true` (optional) |
| `FREE_DAILY_TRYONS` | `10` (optional) |
| `EXTENSION_STORE_URL` | your Chrome Web Store URL (optional) |

Worker secrets (`SIGNING_SECRET`, `FASHN_API_KEY`, …) stay in Cloudflare (§7.4). They aren't needed in GitHub.

Push to `main` and watch the **Actions** tab.

## 12. Load real retailer offers and reviews

FitLens compares prices only from sources you're authorized to use: affiliate or retailer product feeds, or a licensed shopping API.

**Retailer feeds** (up to 500 items per request):

```bash
curl -X POST "$API_URL/v1/admin/catalog" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "retailer": { "name": "Example Store", "domain": "example-store.com", "returnPolicy": "Free returns within 30 days", "verificationStatus": "verified" },
    "items": [{
      "externalId": "SKU-123-M",
      "title": "Northline Denim Trucker Jacket",
      "brand": "Northline", "styleNumber": "NL-204", "gtin": "840000001023",
      "color": "Indigo", "size": "M",
      "productUrl": "https://example-store.com/p/sku-123?size=M",
      "price": { "amountMinor": 7900, "currency": "USD" },
      "shippingMinor": 0, "available": true
    }]
  }'
```

Re-posting the same `externalId` updates the price. Schedule your feed sync (for example with a GitHub Actions cron) to keep prices fresh. Every offer shows when it was last checked.

**Reviews:**

```bash
curl -X POST "$API_URL/v1/admin/reviews" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{ "retailer": { "name": "Example Store", "domain": "example-store.com" },
        "reviews": [{ "gtin": "840000001023", "rating": 5, "body": "True to size.", "sourceUrl": "https://example-store.com/p/sku-123#reviews" }] }'
```

**Google Shopping (optional):** set `SERPAPI_KEY`. These results rarely include variant identifiers, so they usually appear under **Similar items**. They're never labeled exact unless the identifiers line up.

To remove the demo data in production:

```bash
npx wrangler d1 execute fitlens --remote --command "DELETE FROM catalog_items WHERE is_demo = 1; DELETE FROM reviews WHERE is_demo = 1; DELETE FROM retailers WHERE id LIKE 'demo-%';"
```

## 13. Custom domain (optional)

- **Web**: Pages project → Custom domains → add `app.yourdomain.com`.
- **API**: Worker → Settings → Domains & Routes → add `api.yourdomain.com`.
- Update `APP_ORIGIN`, `ALLOWED_ORIGINS` and `PUBLIC_API_ORIGIN` (or the GitHub variables), redeploy the API, rebuild the web app with the new `VITE_API_URL`, and ship an extension update with the new URLs.

## 14. Operations

| Task | Command or place |
|---|---|
| Live API logs | `cd apps/api && npx wrangler tail` |
| Health | `GET /v1/health` (use it for uptime monitoring, e.g. a free UptimeRobot check) |
| Metrics | Cloudflare dashboard → Workers → fitlens-api → Metrics / Observability |
| Database backup | `npx wrangler d1 export fitlens --remote --output=backup-$(date +%F).sql` (D1 also has Time Travel point-in-time restore) |
| Run a query | `npx wrangler d1 execute fitlens --remote --command "SELECT COUNT(*) FROM users"` |
| Rotate the signing secret | `npx wrangler secret put SIGNING_SECRET`. Existing media links expire within an hour; nothing else breaks. |
| Rotate the FASHN key | `npx wrangler secret put FASHN_API_KEY` |
| Change free daily limit | `FREE_DAILY_TRYONS` variable |
| Cost control | Each user is limited by `FREE_DAILY_TRYONS`, 20 try-ons/hour and 2 concurrent jobs. Failed generations aren't retried automatically, and retries are capped at 3. |

**Retention** (enforced by the cron job): source photos are deleted 24 hours after upload unless the user keeps them (`TEMP_PHOTO_RETENTION_HOURS`), expired sessions are purged, and rate-limit counters older than a day are removed.

## 15. Configuration reference

### API (`apps/api/wrangler.toml` `[vars]`, or `--var`)

| Variable | Default | Meaning |
|---|---|---|
| `APP_ORIGIN` | `http://localhost:5173` | Web studio origin |
| `ALLOWED_ORIGINS` | `http://localhost:5173,chrome-extension://*` | CORS allow-list; a trailing `*` matches by prefix |
| `PUBLIC_API_ORIGIN` | request origin | Base used in signed media URLs (set it for custom domains) |
| `FREE_DAILY_TRYONS` | `10` | Photo try-ons per user per UTC day |
| `MAX_ACTIVE_TRYONS` | `2` | Concurrent jobs per user |
| `TEMP_PHOTO_RETENTION_HOURS` | `24` | Auto-delete window for source photos |
| `PASSWORD_PBKDF2_ITERATIONS` | `100000` | Password hashing cost (Workers maximum is 100000) |
| `FASHN_PREMIUM_MODEL` | `tryon-v1.6` | Set to `tryon-max` to use FASHN's top tier for HD |
| `ENVIRONMENT` | `development` | Use `production` in production |

**Secrets:** `SIGNING_SECRET` (required), `FASHN_API_KEY` (photo try-on), `SERPAPI_KEY` (optional), `ADMIN_TOKEN` (optional).

**Development only** (ignored unless `ENVIRONMENT=development`): `DEV_ALLOW_PRIVATE_HOSTS`, `FASHN_BASE_URL`.

### Web (`apps/web/.env` or the build environment)

| Variable | Meaning |
|---|---|
| `VITE_API_URL` | API base URL |
| `VITE_EXTENSION_URL` | Chrome Web Store listing (optional) |

### Extension (build environment)

| Variable | Meaning |
|---|---|
| `FITLENS_API_URL` | Default API URL (users can override it in Settings) |
| `FITLENS_WEB_URL` | Default web URL |

## 16. Troubleshooting

| Symptom | Fix |
|---|---|
| Web app says "Can't reach FitLens" | Check `VITE_API_URL` and that `/v1/health` works. Make sure `ALLOWED_ORIGINS` contains the exact web origin (scheme and host, no trailing slash). |
| Extension sign-in fails with a network error | Add `chrome-extension://<id>` to `ALLOWED_ORIGINS` and check the API URL in side panel Settings. |
| "FitLens can't run on this page" | Chrome blocks extensions on `chrome://` pages, the Web Store and some sites. Use **Upload a garment photo** in the studio instead. |
| "We couldn't import the product image" | The store blocks hotlinking or the image is very large. Upload the garment photo in the side panel or studio. |
| Try-on fails with "isn't configured" | Set `FASHN_API_KEY` with `wrangler secret put` and redeploy. |
| Try-on fails with a provider error | Check your FASHN credit balance. Failed predictions don't use credits. Retry from the result panel. |
| Live Mirror says camera permission denied | Allow the camera for the site (lock icon in the address bar). The mirror needs HTTPS or localhost. |
| Clothes don't fit your body well in the Live Mirror | Click **Recalibrate** (Adjust fit → Body profile). Stand facing the camera with your whole face, shoulders and hips in view and your arms slightly out, and hold still for the countdown. Use **Size / Width / Length / Position** for fine-tuning. |
| Photo check says it couldn't detect a person | Use a photo where your face and upper body are clearly visible. If it's a good photo, tick **"Yes, this photo shows me"** to continue. |
| Live Mirror is slow | The engine lowers its inference rate automatically. Close other GPU-heavy tabs, use better lighting, and step back so your shoulders and hips are visible. |
| `wrangler dev` fails with "CLOUDFLARE_API_TOKEN required" | The `[ai]` binding needs a Cloudflare login even locally. Run `npx wrangler login` or keep `[ai]` commented out. |
| Deploy workflow skipped | Set the repository variable `DEPLOY_ENABLED=true`. |

## 17. Launch checklist

- [ ] `ENVIRONMENT=production`; `ALLOWED_ORIGINS` lists only your web origin and the store extension ID
- [ ] Strong `SIGNING_SECRET` and `ADMIN_TOKEN` stored as Worker secrets (never in Git)
- [ ] R2 bucket private (no public access); D1 backups scheduled
- [ ] Demo data removed, or clearly labeled as it is by default
- [ ] Privacy Policy and Terms (`/privacy`, `/terms`) reviewed by a lawyer for your markets (GDPR/CCPA, biometric-privacy laws such as BIPA)
- [ ] Data processing agreement with your try-on provider; its retention terms disclosed in the privacy policy
- [ ] Shopping data used only under feed or API terms that permit price comparison
- [ ] Abuse contact published; process for takedown and non-consensual image reports
- [ ] Uptime check on `/v1/health`; error alerts from Workers Observability
- [ ] CI green on `main`; extension listing approved; website links to it
