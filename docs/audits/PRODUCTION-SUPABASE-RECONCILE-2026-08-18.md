# Production Supabase Reconcile — 2026-08-18

> Scope: read-only reconciliation of the Supabase project actually used by this repo.
> No production DDL/DML was executed in this audit. All database checks were metadata/read queries only.

## Target

- Supabase project: `nestory-listing-tool-test`
- project ref: `tbgtqwvuohmdxnxisrgr`
- region: `ap-southeast-2`
- Postgres: 17.6.x
- Repo comparison head: `agent/ci-gate` (`b935290`)
- Reconcile planning branch: `agent/supabase-reconcile-plan`

## Important interpretation rule

Supabase's migration ledger is **empty** even though the live database contains late Nestory schema/data.

Therefore the matrix below does **not** mean Supabase officially recorded migrations `001–039` as applied. It means the **current live end-state matches the intended result** of each repo SQL file based on tables, columns, constraints, indexes, functions, policies, grants and representative seed data.

Never use this matrix as permission to replay historical migrations.

### Legend

- ✅ **End-state present** — live DB materially matches the migration's intended result.
- 🟡 **Partial / drifted** — some intended state exists but a meaningful part is missing.
- ↪️ **Superseded** — historical migration was later intentionally replaced; live DB matches the newer canonical state.

## Executive summary

The live DB is best described as:

> **late-stage schema + mostly applied data seeds + one confirmed catalog-policy drift + security hardening debt**

Key conclusion:

- `001–039` are **not broadly missing**.
- Almost all final schema/data effects are visible in production.
- The one clear schema/authorization drift is migration `004`: all four catalog/rule tables exist with RLS enabled, but **all 8 intended policies are missing**.
- Security Advisor / function introspection also show direct EXECUTE and search-path hardening work that should be handled in a new reconciliation migration, not by replaying old SQL.

## Migration-by-migration reconciliation

