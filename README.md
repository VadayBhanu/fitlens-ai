# FitLens AI

**Your AI fashion mirror and smart shopping companion.** Pick a garment on any store, see it on yourself, move in it with a live mirror, capture photos and reels, and buy from the best *verified* offer.

> Discover it → Wear it virtually → See how it moves → Capture it → Compare prices → Buy confidently.

| Surface | What it does | Runs on |
|---|---|---|
| **Chrome extension** (`apps/extension`) | Hover-to-select garments on store pages, side-panel try-on, quick deal check | Chrome Web Store (MV3) |
| **Web studio** (`apps/web`) | Photo Try-On Studio, Live Mirror, deal comparison, wardrobe and reels, account and privacy | Cloudflare Pages (free) |
| **API** (`apps/api`) | Auth, private media, try-on jobs, product identity matching, offers, reviews | Cloudflare Workers + D1 + R2 (free tier) |
| **Shared core** (`packages/shared`) | Zod contracts, money, exact-product matching, One Euro filter, garment geometry, photo-quality checks | Used everywhere |

## Features

- **Smart Fashion Selector:** activate on any tab (toolbar, `Alt+Shift+F` or right-click an image). FitLens reads the store's schema.org Product data, then Open Graph tags, then the nearby product card, and records the selected **variant** (color, size, GTIN, style number).
- **PrecisionFit photo try-on:** an on-device photo check (resolution, exposure, blur and a MediaPipe person count) runs before upload. You consent explicitly before anything goes to the try-on provider. The provider adapter is vendor-neutral and ships with FASHN. Jobs are idempotent, polled, and expire if they stall. Results are copied to private storage and come with honest warnings.
- **LiveMirror:** MediaPipe Pose runs in the browser. Landmarks are smoothed with a confidence-aware One Euro filter, the torso is drawn as a piecewise-affine mesh, and sleeves are rigid parts that follow the upper arm. The engine estimates hips when they're out of frame, fades the garment out when tracking is lost, and lowers the inference rate on slow devices. Camera frames never leave the device.
- **Snap & Reel Studio:** capture photos and record clips (with optional microphone) from the same canvas you see, and check that each clip plays back. Wardrobe looks can be turned into on-device 1080×1920 reels.
- **Deal Intelligence:** an offer counts as an *exact* match only if the GTIN matches, or the brand and style number match with no color or size conflict. Lookalikes are shown separately and never recommended. Totals include known shipping, and every offer shows its source and when it was checked. Sources are authorized retailer feeds (admin ingestion API) and, optionally, SerpApi Google Shopping.
- **Reviews:** matched by product identifier, each linked to its source. Summaries come from Workers AI, cite the reviews they use, and treat review text as untrusted input.
- **Digital wardrobe, privacy and accounts:** a private wardrobe, a 24-hour auto-delete for source photos, JSON data export, one-click account deletion, consent records and audit events.

## Quick start (local)

```bash
git clone https://github.com/<you>/fitlens-ai.git && cd fitlens-ai
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars    # set SIGNING_SECRET (and FASHN_API_KEY for photo try-on)
npm run db:migrate:local && npm run db:seed-demo:local
npm run dev:api        # http://localhost:8787
npm run dev:web        # http://localhost:5173   (open /demo-store/ for a test shop)
npm run dev:extension  # then load apps/extension/dist as an unpacked extension
```

**Complete setup, deployment, Chrome Web Store publishing and operations guide → [docs/GUIDE.md](docs/GUIDE.md)**

## Quality gates

```bash
npm run typecheck        # all workspaces
npm test                 # 60 unit tests (shared core + API security)
npm run test:integration # 21-step API test against a real local Worker, D1 and R2
npm run test:e2e         # Playwright: studio journey, quality gate, live mirror with a fake camera, extension
```

CI runs all of these on every pull request (`.github/workflows/ci.yml`). Deployment to Cloudflare is automated by `.github/workflows/deploy.yml`.

## Documentation

- [docs/GUIDE.md](docs/GUIDE.md): step-by-step setup, deployment, publishing, operations, troubleshooting
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system design and key decisions
- [docs/API.md](docs/API.md): REST API reference
- [docs/SECURITY.md](docs/SECURITY.md): threat model, privacy engineering and retention
- [docs/TESTING.md](docs/TESTING.md): test strategy and acceptance criteria

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE).
