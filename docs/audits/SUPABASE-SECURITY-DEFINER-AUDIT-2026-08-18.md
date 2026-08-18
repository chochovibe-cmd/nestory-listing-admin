# Supabase SECURITY DEFINER / RPC Surface Audit — 2026-08-18

Status: **read-only audit complete; no production DDL applied in this branch.**

Target production project: `nestory-listing-tool-test` (`tbgtqwvuohmdxnxisrgr`).

This audit follows the completed production reconciliation and migration baseline. It addresses the remaining Supabase Security Advisor warnings without treating “make the advisor green” as the goal. The goal is to reduce real API/RPC attack surface without breaking RLS.

## 1. Production facts verified live

### 1.1 Main app tables are not anonymous-readable/writable

For the audited app tables (`profiles`, drafts/images/variants, generation/review/publish logs, image/publish batches, catalog/rule tables, team settings, system prompt versions, automation logs):

- `anon` SELECT: **false**
- `anon` INSERT: **false**
- `authenticated` SELECT: **true** where expected, then constrained by RLS

This means the remaining function findings are primarily an unnecessary function/RPC exposure concern, not evidence that anonymous callers can directly read the app tables.

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

### A. Strong candidate for private-schema migration

The following are authorization implementation details, not intended user-facing RPC APIs:

- `current_user_role()`
- `is_admin()`
- `is_reviewer()`
- `user_owns_image_batch(uuid)`
- `user_owns_items_in_image_batch(uuid)`
- `user_owns_publish_batch(uuid)`
- `user_owns_items_in_publish_batch(uuid)`

Recommended architecture:
1. create a non-exposed `private` schema;
2. recreate the helpers as schema-qualified `private.*` SECURITY DEFINER functions with a minimal/fixed search path;
3. update every RLS policy to call `private.*` explicitly;
4. grant only the minimum schema/function privileges needed for policy evaluation;
5. runtime-test operator/reviewer/admin/anon matrix in free local Supabase;
6. only then remove/revoke the old `public.*` helpers.

Do **not** perform this as a quick production `REVOKE` patch.

### B. `requeue_revision_for_generation` — needs app-usage decision

This is not merely an RLS helper. It performs a privileged business transition and contains its own auth/ownership/status checks.

Current source audit has not yet proven whether the app intentionally calls this function as a direct client RPC or whether it is legacy/unreferenced. The existing `/api/drafts/[id]/request-revision` route does **not** call this RPC; that route performs a different transition (`→ needs_revision`) server-side.

Before changing `requeue_revision_for_generation`:
- find all application call sites;
- decide whether it is an intentional authenticated RPC contract;
- if not required as direct RPC, prefer moving the operation behind a server route/private function;
- if intentionally public, keep it narrowly validated and test it as an explicit API.

No change recommended yet.

### C. `rls_auto_enable` — hosted platform/event-trigger path, leave alone for now

Production verifies:
- event trigger: `ensure_rls`
- event: `ddl_command_end`
- function: `public.rls_auto_enable()`

The free local stack does not reproduce this hosted-only object, so we cannot claim a safe revoke/move based on local testing. It already has `search_path=pg_catalog`.

Recommendation: **do not modify in the current hardening pass.** Treat separately only if a hosted-safe test path becomes available.

## 4. Auth advisor: leaked-password protection

Supabase documentation states leaked-password protection is available on **Pro and above**.

This project is intentionally staying on Supabase Free. Therefore:
- do not upgrade merely to clear this advisor warning;
- record the warning as plan-limited rather than an actionable Free-tier defect;
- continue using normal password-strength/MFA/security practices available on the current plan.

## 5. Proposed next implementation phase (still requires testing before production)

Phase SD-1 — private RLS helper prototype in free local DB:
- create `private` schema;
- move/duplicate the 3 role helpers + 4 batch ownership helpers;
- rewrite affected RLS policies to schema-qualified private helpers;
- preserve operator/reviewer/admin semantics exactly;
- verify anon remains blocked;
- verify no RLS recursion (`42P17`);
- verify image/publish batch owner paths;
- verify catalog/rule admin-only writes;
- run standard CI + free Supabase runtime gate.

Phase SD-2 — only after SD-1 is green:
- design a new tracked forward migration;
- produce precheck/postcheck/revert migration;
- obtain explicit production authorization before applying.

Separately:
- resolve `requeue_revision_for_generation` source usage before changing it;
- leave `rls_auto_enable` untouched;
- leave Pro-only leaked-password protection as a documented non-action on Free.

## 6. Production mutation status

This audit performed **read-only queries only**.

It did not:
- create the `private` schema;
- alter functions or policies;
- change Auth settings;
- change migration history;
- mutate product/business rows;
- merge or deploy the app.
