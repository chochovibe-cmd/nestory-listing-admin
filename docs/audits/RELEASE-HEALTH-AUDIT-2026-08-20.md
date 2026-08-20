# Release Health Audit — 2026-08-20

## Scope

Read-only release review requested by the owner after the mobile ResultCard work. This audit covers app/runtime health, code/test safety, mobile UI/UX, Shopify publish behavior and production-readiness recommendations.

No Shopify/Supabase/business logic is changed by this audit.

## Current runtime signal

Vercel production runtime-error query for the last 7 days returned **no runtime error clusters**.

Interpretation: there is no evidence of an active production crash loop. This does not replace authenticated/manual workflow testing.

## Strong existing guards

### Publish authorization / confirmation

`POST /api/drafts/{id}/publish` requires a signed-in user, enforces `canPublish(...)`, rejects invalid publish modes, and requires `confirmActive=true` for ACTIVE publishing.

### Shopify credentials / token handling

Shopify client id/secret are server-only. Client-credentials tokens are cached with an expiry safety margin; a 401 invalidates the cache and retries once. Live mode without credentials fails honestly instead of pretending success.

### Safe default publish mode

`SHOPIFY_PUBLISH_MOCK` is fail-safe: only exact string `false` enables real Shopify writes. Unset / `true` remains mock.

### Variant publish guard

Duplicate option combinations are blocked before publish.

### Batch records

Publish batches/items record progress, honor serverless time budget, and mark skipped/failed items rather than silently dropping them.

### Archive semantics

Single-card and batch remove actions are soft archive/unarchive with undo. The new card `×` must keep using this path rather than hard delete.

## Release risks / recommendations

### P0 — verify Production Shopify mode

Before controlled real-product E2E, verify Vercel Production intentionally has:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_PUBLISH_MOCK=false`

Preview should normally remain mock-safe.

The currently available Vercel connector does not expose environment secret/value reads, so these values cannot be guessed from source.

Why this matters: mock mode intentionally records a successful mock publish state and `mock-product-id`. A wrong production env can therefore look superficially successful although no real Shopify product exists.

Recommendation: later add a read-only non-secret `模擬發布 / 正式 Shopify` indicator near station-3 publish actions.

### P0 — partial Shopify product creation retry is not visibly idempotent

Current `publishDraft` creates the Shopify product first, then synchronizes price/variants/inventory.

If `productCreate` succeeds but later variant/price synchronization fails:

- draft becomes `api_failed`;
- created Shopify `productId` is stored for diagnostics;
- current source does not visibly short-circuit on an existing `shopify_product_id` before a later `productCreate` retry.

Risk: retry after partial failure may create a duplicate Shopify product.

Recommendation before broad live publishing:

1. add explicit recovery/idempotency for `api_failed + shopify_product_id`;
2. resume/update the existing product or require an explicit operator choice before creating another;
3. add a test/verifier for the partial-failure retry case.

Keep this as a separate Shopify-focused change; do not mix it into ResultCard UI work.

### P1 — explicit inventory location

Finite inventory supports `SHOPIFY_LOCATION_ID`; if absent, code tries the first readable location. That is ambiguous for multi-location shops.

Recommendation: explicitly configure/verify `SHOPIFY_LOCATION_ID` before controlled live inventory publishing.

### P1 — browser E2E gap

The repository has extensive `verify:*` source-contract checks, typecheck and build, but no Playwright/Cypress browser runner in `package.json`.

This matters because prior ResultCard regressions could satisfy source checks yet still render badly on iPhone.

Recommendation after this release: add a small Playwright 390px smoke for ResultCard containment/tap/long-press/swipe, uploader three-column geometry and Variant picker. Do not block the immediate release solely on introducing a new framework if current iPhone runtime + CI pass.

### P1 — visible live/mock state

Operator should not need to infer environment mode. Add a non-secret publish-mode badge after the immediate release.

### P2 — batch time-budget UX

Batch publisher intentionally stops near serverless time budget and marks remaining items skipped. UI can later show separate `成功 / 失敗 / 因時間限制跳過` counts and retry skipped only.

### P2 — Shopify API version maintenance

`.env.example` currently documents `SHOPIFY_API_VERSION=2026-04`. Treat version review as periodic maintenance; test productCreate, bulk variants, inventory and Files flows before future version changes.

## Immediate mobile UI release contract

- no horizontal protrusion;
- row 1: title → station → date → soft-remove `×`;
- image left, sale/tags/warnings right;
- compact one-line price/compare/profit;
- visible long-press feedback + selected accent state;
- copy-review one-action `更多` promoted to direct soft-remove;
- image-review multi-action `更多` retained;
- equal-size scope/sort controls;
- theme-accent gesture hint;
- compact swipe actions;
- uploader remains three columns.

This still requires iPhone runtime validation.

## Recommended shortest path to production

1. Validate latest ResultCard Preview on iPhone.
2. Stop mobile UI changes once the owner contract passes.
3. Run final GitHub CI: `verify:all` → `typecheck` → `build`.
4. Verify Production Shopify env/config without exposing secrets.
5. Resolve or explicitly gate P0 partial-product retry/idempotency risk before broad real publishing.
6. Run Shopify mock publish.
7. Run one controlled real-product E2E only with explicit approval and known live configuration.
8. If E2E is correct, merge/deploy current release changes with explicit owner approval.

## Non-goals

- no production Shopify write;
- no environment mutation;
- no Supabase mutation;
- no schema migration;
- no role change;
- no unrelated UI refactor.
