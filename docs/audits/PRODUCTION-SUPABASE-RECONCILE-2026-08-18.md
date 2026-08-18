# Production Supabase Reconcile — 2026-08-18

> Scope: read-only audit of the Supabase project actually used by this repo.
> No production DDL/DML was executed in this audit.

## Target

- Supabase project: `nestory-listing-tool-test`
- project ref: `tbgtqwvuohmdxnxisrgr`
- region: `ap-southeast-2`
- Postgres: 17.6.x
- Repo compared from stabilization stack branch based on `agent/p0-archive-owner-authorization`.

## Executive summary

Production schema is **not old**. It contains later Nestory fields such as:
- `profiles.capture_token_*`
- `product_drafts.raw_capture`
- `product_drafts.generation_tone`
- `product_images.list_thumb_url`
- `product_images.vision_mid_url`

So late migrations/SQL changes were clearly applied at some point.

However, Supabase's migration ledger is currently **empty**. `list_migrations` returns no entries. This means repo migration files `001–039` cannot be reconciled by version number alone; historical schema changes were likely applied manually through SQL Editor and/or outside tracked Supabase migrations.

Current primary risk is therefore **authorization/schema drift**, not missing basic tables.

## Confirmed good state

### Core role model exists in production

`public.user_role` / `profiles.role` is:
- `admin`
- `operator`
- `reviewer`

Default role remains `operator`.

Current production profile count at audit time:
- admin: 1
- operator: 0
- reviewer: 0

### Core RLS is enabled

RLS is enabled on the main application tables, including:
- profiles
- product_drafts
- product_images
- product_variants
- generation_runs
- publish_jobs
- review_logs / automation_logs
- image batches/items
- publish batches/items
- settings/system prompt tables
- IP/tag/catalog tables

### Product ownership / reviewer model is present

Production `product_drafts` policies match the intended model reasonably well:
- operator can insert own drafts
- operator updates only own unpublished/review-stage drafts
- reviewer/admin can read/update across team

This supports the canonical role decision documented in the repo:
- operator = own listing work
- reviewer = team review + publish
- admin = reviewer powers + sensitive/admin controls

## Confirmed production drift

### P0/P1 — Migration history is empty

Supabase migration ledger has no entries even though production schema contains late fields.

Implication:
- Do **not** blindly replay repo `001–039`.
- Do **not** treat a missing migration row as proof that its DDL is missing.
- Future agents must compare actual schema/policies before applying historical SQL.

Recommended direction:
1. Treat current production schema as a baseline to reconcile.
2. Generate a clean future migration from an audited baseline once a local Supabase CLI environment is available.
3. From that point onward, require tracked migrations rather than SQL-Editor-only changes.

### P0/P1 — Four catalog/rule tables have RLS enabled but no policies

Supabase Security Advisor reports `RLS Enabled No Policy` for:
- `public.ip_catalog`
- `public.ip_characters`
- `public.tag_rules`
- `public.collection_rules`

Repo migration `004_ip_tag_collection_tables.sql` explicitly defines authenticated SELECT policies and admin write policies for all four tables.

Production currently has authenticated `SELECT` grants on these tables, but because RLS is enabled and there are **zero policies**, direct authenticated Data API reads return no rows.

This is a confirmed repo ↔ production policy drift.

Important nuance:
- Some server routes, e.g. character quick-add, intentionally read/write these catalogs through the service-role client, so those server paths can still work despite missing user policies.
- That does not make the missing policies correct; any direct authenticated client read intended by migration 004 is currently blocked.

### P1 — SECURITY DEFINER functions exposed too broadly

Security Advisor flags several public-schema SECURITY DEFINER functions.

Confirmed callable by `anon`:
- `current_user_role()`
- `is_admin()`
- `is_reviewer()`
- `guard_sensitive_product_draft_fields()`
- `handle_new_user()`
- `rls_auto_enable()`

