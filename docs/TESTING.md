# Testing Strategy

| Layer | Tool | Command | What it covers |
|---|---|---|---|
| Unit | Vitest | `npm test` | Money parsing (no float drift), exact-product matching (size and color conflicts never exact), GTIN check digits, JSON-LD extraction, One Euro filter, landmark hold/drop, garment layout geometry, affine transforms, photo-quality heuristics, SSRF guard, file-signature sniffing, dimension parsing, CORS rules, password hashing |
| Integration | Node + Wrangler | `npm run test:integration` | Boots the real Worker with local D1 and R2 plus a mock FASHN server: signup and login, CORS, auth, upload validation, signed URLs and tampering, product import, consent gate, asset-role checks, idempotent try-on submission, polling to completion, private result storage, exact-variant deals, sourced reviews, wardrobe, cross-user isolation, admin lock, export, account deletion, cron |
| End-to-end | Playwright | `npm run test:e2e` | **Web:** full studio journey (sign up → garment → photo check → consent → generate → result → wardrobe → consent toggle → export → delete account), quality gate blocks non-person photos. **Mirror:** fake camera with a person, tracking locks on, garment composited (pixel diff), capture, recording plays back. **Extension:** real MV3 extension: injection, hover overlay in closed Shadow DOM, variant-aware selection, service worker validation, side-panel sign-in, import, verified deals, Esc deactivation, rejection of non-content-script senders |

The e2e suite downloads MediaPipe's public pose test image at runtime (not committed) and builds a fake-camera MJPEG from it.

## Acceptance criteria (release gates)

| Area | Gate |
|---|---|
| Product selection | ≥95% success on the demo store and tested fixtures; selection reflects the chosen variant |
| Offer verification | Zero mismatched-size or mismatched-color fixtures accepted as exact (unit and integration tested) |
| Security | Zero known critical authorization issues; cross-user access tests pass |
| Live camera | Stable for a 3-minute session with no crashes; tracking acquires a frontal person |
| Frontal alignment | ≥80% of supported-pose frames rated acceptable by human reviewers (manual) |
| Photo identity | No major identity change in ≥90% of a defined photo test set (manual, per provider version) |
| Media export | All recorded test clips play back (automated playback validation) |

## Manual visual test matrix

Record source image, provider and model version, result, issues and reviewer notes for each combination:

| Dimension | Variations |
|---|---|
| Body | Different heights, proportions, builds |
| Skin tone | Diverse tones, varied lighting |
| Garment | T-shirt, fitted shirt, jacket, dress |
| Pattern | Solid, stripes, checks, logos |
| Pose | Frontal, slight turn, raised arms |
| Lighting | Bright, moderate, low |
| Background | Plain, cluttered |
| Occlusion | Hair, crossed arms, hands near torso |
| Camera | Laptop webcam, external webcam |
| Garment photo | Flat-lay, mannequin, model-worn |

Evaluate photo realism and garment fidelity with human reviewers who compare the original product to the result. Don't rely on a single opaque "realism score".
