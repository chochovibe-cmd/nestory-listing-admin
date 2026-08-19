-- Nestory production Supabase reconciliation draft — 2026-08-18
--
-- IMPORTANT:
--   1. THIS IS A REVIEW DRAFT, NOT A TRACKED MIGRATION.
--   2. It intentionally lives under supabase/reconcile/, NOT supabase/migrations/.
--   3. Production migration ledger is empty while live schema already reflects 001–039.
--      Do NOT run `supabase db push` against production from the current historical migration set.
--   4. Do NOT execute this file in production without explicit production-DB approval.
--
-- Evidence:
--   docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md
--   docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md
--
-- Active scope below is narrow and data-preserving:
--   - restore 8 missing catalog/rule RLS policies from migration 004
--   - pin search_path for 3 simple updated_at trigger functions
--   - remove direct PUBLIC/anon/authenticated EXECUTE from 2 repo-owned trigger
--     functions whose trigger behavior has been proven in free local Supabase CI
--
-- It does NOT:
--   - replay 001–039
--   - alter product/business data
--   - change role semantics
--   - disable RLS
--   - modify migration history
--   - revoke RLS helper EXECUTE privileges
--   - modify hosted-only public.rls_auto_enable()

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

-- ---------------------------------------------------------------------------
-- A3. Remove direct client EXECUTE from repo-owned trigger-only SECURITY DEFINER
-- functions. Their trigger behavior has been runtime-tested after this revoke in
-- the free local Supabase gate. Keep service_role explicit; owner/postgres retains
-- owner capability. Do NOT apply the same pattern blindly to RLS helper functions.
-- ---------------------------------------------------------------------------

revoke execute on function public.guard_sensitive_product_draft_fields()
  from public, anon, authenticated;
grant execute on function public.guard_sensitive_product_draft_fields()
  to service_role;

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
grant execute on function public.handle_new_user()
  to service_role;

commit;

-- ---------------------------------------------------------------------------
-- POST-APPLY READ-ONLY VALIDATION
-- ---------------------------------------------------------------------------
--
-- 1. Exactly 2 policies should exist on each catalog/rule table:
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
-- 3. Direct client EXECUTE should be false for the 2 repo trigger functions,
-- while authenticated RLS helpers remain executable:
--
-- select
--   has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
--     as authenticated_handle_new_user,
--   has_function_privilege('authenticated', 'public.guard_sensitive_product_draft_fields()', 'EXECUTE')
--     as authenticated_sensitive_guard,
--   has_function_privilege('authenticated', 'public.current_user_role()', 'EXECUTE')
--     as authenticated_current_user_role,
--   has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
--     as authenticated_is_admin,
--   has_function_privilege('authenticated', 'public.is_reviewer()', 'EXECUTE')
--     as authenticated_is_reviewer;
--
-- Expected: false, false, true, true, true.
--
-- 4. Runtime/RLS proof:
-- docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md

-- ---------------------------------------------------------------------------
-- PHASE B — HOSTED-ONLY / ARCHITECTURAL HARDENING (INTENTIONALLY NOT ACTIVE)
-- ---------------------------------------------------------------------------
--
-- public.rls_auto_enable()
-- ------------------------
-- Production contains this SECURITY DEFINER event-trigger helper and exposes
-- EXECUTE through PUBLIC. The free local Supabase stack used by CI does NOT
-- create this hosted-only helper, so we cannot honestly claim local runtime
-- proof for changing its ACL.
--
-- Therefore this draft intentionally does NOT alter public.rls_auto_enable().
-- Revisit only with a safe hosted-compatible proof path; do not change it merely
-- to silence Security Advisor.
--
-- RLS helper functions are intentionally NOT revoke candidates here:
--   current_user_role()
--   is_admin()
--   is_reviewer()
--   user_owns_*_batch(...)
--
-- They are called by RLS policies. A separate architectural hardening can move
-- RLS-only SECURITY DEFINER helpers into a private, non-exposed schema and update
-- policies to call them schema-qualified. That is not part of this minimal repair.
