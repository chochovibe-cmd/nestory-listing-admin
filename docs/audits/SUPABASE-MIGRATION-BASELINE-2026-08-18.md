# Supabase Migration Baseline — 2026-08-18

## Purpose

Create a clean Supabase migration-tracking boundary **from the already-audited live production state**, without replaying or falsifying historical repo SQL `001–039`.

## Why a baseline was needed

Production `nestory-listing-tool-test` (`tbgtqwvuohmdxnxisrgr`) had no `supabase_migrations` schema/history before this work, while its live schema/data already strongly reflected the end-state of repo SQL `001–039`.

Therefore:

- empty ledger did **not** mean migrations were missing;
- replaying `001–039` would have been unsafe;
- inserting fake historical migration rows would have misrepresented history;
- using untracked DDL would have preserved the same operational debt.

The selected strategy was: **formal tracking starts now.**

## Production tracked versions

After explicit user approval and successful live precheck, Supabase migration tracking was established with:

| Version | Name | Meaning |
|---|---|---|
| `20260818142712` | `baseline_existing_schema_20260818` | assertion-only marker for the audited existing schema; no historical replay |
| `20260818142919` | `production_reconcile_20260818` | narrow RLS/function hardening package |

These versions were read back from Supabase after apply and are the production source of truth.

## Repo layout after baseline

### Active tracked queue

`supabase/migrations/`

must contain only migrations that are actually part of the new tracked timeline, beginning with:

- `20260818142712_baseline_existing_schema_20260818.sql`
- `20260818142919_production_reconcile_20260818.sql`

Future tracked migrations append here using timestamped Supabase migration naming.

### Pre-tracking history

Historical SQL `001–039` is preserved byte-for-byte under:

`supabase/history/pre_tracking_migrations/`

The archive is evidence/history and a local reconstruction input. It is **not** an active production migration queue.

No historical SQL content was rewritten during the move; Git blob/tree references were reused for the archive operation.

## Important limitation of the baseline marker

`20260818142712_baseline_existing_schema_20260818.sql` is intentionally a **state assertion marker**, not a full schema dump.

That means a completely blank database cannot be built solely from the new active tracked queue.

For the current project, blank/local reconstruction remains a separate test concern:

1. replay archived pre-tracking SQL `001–039` in the controlled local gate;
2. apply the documented migration-032 transaction modeling;
3. inject the local-only legacy parent fixture required before migration 033;
4. run current reconciliation/runtime tests.

Do not confuse that test bootstrap path with the production migration queue.

A future project may choose to produce a fully squashed schema baseline for blank-environment provisioning, but that is a separate migration-history architecture task and must not rewrite the production ledger casually.

## CI guard

`scripts/verify-supabase-migration-baseline.mjs` locks the boundary:

- exactly the two initial tracked files must be active at this stage;
- historical `001–039` must exist in the archive;
- historical numeric migrations must not re-enter `supabase/migrations/`;
- the tracked reconcile must contain the expected narrow policy/function changes;
- hosted-only `rls_auto_enable()` must remain outside that reconcile;
- free local DB reconstruction must copy from the pre-tracking archive, not the active tracked queue.

The verifier is wired into `verify:all`.

## Production outcome at baseline creation

The production reconcile immediately following the baseline returned `POSTCHECK_OK` with unchanged protected counts:

- product drafts: 32
- product images: 147
- product variants: 143
- profiles: 1

Security Advisor was rerun after apply. Targeted 4-table no-policy findings and the three targeted timestamp search-path findings were resolved. Residual SECURITY DEFINER / RLS helper / Auth findings remain separately scoped work.

## Future rules

1. Never replay archived `001–039` to production.
2. Never manually insert fake historical migration rows.
3. Never remove the two production-tracked baseline/reconcile versions just to make local tooling convenient.
4. Any production schema/RLS/function change becomes a new tracked timestamped migration.
5. Rollbacks after tracking begins should normally be new forward tracked revert migrations, not silent schema edits that leave ledger state inconsistent.
6. `supabase/reconcile/` remains review/evidence material; active production timeline lives in `supabase/migrations/`.
7. Free local CI may use the archive to reconstruct historical state, but that does not grant production replay permission.

## Handoff

Read together with:

- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `AI_START_HERE.md`
- `docs/CURRENT_STATUS.md`
