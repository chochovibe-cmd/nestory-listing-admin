# Supabase Production Reconcile Package — 2026-08-18

> Purpose: turn the audited/local-proven reconciliation into an exact, reversible production execution package.
> Current status: **package locally proven; production NOT modified; explicit user approval still required.**

## Branch / PR

- Branch: `agent/supabase-production-package`
- Base: `agent/supabase-local-ci`
- Draft PR: #4
- No application `src/` changes.
- No production Supabase mutation.
- No deploy.
- No paid Supabase Development Branch.

## Package files

- `supabase/reconcile/2026-08-18_production_precheck.sql`
- `supabase/reconcile/2026-08-18_production_apply.sql`
- `supabase/reconcile/2026-08-18_production_rollback.sql`
- `supabase/reconcile/2026-08-18_production_postcheck.sql`
- local package-cycle test: `scripts/test-supabase-production-package-local.sh`

These remain under `supabase/reconcile/`, not `supabase/migrations/`. Production's migration ledger is empty and historical `001–039` must not be replayed.

## PRECHECK contract

`2026-08-18_production_precheck.sql` is designed to refuse execution if the live DB no longer matches the audited pre-state.

It checks:
- `public.user_role` is exactly `admin / operator / reviewer`;
- `ip_catalog / ip_characters / tag_rules / collection_rules` exist and RLS is enabled;
- those four tables still have **0 policies total** before apply;
- all functions touched by the package exist;
- the 3 timestamp helpers have not already been partially hardened to `search_path=pg_catalog`;
- `handle_new_user()` and `guard_sensitive_product_draft_fields()` still have the audited pre-state direct client EXECUTE surface;
- authenticated RLS helpers remain executable;
- `on_auth_user_created` and `product_drafts_guard_sensitive_fields` trigger wiring still exists.

If any condition changed, the correct action is **STOP and re-audit**, not force the apply SQL.

## APPLY contract

`2026-08-18_production_apply.sql` only:
1. restores the 8 migration-004 catalog/rule RLS policies;
2. sets `search_path=pg_catalog` for:
   - `set_updated_at()`
   - `touch_image_batches_updated_at()`
   - `touch_publish_batches_updated_at()`
3. removes direct PUBLIC/anon/authenticated EXECUTE from:
   - `handle_new_user()`
   - `guard_sensitive_product_draft_fields()`
   while keeping service-role execution explicit.

It intentionally does **not**:
- replay migrations;
- alter product/business rows;
- change roles;
- change migration history;
- disable RLS;
- revoke authenticated execution from RLS helpers;
- modify hosted-only `rls_auto_enable()`.

## ROLLBACK contract

`2026-08-18_production_rollback.sql` reverses only this package and restores the audited pre-reconcile state:
- removes the 8 restored policies;
- resets function-level `search_path` on the 3 timestamp helpers;
- restores PUBLIC direct EXECUTE on the 2 trigger-only functions.

Rollback intentionally returns to the known old/insecure state; it is an emergency recovery path, not a desirable final state.

It does not touch product/business rows or migration history.

## POSTCHECK contract

`2026-08-18_production_postcheck.sql` asserts:
- role enum unchanged;
- RLS still enabled on all 4 catalog/rule tables;
- exactly 2 intended policies per table / all 8 names present;
- all 3 timestamp helpers have `search_path=pg_catalog`;
- direct client EXECUTE is removed from the 2 trigger-only functions;
- service_role retains execution;
- authenticated RLS helper execution remains intact;
- auth new-user and product-draft sensitive-field trigger wiring remains present.

## Free local reversible proof

Initial package-cycle run:
- Supabase Local Reconcile run `32141584338`
- job `95725267127`
- result: ✅ success

Same-head standard CI:
- run `32141584347`
- job `95725266572`
- result: ✅ success

The local package test performed:
1. rollback current local applied state to the audited production pre-state;
2. verify rollback state;
3. run exact production precheck;
4. run exact production apply;
5. run exact postcheck;
6. run exact rollback;
7. verify rollback state again;
8. run precheck again;
9. re-apply;
10. postcheck again;
11. assert protected row counts are unchanged before vs after the full cycle.

Result: **reversible + repeatable + data-preserving in the free isolated Postgres 17 environment.**

## Production execution gate

This audit is NOT permission to apply production DDL.

Before any live change:
1. final branch must be squashed and both CI gates green on the final head;
2. user must explicitly approve production DB modification;
3. run the live precheck first;
4. if precheck fails, stop without apply;
5. if precheck passes, run only the exact apply package;
6. immediately run postcheck and Supabase Security Advisor;
7. if validation fails, investigate and use the reviewed rollback only when appropriate.

## Hosted-only `rls_auto_enable()`

Production has `public.rls_auto_enable()` / `ensure_rls`; free local Supabase does not recreate it.

This package intentionally leaves its ACL untouched. Do not broaden the package just to remove an advisor warning without a safe proof path.

## Handoff

Any agent preparing production DB work must read, in order:
1. `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
2. `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
3. this file
4. the four SQL package files under `supabase/reconcile/`

Production is still unchanged at the end of this audit.
