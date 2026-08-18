# Supabase Local Reconcile CI — 2026-08-18

> Purpose: validate the production reconciliation draft in a free, isolated Supabase/Postgres environment.
> Safety: no hosted Supabase project link, token, password, production URL, DDL or DML is used by this gate.

## Scope

- Production project remains: `nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`.
- Production DB is **unchanged**.
- Branch: `agent/supabase-local-ci`.
- Draft PR: #3, base `agent/supabase-reconcile-plan`.
- Test environment: GitHub-hosted Ubuntu runner + Docker + Supabase CLI + local Postgres 17.
- No paid Supabase Development Branch is used or required.

## Why this gate exists

Production has an empty Supabase migration ledger even though its live schema/data strongly match the final effects of repo SQL `001–039`.

Therefore we must not test by linking a CLI to production or by blindly running `db push`.

The local gate reconstructs a production-like database in an isolated runner, reproduces the confirmed policy drift, applies the reconcile review draft, and tests real RLS/trigger behavior.

## Files

- `.github/workflows/supabase-local.yml`
- `scripts/test-supabase-reconcile-local.sh`
- `scripts/test-supabase-role-rls-local.sh`
- `scripts/test-supabase-function-hardening-local.sh`
- `supabase/reconcile/local-production-baseline.sql`
- `supabase/reconcile/2026-08-18_production_reconcile_draft.sql`

`local-production-baseline.sql` is **CI/local only**. It is not a production migration and must never be applied to the hosted project.

## Historical bootstrap debt discovered

### 1. Migration 033 assumes legacy catalog data already exists

A completely blank Supabase database can run migrations `001–032`, but migration `033_tag_rules_sync_boss_tool.sql` inserts Chiikawa characters for `ip_characters.ip_name = '吉伊卡哇'`.

A blank DB did not yet have the matching `ip_catalog` parent row, so the FK correctly failed. Production already has this historical catalog state.

Testing rule:
- do **not** rewrite historical migration 033;
- add only the minimum production-like legacy parent through `supabase/reconcile/local-production-baseline.sql` immediately before 033 in isolated replay;
- never apply that fixture to production.

### 2. Migration 032 relies on migration-transaction semantics

`032_ip_catalog_v3_100_ips.sql` creates `pg_temp` objects with `ON COMMIT DROP` and uses them later in the same migration.

A naive psql autocommit replay drops those temp objects too early.

Testing rule:
- do **not** modify historical migration 032;
- stage a temporary CI copy and wrap only 032 in one transaction, matching migration-runner semantics.

These are **historical bootstrap/test-reconstruction debt**, not evidence that production is missing 032/033.

## Final green proof for current active draft

Current active review draft includes:
1. restore 8 migration-004 catalog/rule RLS policies;
2. pin 3 timestamp trigger helpers to `search_path=pg_catalog`;
3. revoke direct PUBLIC/anon/authenticated EXECUTE from repo-owned trigger-only `handle_new_user()` and `guard_sensitive_product_draft_fields()`, while preserving service-role execution;
4. leave RLS helper EXECUTE unchanged;
5. leave hosted-only `rls_auto_enable()` unchanged.

Latest same-head runs after those changes:

- **Supabase Local Reconcile** run `32140335899` / job `95721221385` — ✅ success
- **Standard CI** run `32140335793` / job `95721221015` — ✅ success

### Phase 1 — reconcile behavior ✅

The local DB gate proved:
- local Supabase Postgres 17 starts without hosted-project credentials;
- controlled production-like reconstruction can apply historical SQL `001–039` with the documented 032/033 reconstruction rules;
- migration 004 creates 8 intended catalog/rule policies before drift simulation;
- test deliberately removes all 8 to reproduce production drift;
- reconcile draft restores all 8;
- each of the 4 tables ends with exactly 2 intended policies;
- operator sees active catalog/rule rows only;
- admin sees active + inactive rows;
- operator direct catalog write is denied;
- admin catalog write is allowed;
- `set_updated_at`, `touch_image_batches_updated_at`, and `touch_publish_batches_updated_at` pin `search_path=pg_catalog` and continue to update `updated_at` across real transactions.

### Phase 2 — role / owner / batch RLS ✅

`test-supabase-role-rls-local.sh` proved:
- `handle_new_user` creates an `operator` profile for a new auth user;
- operator can read/update their own draft;
- operator cannot read/update another operator's draft;
- reviewer/admin can read across the team;
- reviewer can update across the team;
- sensitive-field guard blocks operator status escalation to `approved`;
- reviewer can perform the privileged transition;
- image batch header/item ownership helper paths execute without `42P17` recursion;
- publish batch header/item ownership helper paths execute without `42P17` recursion;
- archive-route authorization DB scope matches the route design: operator can authorize only own draft IDs, reviewer can authorize both owners.

### Phase 3 — SECURITY DEFINER direct-EXECUTE hardening ✅ / scoped

Production metadata showed:
- `handle_new_user()` and `guard_sensitive_product_draft_fields()` are repo-owned trigger functions with PUBLIC direct EXECUTE exposure;
- `current_user_role()`, `is_admin()`, `is_reviewer()` are RLS helpers and authenticated execution is intentional;
- production also contains `rls_auto_enable()` as a hosted event-trigger helper.

The free local stack proved for the two repo-owned trigger functions:
- removing direct EXECUTE from PUBLIC/anon/authenticated does **not** stop `handle_new_user` trigger execution;
- the new user still receives an `operator` profile;
- removing direct EXECUTE does **not** stop `guard_sensitive_product_draft_fields`;
- operator escalation is still blocked;
- authenticated execution for `current_user_role/is_admin/is_reviewer` remains intact.

### Hosted-only `rls_auto_enable()` — intentionally NOT changed

The free local Supabase stack does **not** create production's `public.rls_auto_enable()` / `ensure_rls` event trigger.

Therefore local CI cannot honestly prove that changing its ACL is safe. The production reconcile draft leaves it untouched.

Do not change `rls_auto_enable()` merely to silence Security Advisor. It requires a separate hosted-compatible proof path.

## Important test correction

An early timestamp test expected PostgreSQL `now()` to advance inside one transaction. That expectation was wrong because `now()` is transaction-stable.

The final test performs updates in separate transactions, matching real API/web request behavior. This was a test bug, not an application trigger bug.

## What is still NOT proven

The free local DB matrix is now strong enough to prepare production apply/rollback artifacts, but it is **not permission to modify production**.

Still outside this gate:
- actual hosted production application of the SQL;
- post-apply live Security Advisor results;
- hosted-only `rls_auto_enable()` ACL hardening;
- Supabase Auth leaked-password protection setting;
- UI/mobile/Variant manual runtime cases;
- real Shopify E2E.

## Next safe step

1. Keep production unchanged.
2. Prepare exact **precheck / apply / rollback / postcheck** SQL under `supabase/reconcile/`.
3. Validate those artifacts in this same free local DB workflow.
4. Keep the current migration ledger untouched; never replay `001–039` or invent history rows.
5. Only after scripts and rollback are green, ask the user for explicit production-DB approval.
6. If approved, apply only the narrow reconciliation package and immediately run live read-only postchecks + Security Advisor.

## Handoff rule

Any agent touching Supabase must read:
1. `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
2. this file
3. `supabase/reconcile/2026-08-18_production_reconcile_draft.sql`

Never infer that historical migrations are safe to replay merely because the local production-like reconstruction can execute them with the documented legacy fixture/transaction modeling.
