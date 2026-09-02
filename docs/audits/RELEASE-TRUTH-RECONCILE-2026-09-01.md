# Release Truth Reconcile — 2026-09-01

## Scope and boundary

This is a documentation-only reconciliation of local Git source, tracked migrations, and existing audit evidence. It does not inspect GitHub checks, Vercel, Supabase, Shopify, secrets, or live data. No application code, environment, database, deployment, or Shopify product was changed.

## Confirmed from the repository

| Fact | Repository evidence | Meaning |
| --- | --- | --- |
| Known production baseline | `6ff020dd1d68152b6688c9695f8f96188b7862be` — `release: merge Nestory stabilization and tracked Supabase baseline (#6)` | Existing documentation/audit evidence identifies this as the Vercel Production baseline. |
| PR #8 merge | `21e9d1c90697797aaa6d982e9454ccd4a6955fd8` — `Merge pull request #8 from chochovibe-cmd/agent/release-thumbnail-regression-fix` | PR #8 is already in the default branch; old “Draft/unmerged” statements are historical. |
| Current source head | `6960a0cd257590abb6c1ccb7c97a2c3e772714d3` | This commit only reverts an accidentally created empty `__invalid__` file after PR #8. |
| Shopify partial-create source guard | `7de14a564e1e96501918c78fd3f6c4401cd137de` | Source now uses `publishDraftSafe.ts` and has `verify-shopify-lifecycle-safety.mjs` source/injected-model coverage. |
| Third tracked migration exists | `supabase/migrations/20260822223100_variant_split_override_semantics.sql` | The migration is in source and arrived through the PR #8 history. |

## Shopify partial-create recovery: what source now does

For a real Shopify publish, the source creates a `DRAFT`, persists the returned Shopify product ID before follow-up sync, and marks later failures with that link. On retry of `api_failed` with a real ID, it queries the remote product: an `ACTIVE` product is blocked for manual reconciliation; a `DRAFT` product is deleted before local linkage is cleared and a new create can proceed. Link-persistence failure attempts compensating deletion. Direct creation against an existing real product ID and concurrent `publishing` requests are blocked.

This is a source-level repair, not a completed Shopify test. The verifier disables network and uses an injected model. Required remaining evidence is:

1. a recorded Shopify mock partial-create/retry run; and
2. one owner-approved, controlled real-product E2E before broad live publishing.

## Explicitly unverified external state

| Item | Current status | Required check |
| --- | --- | --- |
| Vercel Production deployment of `6960a0c` | Unknown; Git history cannot prove a deployment | Check Vercel deployment record by commit SHA. |
| GitHub CI / Preview against current source head | Not established by this reconciliation | Inspect the exact run/deployment for the intended SHA. |
| Production apply of `20260822223100_variant_split_override_semantics` | Unknown; tracked file is not proof of apply | Check Supabase migration ledger through an authorized production read. |
| Shopify mock / controlled real-product behavior | Not run by this reconciliation | Execute the release gate without exposing credentials. |

## Canonical operating rule

Do not collapse source, CI, preview, Vercel Production, Supabase migration ledger, and Shopify E2E into one status. Each has its own evidence. The release gate remains in `docs/RELEASE_READINESS.md`; current high-level status is in `docs/CURRENT_STATUS.md` and `AI_START_HERE.md`.