Confirmed callable by `authenticated` include the above plus intentional RLS/ownership helpers and `requeue_revision_for_generation(...)`.

Classification:
- Trigger/event-trigger functions such as `guard_sensitive_product_draft_fields`, `handle_new_user`, `rls_auto_enable` should not need direct client RPC access. Revoke direct PUBLIC/anon/authenticated EXECUTE unless a verified use requires it.
- `current_user_role` / `is_admin` / `is_reviewer` are used from RLS policies and require more careful treatment. A simple revoke from authenticated may break policies. Preferred long-term hardening is to keep privileged helpers callable by policy evaluation while moving them out of exposed RPC surface (e.g. non-exposed/private schema or another verified pattern), rather than blindly revoking them.
- Ownership helpers used inside RLS also need the same RPC-vs-policy review before changing privileges.

### P1 — mutable search_path warnings

Security Advisor reports mutable search path for:
- `set_updated_at()`
- `touch_image_batches_updated_at()`
- `touch_publish_batches_updated_at()`

These are small trigger functions, but should still be given an explicit safe `search_path` in a future migration to clear the security warning.

### P2 — leaked password protection disabled

Supabase Auth leaked-password protection is disabled.

This is a project Auth setting, not a repo migration issue. Recommend enabling it before broader team onboarding.

## 2026 platform note

Supabase changed Data API defaults in 2026: new public tables are no longer automatically exposed through anon/authenticated grants by default. Explicit GRANT and RLS are separate layers.

Nestory already contains many explicit GRANT statements, which is directionally correct. Future migrations must continue to define both:
1. table/function privileges, and
2. RLS policies.

Do not assume one implies the other.

## Relationship to archive authorization fix

The repo fix `agent/p0-archive-owner-authorization` makes batch archive authorization reads go through the signed-in Supabase client/RLS before privileged writes.

Production `product_drafts` RLS currently has the owner/reviewer policies needed for that design, so the fix aligns with actual DB policy semantics.

At audit time only one admin profile exists, so the prior operator cross-owner issue did not yet have another real team user to target. It still needed fixing before team expansion.

## Recommended next actions

### Step 1 — keep production unchanged for now

Do not patch production directly from this audit.

### Step 2 — prepare a reconciliation migration in a proper local Supabase CLI environment

The migration should be narrowly scoped and idempotent:
- restore the intended four catalog/rule RLS policies after confirming current app read/write paths
- remove unnecessary direct EXECUTE access from trigger/event-trigger SECURITY DEFINER functions
- harden search_path on flagged trigger helpers
- preserve authenticated execution where RLS helper functions genuinely require it
- avoid changing the canonical `admin | operator | reviewer` role model

### Step 3 — test before production apply

Minimum checks:
- authenticated user can read active IP/tag catalog rows as intended
- operator cannot write admin-governed catalog tables directly
- operator own-draft reads/updates still work
- reviewer/admin cross-team reads still work
- archive route respects owner/reviewer RLS scope
- all trigger/event trigger behavior still works after EXECUTE hardening
- Supabase Security Advisor rerun after DDL

### Step 4 — establish future migration discipline

Because current migration history is empty, do not pretend historical `001–039` are tracked in Supabase.

Once baseline is reconciled:
- create future migrations with Supabase CLI
- commit generated migration files
- apply tracked migrations rather than ad-hoc SQL Editor changes
- update `verify-sql-schema.mjs` to verify current schema, not only early migrations

## Do not do

- Do not replay `001–039` wholesale into production.
- Do not disable RLS to make the four catalog tables readable.
- Do not give operator publish rights as part of this reconcile.
- Do not revoke authenticated EXECUTE from `current_user_role/is_admin/is_reviewer` without proving RLS still evaluates correctly.
- Do not create a fake migration-history baseline by inventing rows manually.

## Next agent handoff

Read this file before any production Supabase DDL.

Current state is **audit complete / production unchanged**.
The next safe implementation task is a local/branch reconciliation migration plus tests, then explicit production application only after verification.