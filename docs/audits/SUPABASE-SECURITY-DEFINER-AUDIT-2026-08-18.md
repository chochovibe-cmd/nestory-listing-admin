# Supabase SECURITY DEFINER / RPC Surface Audit — 2026-08-18

Status: **read-only production audit complete; SD-1 private-helper prototype passed free local runtime; no SD-1 production DDL applied.**

Target production project: `nestory-listing-tool-test` (`tbgtqwvuohmdxnxisrgr`).

This audit follows the completed production reconciliation and migration baseline. It addresses the remaining Supabase Security Advisor warnings without treating “make the advisor green” as the goal. The goal is to reduce real API/RPC attack surface without breaking RLS.

## 1. Production facts verified live

### 1.1 Main app tables are not anonymous-readable/writable

For the audited app tables (`profiles`, drafts/images/variants, generation/review/publish logs, image/publish batches, catalog/rule tables, team settings, system prompt versions, automation logs):

- `anon` SELECT: **false**
- `anon` INSERT: **false**
- `authenticated` SELECT: **true** where expected, then constrained by RLS

This means the remaining function findings are primarily an unnecessary function/RPC exposure concern, not evidence that anonymous callers can directly read the app tables.

Recent production API log sampling did not show obvious direct `/rpc/current_user_role`, `/rpc/is_admin`, `/rpc/is_reviewer`, or batch-helper calls. This is supporting evidence only, **not proof of never-used** because the log sample is finite.

### 1.2 Remaining SECURITY DEFINER functions flagged by advisor

Production currently has these relevant `SECURITY DEFINER` functions in exposed `public`:

RLS role helpers:
- `public.current_user_role()`
- `public.is_admin()`
- `public.is_reviewer()`

RLS batch ownership helpers:
- `public.user_owns_image_batch(uuid)`
- `public.user_owns_items_in_image_batch(uuid)`
- `public.user_owns_publish_batch(uuid)`
- `public.user_owns_items_in_publish_batch(uuid)`

Business operation:
- `public.requeue_revision_for_generation(uuid, text)`

Hosted platform/event helper:
- `public.rls_auto_enable()`

### 1.3 ACL / search_path observations

`current_user_role`, `is_admin`, `is_reviewer`:
- owned by `postgres`
- `SECURITY DEFINER`
- `search_path=public`
- executable by `authenticated`
- also inherit PUBLIC EXECUTE exposure

Four batch ownership helpers:
- owned by `postgres`
- `SECURITY DEFINER`
- `search_path=public`
- executable by `authenticated`
- no separate PUBLIC grant in their explicit ACL

`requeue_revision_for_generation`:
- owned by `postgres`
- `SECURITY DEFINER`
- `search_path=public`
- executable by `authenticated` and service role
- function itself verifies `auth.uid()` and permits only reviewer/team access or draft ownership, then requires `needs_revision` before requeue

`rls_auto_enable`:
- `SECURITY DEFINER`
- already uses `search_path=pg_catalog`
- is attached to production event trigger `ensure_rls` on `ddl_command_end`
- local Supabase stack did not reproduce this hosted event-trigger helper, so its direct EXECUTE hardening is not locally proven

## 2. Why we must not blindly revoke authenticated EXECUTE

The role and batch helper functions are actively referenced by production RLS policies.

Live count: **35 policies across 19 public tables** depend on the seven pure RLS helpers.

Examples include:
- `product_drafts`: `current_user_role()`
- `profiles`: `is_admin()`
- `product_images`, `product_variants`, generation/review/publish logs: `is_admin()` / `is_reviewer()`
- image batch policies: `user_owns_image_batch()` / `user_owns_items_in_image_batch()`
- publish batch policies: `user_owns_publish_batch()` / `user_owns_items_in_publish_batch()`
- catalog/rule policies: `is_admin()`

Revoking the permissions or changing these helpers in isolation could break legitimate authenticated RLS evaluation.

Supabase’s current guidance explicitly says RLS `SECURITY DEFINER` helpers do not need to live in an exposed schema. A private/non-exposed schema can be referenced explicitly from policies (for example `private.is_admin()`) while preventing PostgREST from exposing the helper as a normal `/rest/v1/rpc/...` endpoint.

## 3. Classification / recommended treatment

### A. Seven pure RLS helpers — SD-1 candidate

- `current_user_role()`
- `is_admin()`
- `is_reviewer()`
- `user_owns_image_batch(uuid)`
- `user_owns_items_in_image_batch(uuid)`
- `user_owns_publish_batch(uuid)`
- `user_owns_items_in_publish_batch(uuid)`

Chosen architecture:
1. create non-exposed `private` schema;
2. create `private.*` copies as `SECURITY DEFINER` with `search_path=pg_catalog` and schema-qualified table/auth references;
3. grant only private-schema/function usage needed for authenticated RLS evaluation + service role;
4. rewrite all 35 affected policies to call `private.*`;
5. only after policy rewrite, revoke anon/authenticated direct EXECUTE from the seven legacy public helper functions;
6. **keep** the legacy public functions present for now because internal SECURITY DEFINER functions still reference role helpers;
7. leave all role semantics unchanged.

