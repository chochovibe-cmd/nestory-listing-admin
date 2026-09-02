# Nestory — Release Readiness

> Canonical release / QA / deployment gate for humans and AI agents.
> A documented check is not a pass until it has actually been executed.
> For day-to-day truth read `AI_START_HERE.md` and `docs/CURRENT_STATUS.md` first.

Updated: 2026-09-02 (CI / Preview / production read-only verification)

## 0. Current source and runtime truth

- Previous documented Vercel production baseline: `6ff020dd1d68152b6688c9695f8f96188b7862be`.
- PR #8 merged into the default branch on 2026-08-25 as `21e9d1c90697797aaa6d982e9454ccd4a6955fd8`.
- Vercel production alias was read-only verified on 2026-09-02: `READY`, target `production`, commit `6960a0cd257590abb6c1ccb7c97a2c3e772714d3`.
- Production Supabase migration ledger was read-only verified on 2026-09-02: only `20260818142712` and `20260818142919` are applied. `20260822223100_variant_split_override_semantics.sql` is not applied; do not replay historical migrations.
- P0 server-side image-fetch SSRF hardening, P1 request authorization hardening, and `20260902090000_guard_current_image_batch_pointer.sql` are committed as `f0a6bfa` on Draft PR #10. CI #372, Supabase Local Reconcile #83 and the Vercel Preview all passed; none of these source changes is deployed to production.

Historical references below that call PR #8 "Draft", "unmerged" or "not production" are superseded by this section.

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
- Partial-create retry source guard: `publishDraftSafe.ts` stages new products as `DRAFT`, persists the product ID before follow-up sync, and reconciles a failed draft with a real product ID before another create. It blocks unsafe `ACTIVE` recovery and deletes a remote `DRAFT` before clearing local linkage and creating again. `scripts/verify-shopify-lifecycle-safety.mjs` covers the source/injected model; it is not a Shopify runtime test. See `docs/audits/RELEASE-TRUTH-RECONCILE-2026-09-01.md`.

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

Important P0 gate:

The source idempotency recovery rule was added in `7de14a5`, but it still needs runtime proof. Before broad live publishing, execute and record a Shopify mock partial-create/retry check, then complete one owner-approved controlled real-product E2E. A source verifier alone is insufficient.

## 7. Current completion state

`6960a0cd` is the confirmed Vercel Production commit. PR #8 is merged into the default branch. `f0a6bfa` is isolated in Draft PR #10 and only its Preview deployment is READY.

Current release still requires:

1. latest Preview/iPhone runtime check for Draft PR #10;
2. Shopify production env/config preflight;
3. a planned, separately approved apply and verification of `20260822223100_variant_split_override_semantics` and `20260902090000_guard_current_image_batch_pointer`;
4. Shopify mock partial-create/retry check;
5. explicitly approved controlled real-product E2E;
6. explicit owner approval before merging PR #10, producing its production deployment, or any live Shopify write.

## 8. Team / AI handoff evidence

Every coding session starts with:

1. `AI_START_HERE.md`
2. `docs/CURRENT_STATUS.md`
3. `AGENTS.md`
4. this release gate + relevant audit

Before code changes, confirm branch/HEAD and scope. After changes, update canonical status/audit. `Manual QA Still Needed` is a valid state; never convert an unexecuted manual check into a claimed pass.
