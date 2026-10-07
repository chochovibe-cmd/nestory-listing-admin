# Shopify Batch Readiness — 2026-10-07

## Status

**PARTIAL PASS / HOLD**

This package has two goals:

1. prove Nestory's own Vercel Preview runtime can use the configured Shopify Client ID + Client Secret via the existing client-credentials implementation;
2. close the multi-variant blank-SKU gap before any 5-item batch / ACTIVE work.

Goal 2 is implemented in source.
Goal 1 is implemented as a Preview-only self-test endpoint but cannot yet be executed because the Vercel Free deployment API hit the daily limit (>100 deployments/day).

Do **not** claim the Vercel client-credentials runtime is PASS until the self-test is executed on a READY deployment of the latest HEAD.

## Authority

- repo: `chochovibe-cmd/nestory-listing-admin`
- branch: `agent/schedule-core-20261006`
- Draft PR: #15
- start HEAD: `550fe71c1d078f7db46736fc91195c268b7d0560`
- current package HEAD when this audit was written:
  `8aaf7a0884e6ca532730afab1022282aad70c7f4`

## Package scope

Allowed:

- Preview-only Shopify auth runtime self-test
- multi-variant SKU fallback
- source verifier / CI / docs

Forbidden:

- second real Shopify product
- Shopify ACTIVE
- Online Store publication
- batch publish
- scheduled execution
- Cron registration
- Production deploy
- merge
- copy / prompt redesign
- unrelated migrations

## Multi-variant SKU diagnosis

Current single-variant publish already has a deterministic generated SKU seed:

`CHO-{type}-{ip}-{character}-001`

Before this package, multi-variant publish ignored that base seed and used only
`product_variants.sku`.

If a variant row had `sku=null`, `toBulkVariantInput()` sent an empty SKU to Shopify.

The controlled Miffy DRAFT E2E exposed this exact behavior: both persisted variant rows
had null SKU and both real Shopify variants were therefore created without SKU.

## Multi-variant SKU fix

Implemented in:

- `src/lib/variants/shopifyVariants.ts`
- `src/lib/shopify/payload.ts`

Rules:

1. explicit row-level SKU always wins;
2. blank row SKU falls back to the existing generated product SKU;
3. when the base ends in a three-digit sequence, variants increment that terminal sequence by sort order:
   - first: `...-001`
   - second: `...-002`
   - third: `...-003`
4. if a future base SKU does not end in a three-digit sequence:
   - first variant uses the base as-is;
   - later variants append `-002`, `-003`, etc.
5. single-variant SKU behavior is unchanged.
6. no Production DB backfill is performed; derivation happens at the publish payload boundary.

This keeps manual row SKU authority intact and avoids rewriting historical rows merely to
prepare a publish payload.

## Preview-only auth self-test

Added:

`src/app/api/shopify/auth-self-test/route.ts`

Safety:

- works only when `VERCEL_ENV === "preview"`
- requires a dedicated Bearer token from `SHOPIFY_AUTH_SELFTEST_TOKEN`
- only calls the Shopify Admin query:
  `shop { name myshopifyDomain currencyCode }`
- no product / variant / inventory mutation
- no access token is returned
- no Client ID / Client Secret is returned
- catch path returns a fixed error code rather than upstream error text
- Production returns 404

The GraphQL self-test query was validated against the Shopify Admin schema before source write.

## Vercel env

A branch-specific, Preview-only sensitive env was created:

- key: `SHOPIFY_AUTH_SELFTEST_TOKEN`
- target: Preview only
- git branch: `agent/schedule-core-20261006`
- not Production

The value is not stored in repo docs.

## Current blocker

Vercel refused a new latest-HEAD deployment with:

- HTTP 402
- code: `api-deployments-free-per-day`
- resource: more than 100 deployments/day
- retry guidance: about 24 hours

This is an account/platform quota blocker, not an application build/runtime failure.

Intermediate branch commits had already entered the Vercel queue before the limit was hit,
but there is no verified READY deployment of the complete auth-self-test HEAD yet.

Therefore:

**Nestory Vercel Client ID + Client Secret runtime remains HOLD, not PASS.**

Do not use Shopify Connector success as a substitute for this runtime proof.

## CI

The first CI run on `16888e4...` failed because the new self-test route contained the literal
legacy token prefix `shpat_` in an error-redaction regex. The repository security verifier
correctly blocked that source pattern.

Fixed immediately:

- upstream error text is no longer returned at all;
- no legacy token prefix literal remains in the route;
- verifier now asserts the route does not expose `error.message`.

Latest package HEAD after this correction:

`8aaf7a0884e6ca532730afab1022282aad70c7f4`

At audit-write time the latest CI / Supabase workflows are still queued/pending.
Check GitHub again; do not treat this paragraph as final CI authority.

## Next action

After Vercel deployment quota becomes available:

1. re-check branch HEAD;
2. obtain the READY Preview deployment for that exact HEAD;
3. call `POST /api/shopify/auth-self-test` with the branch-only self-test Bearer token;
4. expected result:
   - HTTP 200
   - `ok=true`
   - `runtime=vercel-preview`
   - `tokenExchange=pass`
   - Shopify shop identity matches the connected Nestory shop
5. verify no Shopify product count / product state changed;
6. then remove the temporary branch-specific `SHOPIFY_AUTH_SELFTEST_TOKEN` if no longer needed;
7. update this audit / CURRENT_STATUS / AI_START_HERE.

Only after that runtime proof and clean CI should Owner be asked whether to open a 5-item DRAFT batch package.