Production function dependency audit found only two additional internal callers of the role helpers:
- `guard_sensitive_product_draft_fields()` — SECURITY DEFINER trigger
- `requeue_revision_for_generation(uuid,text)` — SECURITY DEFINER business operation

Therefore SD-1 does not drop the old public helper functions.

### B. `requeue_revision_for_generation` — keep out of SD-1

This is not merely an RLS helper. It performs a privileged business transition and contains its own auth/ownership/status checks.

The existing `/api/drafts/[id]/request-revision` route does **not** call this RPC; that route performs a different transition (`→ needs_revision`) server-side. GitHub source search also did not find a direct call, but the private repository search index is not treated as exhaustive proof.

Current decision: **do not change its ACL/body in SD-1**. Both prototype and postcheck explicitly assert its authenticated EXECUTE remains unchanged.

### C. `rls_auto_enable` — hosted platform/event-trigger path, leave alone

Production verifies:
- event trigger: `ensure_rls`
- event: `ddl_command_end`
- function: `public.rls_auto_enable()`

The free local stack does not reproduce this hosted-only object. It already has `search_path=pg_catalog`.

Decision: **do not modify in SD-1**. Postcheck verifies the hosted binding remains intact when the object exists.

## 4. Auth advisor: leaked-password protection

Supabase documentation states leaked-password protection is available on **Pro and above**.

This project intentionally stays on Supabase Free. Therefore:
- do not upgrade merely to clear this advisor warning;
- record the warning as plan-limited rather than an actionable Free-tier defect;
- continue using normal password-strength/MFA/security practices available on the current plan.

## 5. SD-1 free local runtime proof — GREEN

Branch: `agent/supabase-security-definer-audit`.

Prototype file:
- `supabase/verification/private-rls-helper-prototype.sql`

Runtime test:
- `scripts/test-supabase-private-rls-helpers-local.sh`

Draft PR #7 was opened **only after intermediate commits were squashed** to reduce Actions email spam. Tested head: `bec490463f48cfeeb8b4c5edda60463313e02a25`.

Final PR #7 validation:
- standard CI run #168: **success** — verify / typecheck / build ✅
- Supabase Local Reconcile run #39: **success** ✅
- the private-schema runtime step itself completed successfully ✅

Runtime assertions proven in isolated Postgres 17 / Supabase Local:
- exactly 7 private RLS helpers exist;
- exactly 35 policies now reference private helpers;
- no affected policy retains explicit-public or unqualified legacy helper calls;
- all private helpers pin `search_path=pg_catalog`;
- anon has no `private` schema usage;
- authenticated can use private helpers for RLS evaluation;
- anon/authenticated direct EXECUTE on the seven public helper RPC surfaces is removed;
- `requeue_revision_for_generation` remains unchanged;
- operator catalog visibility/write restrictions remain unchanged;
- admin catalog access remains unchanged;
- operator own vs cross-owner draft scope remains unchanged;
- reviewer/admin team-wide scope remains unchanged;
- sensitive-field guard still blocks operator escalation;
- image/publish batch ownership helper paths still work without `42P17` recursion;
- archive authorization DB scope remains unchanged.

PR #7 was then closed **unmerged** before the next package-design work, so intermediate follow-up commits do not generate a CI/email on every push.

## 6. SD-1 reversible production-candidate package — PREPARED, NOT APPLIED

Canonical apply body remains the **same SQL already proven in the green prototype**:
- `supabase/verification/private-rls-helper-prototype.sql`

Safety files:
- `supabase/reconcile/2026-08-18_sd1_private_helpers_precheck.sql`
- `supabase/reconcile/2026-08-18_sd1_private_helpers_postcheck.sql`
- `supabase/reconcile/2026-08-18_sd1_private_helpers_revert.sql`
- `scripts/test-supabase-private-rls-package-local.sh`

The package is designed to test:
`revert-to-preSD1 → precheck → exact apply → postcheck → role/RLS matrix → revert → verify revert → exact re-apply → postcheck`.

Protected product/image/variant/profile row counts are compared across the reversible cycle.

Production precheck additionally requires the latest tracked migration to still be:
`20260818142919 production_reconcile_20260818`.

**Package final CI/runtime validation is the next gate. No production SD-1 DDL is authorized or applied yet.**

## 7. Production mutation status

This SD-1 audit/prototype/package work has performed **read-only production queries only**.

It has not:
- created the `private` schema in production;
- altered production functions or policies;
- changed Auth settings;
- added a third production migration;
- mutated product/business rows;
- merged or deployed the app.

Any future production SD-1 apply must use a new tracked migration and requires a new explicit user authorization after the reversible package is fully green.
