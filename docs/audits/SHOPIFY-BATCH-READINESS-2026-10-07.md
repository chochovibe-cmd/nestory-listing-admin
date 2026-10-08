# Shopify Batch Readiness — 2026-10-07

## Status

**PASS / HOLD**

This package has two goals:

1. prove Nestory's own Vercel Preview runtime can use the configured Shopify Client ID + Client Secret via the existing client-credentials implementation;
2. close the multi-variant blank-SKU gap before any 5-item batch / ACTIVE work.

Both goals are now verified.

- Goal 1: Nestory's own Vercel Preview runtime successfully exchanged the configured Client ID + Client Secret and used the resulting Admin token for a read-only Shopify Admin GraphQL query.
- Goal 2: multi-variant blank-SKU fallback is implemented and its dedicated CI gate passes.

This package still remains HOLD for merge / batch / ACTIVE because those require a new Owner-approved package.

## Authority

- repo: `chochovibe-cmd/nestory-listing-admin`
- branch: `agent/schedule-core-20261006`
- Draft PR: #15
- start HEAD: `550fe71c1d078f7db46736fc91195c268b7d0560`
- runtime PASS deployment source HEAD:
  `bf29ce1e9e1276785d038693494edd182eca0d9c`
- dedicated Shopify CI gate source HEAD:
  `771a2b6a5dbf61af8168937c6c4b029b935f2ecf`
- later documentation commits do not change runtime semantics; latest branch HEAD must still be re-checked before any write.

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

## Vercel runtime proof — 2026-10-08

The deployment quota recovered the next day. Exact runtime authority:

- deployment: `dpl_ANUzbW7jXYGRUxQmYuXEFY3apCfM`
- source HEAD: `bf29ce1e9e1276785d038693494edd182eca0d9c`
- state: **READY**
- environment: Vercel Preview

The protected Preview endpoint was called from an isolated Vercel sandbox using the temporary branch-only Bearer token.

Observed result:

- HTTP 200
- `ok=true`
- `runtime=vercel-preview`
- `tokenExchange=pass`
- shop name: `潮巢 Nestory`
- MyShopify domain: `e0jg81-qe.myshopify.com`
- currency: `TWD`

The endpoint only executes the read-only Shopify Admin query
`shop { name myshopifyDomain currencyCode }`; no product / variant / inventory mutation is present in this route.

Therefore **Nestory Vercel Client ID + Client Secret runtime = PASS**. This is separate evidence from the earlier Shopify Connector DRAFT test.

## CI

The first CI run on `16888e4...` failed because the new self-test route contained a literal
legacy Shopify access-token prefix in an error-redaction regex. The repository security verifier
correctly blocked that source pattern.

Fixed immediately:

- upstream error text is no longer returned at all;
- no legacy token prefix literal remains in the route;
- verifier asserts the route does not expose `error.message`.

A separate false-positive then came from this audit itself mentioning the legacy prefix literally; that wording was removed.

To make package ownership unambiguous even while another Copy verifier remains red, the CI workflow now runs:

`Verify Shopify batch readiness`

before the full `verify:all` chain.

On source HEAD `771a2b6a5dbf61af8168937c6c4b029b935f2ecf`:

- `Verify scheduled publish safety`: PASS
- `Verify Shopify batch readiness`: **PASS**
- later `Verify contracts and regressions`: FAIL only on the separate Copy verifier `Boss hierarchy wrapper disappeared`
- typecheck/build are skipped by that later unrelated failure
- Vercel build for the same Shopify code lineage is READY, which independently confirms the Next.js deployment can build and run the auth endpoint.

Do not attribute the Copy verifier failure to this Shopify package.

## Self-test cleanup

After the successful runtime proof:

- the branch-specific Preview self-test secret was set to an empty value for future deployments;
- latest cleanup deployment source HEAD `771a2b6a5dbf61af8168937c6c4b029b935f2ecf` reached READY;
- calling the same self-test endpoint on that cleanup deployment returns:
  - HTTP 503
  - code `SELFTEST_TOKEN_MISSING`
- both temporary Vercel sandboxes used for the runtime proof / cleanup verification were stopped.

The previously verified deployment retains its original deployment snapshot, but remains behind Vercel protection and the temporary credential / share details are not published in repo docs.

## Final decision

**PASS / HOLD**

Batch readiness prerequisites covered by this package are complete:

- Vercel Client ID + Secret runtime: PASS
- deterministic multi-variant SKU fallback: PASS
- real single Shopify DRAFT E2E from the prior package: PASS
- existing test product re-check: still DRAFT, 2 variants, 10 images
- schedule groups/items: still 0

No second product, batch, ACTIVE, Cron, Production deploy, or merge was performed.

The next step requires a **new Owner-approved package**. Recommended next scope: 5-item Shopify DRAFT batch only, with ACTIVE / Online Store publication still forbidden.
