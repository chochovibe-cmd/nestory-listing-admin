# Nestory — Release Readiness

> Canonical release / QA / deployment gate for humans and AI agents.
> A documented check is not a pass until it has actually been executed.
> For day-to-day truth read `AI_START_HERE.md` and `docs/CURRENT_STATUS.md` first.

Updated: 2026-08-20

## 1. Release policy

A Vercel Preview being READY is not sufficient for production release.

Required automated gate:

1. `pnpm install --frozen-lockfile`
2. `pnpm run verify:all`
3. `pnpm run typecheck`
4. `pnpm run build`

Required runtime gate:

- authenticated app smoke;
- role/RLS cases;
- owner-approved mobile ResultCard cases;
- ImageUploader mobile sanity;
- Variant regression cases;
- Shopify mock publish;
- one controlled real-product E2E only after production Shopify configuration and the partial-create retry risk are explicitly handled/approved.

## 2. Deployment safety checklist

Before a production deploy:

- read `AI_START_HERE.md`, `docs/CURRENT_STATUS.md`, this file, and relevant audits;
- confirm intended branch/commit and review its diff;
- confirm GitHub CI is green;
- keep Preview/development Shopify mock-safe;
- never enable live Shopify publishing by accident: only exact `SHOPIFY_PUBLISH_MOCK=false` is live;
- ACTIVE publish must retain explicit `confirmActive=true`;
- verify production `SHOPIFY_STORE_DOMAIN`, client credentials and preferably `SHOPIFY_LOCATION_ID` without exposing secrets;
- never place service-role, Shopify secret, AI keys, worker tokens or webhooks in browser storage / `NEXT_PUBLIC_*`;
- do not replay Supabase historical migrations `001–039` to production;
- do not ad-hoc test by pushing unrelated changes directly into production branch;
- Vercel Hobby build-rate-limit failure is not the same as code build failure.

## 3. Core API contracts that must remain stable

### Worker

- `POST /api/worker/claim` — atomically claims eligible generation work.
- `POST /api/worker/complete` — records successful generation output.
- `POST /api/worker/fail` — records failed generation work.

### Draft review

- `POST /api/drafts/{id}/request-revision` must preserve role/RLS rules.
- Review/approve actions preserve reviewer/admin authorization.

### Publish

- `POST /api/drafts/{id}/publish` — single publish; ACTIVE requires `confirmActive`.
- Batch publish preserves the same publisher-role / ACTIVE-confirmation rule.
- Shopify mock mode must never create a real product.
- Duplicate variant combinations are rejected before publish.
- A partial Shopify create failure must not be blindly retried into duplicate product creation; see `docs/audits/RELEASE-HEALTH-AUDIT-2026-08-20.md`.

### Matrixify CSV fallback

- Matrixify CSV remains independently available from Shopify API publish.
- Mapping lives under `src/lib/csv/matrixify.ts` and export routes.

### Archive / remove from queue

- ResultCard `×` and batch `移出佇列` are **soft archive**, not hard delete.
- Existing undo/unarchive behavior must remain.
- Batch archive/unarchive authorizes requested IDs through the signed-in/RLS client before service-role mutation.
- Operator scope = own drafts; reviewer/admin according to team RLS.

## 4. Automated/source-contract fixtures

Keep available:

- `fixtures/worker-complete-sample.json`
- `fixtures/publish-active-sample.json`
- `fixtures/matrixify-export-sample.json`
- `fixtures/ui-states.json`

The `verify:*` suite is valuable but does not replace real browser layout validation. Current package does not have a browser E2E runner; add a small Playwright mobile smoke after this release rather than silently treating source regex checks as visual proof.

## 5. Manual QA matrix

### Publish safety

- ACTIVE requires explicit user confirmation.
- DRAFT still requires publisher role.
- `SHOPIFY_PUBLISH_MOCK=true` creates no real Shopify product.
- Production live test only after env preflight.
- Reviewer can export Matrixify CSV.
- Controlled partial-failure/retry behavior is understood before broad live publishing.

### Role / RLS

- Operator can read/update own eligible draft.
- Operator cannot update another member's draft by client-supplied ID through a service-role API.
- Reviewer/admin can read team drafts according to policy.
- Operator cannot directly write admin-governed catalog/rule tables.

### Mobile ResultCard — owner contract 2026-08-20

Normal mode:

- card does not protrude horizontally;
- row 1 reads title → station → date → small soft-remove `×`;
- thumbnail left; sale/tags/warnings right;
- price/compare/profit stay compact on one row without a heavy box;
- tapping the card expands/collapses;
- large mobile expand arrow is intentionally hidden by owner decision;
- `×` removes from queue and undo works;
- left-swipe from non-interactive surface still exposes station actions;
- interactive controls do not accidentally start long-press/swipe.

Multi-select:

- long-press blank card surface (500ms) visibly feels pressed and enters selection mode;
- selected card has an obvious accent state;
- while selection mode is active, normal card tap toggles selection (existing behavior); exit/cancel selection before using normal tap-to-expand;
- copy-review exposes direct `移出佇列` instead of a redundant one-item `更多`;
- image-review keeps `更多` because it contains additional generate-detail actions.

Results controls:

- `只看我的` / sort are equal width and height on mobile;
- gesture helper uses current theme accent and remains dismissible.

### ImageUploader

- mobile = three equal square columns;
- top-right delete `×` usable and not colliding with spec badge;
- spinner/retry/paste/drag/reorder/spec marking remain.

### Variant editor

- destructive axis change waits for confirmation atomically;
- duplicate combinations are protected;
- desktop picker first/middle/last hover preview remains visible within containment.

### Read-only route smoke

Use `scripts/verify-pwa-smoke.mjs` against a running app and validate `/`, `/login`, `/drafts`, `/drafts/new`, `/review` expected shell/auth states.

## 6. Shopify preflight before live use

Source currently expects:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- optional but recommended `SHOPIFY_LOCATION_ID`
- `SHOPIFY_PUBLISH_MOCK=false` only for a deliberate live environment
- current documented API version `2026-04`

Important P0:

`publishDraft` creates the Shopify product before later variant/price/inventory sync. If later sync fails, the app records `api_failed` and the created product ID. Before broad live publishing, add/confirm an idempotent recovery rule so retry does not create a duplicate product.

## 7. Current completion state

Production baseline `6ff020dd` is already deployed. The latest owner-corrected mobile UI remains on `agent/release-thumbnail-regression-fix` and is not yet production.

Vercel production runtime error query for the last 7 days reported no runtime error clusters as of 2026-08-20.

Current release still requires:

1. latest iPhone ResultCard runtime check;
2. full GitHub CI;
3. Shopify production env/config preflight;
4. decision/fix for partial product-create retry idempotency;
5. Shopify mock check;
6. explicitly approved controlled real-product E2E;
7. explicit owner approval before merge/production deployment of this release.

## 8. Team / AI handoff evidence

Every coding session starts with:

1. `AI_START_HERE.md`
2. `docs/CURRENT_STATUS.md`
3. `AGENTS.md`
4. this release gate + relevant audit

Before code changes, confirm branch/HEAD and scope. After changes, update canonical status/audit. `Manual QA Still Needed` is a valid state; never convert an unexecuted manual check into a claimed pass.
