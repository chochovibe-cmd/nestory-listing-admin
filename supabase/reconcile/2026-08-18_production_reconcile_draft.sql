-- Nestory production Supabase reconciliation draft — 2026-08-18
--
-- IMPORTANT:
--   1. THIS IS A REVIEW DRAFT, NOT A TRACKED MIGRATION.
--   2. It intentionally lives under supabase/reconcile/, NOT supabase/migrations/.
--   3. Production migration ledger is empty while live schema already reflects 001–039.
--      Do NOT run `supabase db push` against production from the current historical migration set.
--   4. Do NOT execute this file in production until an isolated test path is approved.
--
-- Evidence source:
--   docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md
--
-- Phase A below contains only confirmed, narrow, data-preserving drift fixes:
--   - restore 8 missing catalog/rule RLS policies from migration 004
--   - pin search_path for 3 simple updated_at trigger functions
--
-- It does NOT:
--   - replay 001–039
--   - alter product/business data
--   - change role semantics
--   - disable RLS
--   - modify migration history
--   - revoke SECURITY DEFINER helper EXECUTE privileges yet

begin;

-- ---------------------------------------------------------------------------
-- A1. Restore catalog/rule policies that migration 004 intended.
-- Live state on 2026-08-18: RLS enabled + grants present + ZERO policies.
-- ---------------------------------------------------------------------------

-- ip_catalog ---------------------------------------------------------------
drop policy if exists ip_catalog_select_authenticated on public.ip_catalog;
create policy ip_catalog_select_authenticated
on public.ip_catalog
for select
to authenticated
using (is_active = true or public.is_admin());

drop policy if exists ip_catalog_write_admin on public.ip_catalog;
create policy ip_catalog_write_admin
on public.ip_catalog
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ip_characters ------------------------------------------------------------
drop policy if exists ip_characters_select_authenticated on public.ip_characters;
create policy ip_characters_select_authenticated
on public.ip_characters
for select
to authenticated
using (is_active = true or public.is_admin());

drop policy if exists ip_characters_write_admin on public.ip_characters;
create policy ip_characters_write_admin
on public.ip_characters
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- tag_rules ----------------------------------------------------------------
drop policy if exists tag_rules_select_authenticated on public.tag_rules;
create policy tag_rules_select_authenticated
on public.tag_rules
for select
to authenticated
using (is_active = true or public.is_admin());

drop policy if exists tag_rules_write_admin on public.tag_rules;
create policy tag_rules_write_admin
on public.tag_rules
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- collection_rules ---------------------------------------------------------
drop policy if exists collection_rules_select_authenticated on public.collection_rules;
create policy collection_rules_select_authenticated
on public.collection_rules
for select
to authenticated
using (is_active = true or public.is_admin());

drop policy if exists collection_rules_write_admin on public.collection_rules;
create policy collection_rules_write_admin
on public.collection_rules
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- A2. Pin search_path for simple timestamp trigger helpers.
-- These functions only assign NEW.updated_at = now(); no public relation lookup
-- is required, so pg_catalog is sufficient and avoids a mutable search_path.
-- ---------------------------------------------------------------------------

alter function public.set_updated_at()
  set search_path = pg_catalog;

alter function public.touch_image_batches_updated_at()
  set search_path = pg_catalog;

alter function public.touch_publish_batches_updated_at()
  set search_path = pg_catalog;

commit;

-- ---------------------------------------------------------------------------
-- POST-APPLY READ-ONLY VALIDATION (run only in isolated test environment first)
-- ---------------------------------------------------------------------------
--
-- 1. Exactly 2 policies should exist on each table:
--
-- select tablename, policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('ip_catalog','ip_characters','tag_rules','collection_rules')
-- order by tablename, policyname;
--
-- 2. Function-level config should show search_path=pg_catalog:
--
-- select p.proname, p.proconfig
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in (
--     'set_updated_at',
--     'touch_image_batches_updated_at',
--     'touch_publish_batches_updated_at'
--   )
-- order by p.proname;
--
-- 3. Runtime/RLS test matrix is documented in:
-- docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md

-- ---------------------------------------------------------------------------
-- PHASE B — SECURITY DEFINER direct-RPC hardening (INTENTIONALLY NOT ACTIVE)
-- ---------------------------------------------------------------------------
--
-- Supabase advises granting EXECUTE only to roles that need to CALL a function,
-- and notes that SECURITY DEFINER helpers used inside RLS policies do not need
-- to be exposed through the Data API schema.
--
-- Current live candidates that appear to be trigger/event-trigger-only:
--   public.guard_sensitive_product_draft_fields()
--   public.handle_new_user()
--   public.rls_auto_enable()
--
-- DO NOT uncomment these until tested in an isolated Supabase branch/database:
--
-- revoke execute on function public.guard_sensitive_product_draft_fields()
--   from public, anon, authenticated;
-- revoke execute on function public.handle_new_user()
--   from public, anon, authenticated;
-- revoke execute on function public.rls_auto_enable()
--   from public, anon, authenticated;
--
-- Required proof before enabling:
--   - inserting auth.users still fires handle_new_user and creates operator profile
--   - product_drafts sensitive-field trigger still fires for authenticated DML
--   - rls_auto_enable event trigger still performs its intended DDL protection
--   - Supabase Security Advisor warnings improve without functional regressions
--
-- RLS helper functions are intentionally NOT revoke candidates in this draft:
--   current_user_role()
--   is_admin()
--   is_reviewer()
--   user_owns_*_batch(...)
--
-- Long-term hardening can move RLS-only SECURITY DEFINER helpers into a private,
-- non-exposed schema and update policies to call them schema-qualified. That is
-- a separate architectural migration, not part of this minimal reconciliation.
