# SCHEDULE CORE — 2026-10-06

## 2026-10-07 authority correction

This section supersedes the historical assumptions below where they conflict.

Read-only production verification on 2026-10-07 found:

- production Supabase: `nestory-listing-tool-test / tbgtqwvuohmdxnxisrgr`
- production ledger already contains `20261006121816 publish_schedule_core`
- production ledger already contains `20261006122416 shopify_full_sync_state`
- source filenames on this branch were reconciled to those exact hosted ledger versions
- production `publish_schedule_groups` rows: **0**
- production `publish_schedule_items` rows: **0**
- Vercel does **not** define `PUBLISH_SCHEDULE_STAGING_ENABLED`
- Vercel does **not** define `PUBLISH_SCHEDULE_EXECUTION_ENABLED`
- `vercel.json` does **not** register `/api/cron/scheduled-publish`
- therefore schema exists in production, but scheduled Shopify staging/execution remains disabled
- production claim RPC privilege is restricted to `service_role`; `authenticated` and `anon` cannot execute it
- Supabase Local Reconcile #113 passed the schedule migration/runtime gate before ledger filename reconciliation

Known production-ledger pending migrations remain:

- `20260822223100_variant_split_override_semantics.sql`
- `20260902090000_guard_current_image_batch_pointer.sql`

Because those pending versions sort before the already-applied 2026-10-06 ledger entries, no unattended production `db push` is allowed. A future apply requires a separate Owner-authorized migration package and explicit ledger precheck.

> Status: feature branch only / not merged / production schema already present per hosted ledger / live scheduled Shopify execution still disabled.

## Authority

Base branch: `agent/uiux2-preview-20260930`
Expected base HEAD when branch was created: `d9bcd3d96c45067fe43f59e76d59d5fb9e0c5ebd`

This branch inherits the Owner-approved UIUX2 Preview direction, including the separate desktop/mobile next-action layout.

## Owner acceptance

Owner approved moving past the UI Preview, with one explicit design rule:

- Desktop and mobile are not the same-height layout.
- New UI must be designed separately for both breakpoints, not merely squeezed responsively.

## Allowed scope

1. Scheduled-publish persistence model and deterministic queue assignment.
2. Authenticated schedule API + guarded cron executor.
3. Publishing-center recovery controls needed by schedules.

## Forbidden scope

- Copy generation / prompts / SEO generation.
- Image AI pipeline.
- Pricing / variant editor redesign.
- Production deploy.
- Applying migration to Production.
- Real Shopify ACTIVE without a separate Owner Go-Live.
- Merge without Owner approval.

## Implemented

### Persistence

Migration:
`supabase/migrations/20261006121816_publish_schedule_core.sql`

Adds:
- `publish_schedule_groups`
- `publish_schedule_items`
- partial unique index: a draft cannot exist in multiple active schedules
- due-date indexes
- `claim_due_publish_schedule_items()` using `FOR UPDATE SKIP LOCKED` for atomic claim

RLS is enabled and no broad authenticated-table policy is added. Runtime access goes through server routes with service-role access after app auth/role checks.

### Create / list API

`GET/POST /api/publish-schedules`

- reviewer/admin only
- validates unique draft IDs, start date, daily limit, active weekdays
- uses existing deterministic schedule planner
- compensates by deleting group if item insert fails
- optional Shopify DRAFT staging is hard-gated by:
  `PUBLISH_SCHEDULE_STAGING_ENABLED=true`

Default is OFF.

### Due executor

`runDuePublishSchedules()`

- default behavior is dry-run when
  `PUBLISH_SCHEDULE_EXECUTION_ENABLED !== "true"`
- dry-run does not claim rows and does not send Shopify writes
- enabled mode uses atomic RPC claim
- blocks items when:
  - Shopify DRAFT staging is missing
  - Shopify product ID is missing/mock
  - sync state is dirty/syncing/conflict/error/partial/remote_deleted
- eligible items reuse existing `runPublishBatch(..., "active")`
- one item failure does not stop other items
- writes schedule-item result + publish batch ID
- refreshes group completed/failed counters

### Cron endpoint

`GET /api/cron/scheduled-publish`

- same Bearer `CRON_SECRET` pattern as existing cron routes
- no `vercel.json` schedule added yet
- therefore this branch cannot accidentally create a Production cron just by being merged later without an explicit Go-Live change

### Recovery controls

`PATCH /api/publish-schedules/[id]`

Actions:
- pause
- resume
- cancel
- retry_blocked

Retry resets blocked/failed items to queued and defaults to today's Asia/Taipei date.

## Three independent safety locks

1. `PUBLISH_SCHEDULE_DB_WRITE_ENABLED`
   - OFF by default
   - prevents schedule table mutations: create / pause / resume / cancel / retry / claim

2. `PUBLISH_SCHEDULE_STAGING_ENABLED`
   - OFF by default
   - prevents real Shopify DRAFT staging

3. `PUBLISH_SCHEDULE_EXECUTION_ENABLED`
   - OFF by default
   - prevents due-item claim + ACTIVE execution

Preview stays read-only/dry-run while DB_WRITE is OFF, even if another flag is misconfigured. All three Vercel env keys were confirmed absent on 2026-10-07.

## Final safety checkpoint — 2026-10-07

- Owner desktop ResultCard QA: PASS.
- Owner schedule UI QA: PASS.
- source migration filenames aligned to hosted ledger:
  - `20261006121816_publish_schedule_core.sql`
  - `20261006122416_shopify_full_sync_state.sql`
- production schedule tables remain empty (0 groups / 0 items).
- latest schedule-specific CI gate: PASS.
- Supabase Local Reconcile #124: PASS.
- latest Vercel branch build: READY.
- full CI remains red only because the separate copy-line verifier fails before typecheck/build.
- no Production merge, deploy, schedule row write, Cron registration, Shopify DRAFT, or Shopify ACTIVE was authorized by this package.

## Not done yet

- production schedule migration is already present in the hosted ledger; do not replay it
- `vercel.json` cron registration has NOT been added
- existing publish modal still shows Preview scheduler; it is not yet wired to POST selected draft IDs into the new API
- publishing-center schedule tab is still the Owner-approved Preview UI, not yet live DB data
- Online Store publication verification is not yet added; current existing publish lifecycle only confirms Shopify product status
- no Production/Shopify smoke test

These are deliberate safety gates, not hidden TODOs.

## Rollback

No Production rollback is authorized or required by this source package. Production schema is already present, but the schedule tables are empty and both runtime write flags remain off.

If rejected:
- close the Draft PR
- delete `agent/schedule-core-20261006`
- leave `agent/uiux2-preview-20260930` untouched
