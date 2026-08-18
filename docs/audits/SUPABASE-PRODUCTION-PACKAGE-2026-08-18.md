# Supabase Production Reconcile Package — 2026-08-18

> Purpose: record the audited, locally proven, and now successfully applied production reconciliation.
> Final status: **production apply complete + POSTCHECK_OK + migration tracking established.**

## Production target

- Supabase project: `nestory-listing-tool-test`
- project ref: `tbgtqwvuohmdxnxisrgr`
- PostgreSQL: 17
- user explicitly approved production DB repair on 2026-08-18.
- no Vercel production deploy was performed by this DB operation.

## Pre-apply proof

Before production DDL, the exact read-only precheck returned:

- `PRECHECK_OK` ✅
- `product_drafts = 32`
- `product_images = 147`
- `product_variants = 143`
- `profiles = 1`

The same package had already passed the free local reversible cycle on GitHub Actions / local Supabase Postgres 17.

## Migration tracking decision

Production previously had **no `supabase_migrations` tracking history at all** even though live schema/data strongly reflected historical repo SQL `001–039`.

The user chose the safe baseline strategy instead of manually applying untracked DDL.

Tracking therefore starts **from the audited live state on 2026-08-18**. Historical SQL `001–039` is not fabricated into the ledger and is never replayed to production.

Two real tracked migrations now exist:

1. `20260818142712` — `baseline_existing_schema_20260818`
   - state-assertion marker only;
   - verifies the audited pre-reconcile schema/role/function conditions;
   - does **not** recreate historical schema or alter business rows.
2. `20260818142919` — `production_reconcile_20260818`
   - the actual narrow production reconciliation.

Repo active migration filenames must match these versions exactly.

## Applied production scope

Tracked migration `20260818142919` only:

1. restored the 8 missing migration-004 catalog/rule RLS policies:
   - `ip_catalog_select_authenticated`
   - `ip_catalog_write_admin`
   - `ip_characters_select_authenticated`
   - `ip_characters_write_admin`
   - `tag_rules_select_authenticated`
   - `tag_rules_write_admin`
   - `collection_rules_select_authenticated`
   - `collection_rules_write_admin`
2. set `search_path=pg_catalog` for:
   - `set_updated_at()`
   - `touch_image_batches_updated_at()`
   - `touch_publish_batches_updated_at()`
3. removed direct PUBLIC/anon/authenticated EXECUTE from repo-owned trigger-only functions:
   - `handle_new_user()`
   - `guard_sensitive_product_draft_fields()`
   while retaining explicit `service_role` execution.

Intentionally unchanged:

- `admin / operator / reviewer` role semantics;
- authenticated EXECUTE for `current_user_role()`, `is_admin()`, `is_reviewer()`;
- `user_owns_*_batch(...)` RLS helpers;
- hosted-only `rls_auto_enable()` / event trigger `ensure_rls`;
- product/business rows;
- Shopify/Vercel configuration.

## Production postcheck

Immediately after the tracked reconcile migration, the exact postcheck returned:

- `POSTCHECK_OK` ✅
- `product_drafts = 32`
- `product_images = 147`
- `product_variants = 143`
- `profiles = 1`

The protected row counts are identical to precheck, confirming the narrow package did not mutate those business records.

Postcheck also confirmed:

- all 4 catalog/rule tables still have RLS enabled;
- exactly 2 intended policies exist on each table / all 8 policy names exist;
- all 3 timestamp helpers use `search_path=pg_catalog`;
- the 2 trigger-only functions are no longer directly executable by anon/authenticated;
- service_role execution remains;
- authenticated RLS helper execution remains;
- auth new-user and product-draft sensitive-field trigger wiring remains present.

## Security Advisor after apply

The advisor was rerun immediately after the production change.

Resolved by this package:

- the 4 `RLS enabled but no policy` findings for catalog/rule tables are gone;
- the 3 timestamp-trigger mutable-search-path findings targeted by this package are gone.

Known remaining findings are **separate future hardening work**, not permission to broaden this migration:

- `function_search_path_mutable` for `public.current_user_role`;
- `security_definer_function_exposed` / RPC-surface warnings for RLS/security helpers such as `current_user_role`, `is_admin`, `is_reviewer`, and `user_owns_*_batch(...)`;
- hosted/platform helper warnings including `rls_auto_enable()` where free-local runtime parity is unavailable;
- Auth leaked-password protection disabled;
- anonymous-sign-in advisory/info depending on project Auth configuration.

Do not revoke RLS helper execution wholesale just to clear advisor output; these helpers participate in policy evaluation and require a separate tested design.

## Historical SQL and active queue

Historical repo SQL `001–039` predates formal Supabase migration tracking.

It is preserved byte-for-byte under:

`supabase/history/pre_tracking_migrations/`

It must **not** return to `supabase/migrations/`.

Active `supabase/migrations/` starts with only:

- `20260818142712_baseline_existing_schema_20260818.sql`
- `20260818142919_production_reconcile_20260818.sql`

Future migrations must use normal timestamped tracked migration discipline after these two versions.

The free local historical reconstruction gate continues to bootstrap from the archived `001–039`, because the baseline marker is intentionally not a blank-database schema dump.

## Rollback semantics changed after tracking began

The review-era file:

`supabase/reconcile/2026-08-18_production_rollback.sql`

was proven locally before production apply and remains useful as a **reference for inverse SQL**.

However, now that `20260818142919` is a real tracked production migration, **do not manually run the old rollback file in production by itself**. Doing so would revert schema state while leaving the migration ledger claiming the reconcile is applied.

If production ever needs to revert this change, create and test a **new forward tracked revert migration** using the reviewed inverse operations, apply it through migration tracking, then postcheck. Do not delete or falsify existing migration ledger rows.

## Branch / PR state

- production package branch: `agent/supabase-production-package` / `2d96fce`
- Draft PR #4 remains unmerged.
- migration-baseline follow-up branch: `agent/supabase-migration-baseline`
- no application `src/` changes are part of the DB baseline housekeeping.

## Handoff

Any agent touching production Supabase must read:

1. `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
2. `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
3. this file
4. `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`
5. current active files under `supabase/migrations/`

Production reconciliation is complete. The next database work is **future tracked migration discipline and separately scoped residual security hardening**, not replaying historical SQL.