| # | Migration | Live verdict | Evidence / interpretation | Reconcile action |
|---|---|---|---|---|
| 001 | `001_initial_schema.sql` | ✅ End-state present | Core enums are exact (`admin/operator/reviewer`, draft/generation/publish enums); core tables, role helpers, queue/requeue functions, RLS foundation and storage foundation exist. | Do not replay. |
| 002 | `002_runtime_flow_patch.sql` | ✅ End-state present | Runtime worker/shopify columns exist; `product-images` bucket is public, 10 MB, jpeg/png/webp/gif; public-read storage policy exists; claim/requeue functions exist with expected scope. | Do not replay. |
| 003 | `003_runtime_permissions_patch.sql` | ✅ End-state present | Expected authenticated/service-role table/function access is present; claim RPC remains service-role only. | Do not replay. Review excess function EXECUTE separately. |
| 004 | `004_ip_tag_collection_tables.sql` | 🟡 **Partial / drifted** | `ip_catalog`, `ip_characters`, `tag_rules`, `collection_rules`, constraints, indexes/triggers, RLS enabled and grants exist. **But policy count is 0 on all four tables.** Migration intended 2 policies each = 8 total. | **Restore the 8 intended policies in new reconciliation migration.** |
| 005 | `005_phase2_columns.sql` | ✅ End-state present | Sale/image/secondhand/IP/highlight/video fields exist; image-status constraint exists; guard function still includes `image_status`. | Do not replay. |
| 006 | `006_team_settings.sql` | ✅ End-state present | `team_settings` exists with authenticated-read/admin-write policies; `low_price_tag_threshold = 300` seed exists. | Do not replay. |
| 007 | `007_generation_history.sql` | ✅ End-state present | Table, draft/field index and read/insert RLS policies exist; live table contains history rows. | Do not replay. |
| 008 | `008_regrant_service_role.sql` | ✅ End-state present | Service-role privileges on catalog/settings/history tables and authenticated catalog SELECT grants are present. | Do not replay. |
| 009 | `009_sale_status_realign.sql` | ↪️ Superseded by 010 | Intermediate labels are no longer canonical. | Do not replay. |
| 010 | `010_sale_status_canonical.sql` | ✅ End-state present | Exact check constraint values are live: `海外代購（約14天） / 台灣現貨 / 預購中 / 二手現貨`; default is `海外代購（約14天）`. | Do not replay. |
| 011 | `011_result_card_fields.sql` | ✅ End-state present | `generated_faq_html`, `compare_at_price`, `detected_category`, `sku` exist; `pricing_defaults.compareAtMultiplier = 1.8` seed exists. | Do not replay. |
| 012 | `012_source_platform.sql` | ✅ End-state present | `product_drafts.source_platform` exists. | Do not replay. |
| 013 | `013_product_images_delete_policy.sql` | ✅ End-state present | Product-image DELETE policy and storage-object owner DELETE policy both exist. | Do not replay. |
| 014 | `014_status_timestamps_and_usage.sql` | ✅ End-state present | `copy_generated_at`, `reviewed_at`, `published_at`, generation token counts and expected indexes exist. | Do not replay. |
| 015 | `015_vendor_default_fix.sql` | ✅ End-state present | Vendor default is `潮巢 Nestory`; live count of legacy exact `CHOCHONEST` rows is 0. | Do not replay. |
| 016 | `016_scenario_keywords.sql` | ✅ End-state present | `scenario_keywords_by_type` live seed matches the reviewed dictionary. | Do not replay. |
| 017 | `017_internal_link_urls.sql` | ✅ End-state present | `internal_link_urls_by_ip` exists as `{}`. | Do not replay. |
| 018 | `018_draft_inventory_policy.sql` | ✅ End-state present | Draft inventory fields/checks exist; variant `inventory_policy` default is `continue`. | Do not replay. |
| 019 | `019_image_process_marks.sql` | ↪️ Base end-state present; constraint superseded by 030 | `process_intent` and `is_spec_process` exist; original 3-value constraint was intentionally expanded later. | Do not replay. |
| 020 | `020_price_mode.sql` | ✅ End-state present | `price_mode` exists with exact `sale/single` constraint. | Do not replay. |
| 021 | `021_ip_characters_pending.sql` | ✅ End-state present | `review_status`, `created_by`, pending/approved constraint and pending index exist. | Do not replay. |
| 022 | `022_variant_dimensions_and_lock.sql` | ✅ End-state present | Draft `variant_dimensions`; variant `compare_at_price`, `price_locked`, `sort_order` all exist. | Do not replay. |
| 023 | `023_web_search_cache_and_ip_tone.sql` | ✅ End-state present | `web_search_cache` exists; `ip_tone_map_overrides = {}` seed exists. | Do not replay. |
| 024 | `024_draft_archive_restore.sql` | ✅ End-state present | `status_before_archive`, `archived_at` and archive partial index exist. | Do not replay. |
| 025 | `025_image_batches.sql` | ✅ Structure present; SELECT policy superseded by 028 | Image batch/header/item tables, pointer, indexes and trigger exist; live DB already uses the 028 non-recursive policy form. | Do not replay 025 policies. |
| 026 | `026_system_prompt_versions.sql` | ✅ End-state present | Table/index/RLS policies exist; `system_prompt_active_version` placeholder seed exists. Zero version rows is valid because migration only created skeleton. | Do not replay. |
| 027 | `027_publish_batches.sql` | ✅ Structure present; SELECT policy superseded by 028 | Publish batch/header/item tables, pointer, indexes and trigger exist; live DB uses the 028 helper-based policy form. | Do not replay 027 policies. |
| 028 | `028_fix_publish_batches_rls_recursion.sql` | ✅ End-state present | All four ownership helper functions exist; image/publish batch SELECT policies call the helpers and no longer use the recursive 025/027 form. | Keep current policy semantics. |
| 029 | `029_pipeline_stage.sql` | ✅ End-state present | Column is NOT NULL/default `input`, exact 6-value check and work index exist; live invalid/null row counts are both 0. | Do not replay. |
| 030 | `030_process_intent_to_trad.sql` | ✅ End-state present | Live check allows exactly `keep/de_text/regenerate/to_trad` plus null. | Do not replay. |
| 031 | `031_product_brand.sql` | ✅ End-state present | `product_brand` exists. | Do not replay. |
| 032 | `032_ip_catalog_v3_100_ips.sql` | ✅ End-state strongly matched | Live catalog has 151 active IP rows / 748 characters. Representative V3 seeds and aliases exist across early/middle/late groups: Miffy, legacy-mapped 史努比/嚕嚕米/飛天小女警, Line Dog, THE MONSTERS; representative characters Miffy/Snoopy/Blossom/Bubbles/Buttercup/Line Dog/Labubu also exist. Lower legacy sort orders are expected because 032 deliberately preserves the smaller existing sort order. | Treat as applied end-state; no replay. |
| 033 | `033_tag_rules_sync_boss_tool.sql` | ✅ End-state strongly matched | Exact representative rows exist: 大型娃娃, disabled 棉花娃娃, 布丁狗, 外出小物, SS級. Live 吉伊卡哇 catalog contains the expected 15 localized characters in expected order. | Do not replay wholesale. |
| 034 | `034_generation_tone.sql` | ✅ End-state present | `generation_tone` exists. | Do not replay. |
| 035 | `035_publish_batches_csv_kinds.sql` | ✅ End-state present | Live `publish_batches_kind_check` allows `shopify_api/showmore/matrixify`. | Do not replay. |
| 036 | `036_capture_token_and_raw_capture.sql` | ✅ End-state present | Profile capture-token fields + unique partial index and draft `raw_capture` exist. | Do not replay. |
| 037 | `037_tag_rules_p3_product_types.sql` | ✅ End-state present | All 8 normal/secondhand rules exist with exact expected active state/sort orders for 滑鼠、鍵盤、手把控制器、保溫杯瓶. | Do not replay. |
| 038 | `038_ip_knowledge_pack.sql` | ✅ End-state present | `knowledge_pack` exists; live count of non-null packs is exactly 21, matching Top21 seed intent. | Do not replay. |
| 039 | `039_image_dual_size_urls.sql` | ✅ End-state present | `list_thumb_url` and `vision_mid_url` both exist on product_images. | Do not replay. |

## What this matrix means in plain language

The production database is **not missing 39 updates**.

It appears the historical SQL was mostly applied manually, but Supabase never received a proper migration-history ledger. The correct repair is therefore **not** to rerun everything. We should preserve the working live schema and create one new, narrowly scoped reconciliation change for the actual drift we can prove.

## Confirmed production drift to fix

### 1. Migration 004 catalog/rule RLS policies — confirmed missing

RLS is ON, grants exist, but policies are missing on:

- `public.ip_catalog`
- `public.ip_characters`
- `public.tag_rules`
- `public.collection_rules`

Migration 004 intended these policies:

- authenticated SELECT: active rows, plus admin may see inactive rows
- admin-only ALL/write

That is **8 policies total** and production currently has **0**.

This is the strongest, least ambiguous reconciliation target.

### 2. SECURITY DEFINER / direct RPC surface — hardening required, but do not blind-revoke

Current live function introspection shows:

- `claim_pending_generation(...)`: EXECUTE only service_role — good.
- `requeue_revision_for_generation(...)`: authenticated + service_role — intentional app RPC.
- RLS helpers (`current_user_role`, `is_admin`, `is_reviewer`, batch ownership helpers): used by policies and must keep whatever execution capability policy evaluation requires.
- trigger/event-trigger functions such as `guard_sensitive_product_draft_fields`, `handle_new_user`, `rls_auto_enable`: currently also directly executable by client roles; these are candidates for direct-RPC hardening.

Do **not** revoke all SECURITY DEFINER functions as one batch. The RLS helper functions are part of access control and must be tested before any privilege change.

### 3. Trigger function search_path hardening

These live functions have no explicit function-level `search_path` config:

- `set_updated_at()`
- `touch_image_batches_updated_at()`
- `touch_publish_batches_updated_at()`

They should receive an explicit safe search path in a future tested reconciliation migration.

### 4. Supabase Auth leaked-password protection

Still disabled. This is a project Auth setting rather than a SQL migration. Enable before broader team onboarding.

## Confirmed good live data/state

At audit time:

- product drafts: 32
- product images: 147
- product variants: 143
- generation history: 297
- IP catalog: 151 active rows
- IP characters: 748
- tag rules: 129
- collection rules: 0 (table exists; 004 did not require seed rows)
- image batches: 1
- publish batches: 1
- system prompt versions: 0 (valid skeleton state)

Production profiles previously verified:
- admin: 1
- operator: 0
- reviewer: 0

## Proposed next implementation — still NOT production apply

Create one new reconciliation migration draft based on current live state. Do not replay historical SQL and do not fake migration ledger rows.

### Proposed scope

1. Restore the 8 missing migration-004 policies idempotently.
2. Add explicit safe `search_path` configuration to the three flagged timestamp trigger helpers.
3. Review/revoke unnecessary direct client EXECUTE only for trigger/event-trigger functions after proving trigger behavior is unaffected.
4. Preserve authenticated access required by RLS helper functions.
5. Do not change `admin | operator | reviewer` role semantics.
6. Do not alter product data.

### Required test matrix before production apply

- authenticated operator can read active IP/tag/collection catalog data as intended
- operator cannot directly write admin-governed catalog/rule rows
- admin can read inactive rows and manage catalogs
- operator own-draft read/update remains correct
- reviewer/admin cross-team access remains correct
- batch archive owner/reviewer behavior remains correct
- image/publish batch reads do not regress into RLS recursion (`42P17`)
- auth new-user trigger still creates operator profile
- draft sensitive-field trigger still executes
- timestamp triggers still update `updated_at`
- rerun Supabase Security Advisor
- app CI remains green

## Supabase development branch note

At reconciliation time, the project has **no Supabase development branches**. Creating one has a cost and requires explicit user cost confirmation. Do not create one automatically.

## Do not do

- **Do not replay `001–039`.**
- Do not manufacture/fake Supabase migration-history rows.
- Do not disable RLS to make catalog data readable.
- Do not give operator publish rights as part of reconciliation.
- Do not blindly revoke authenticated EXECUTE from RLS helpers.
- Do not alter live product data as part of security reconciliation.
- Do not merge/deploy this planning branch without explicit user approval.

## Next agent handoff

Read this file before any production Supabase DDL.

Current state:

> **001–039 live-state reconciliation complete; production unchanged.**

The next safe task is to draft the minimal new reconciliation migration on a Git branch, review its exact SQL/test plan, and only then decide how to test/apply it outside production.