-- Nestory production Supabase APPLY — 2026-08-18
--
-- DO NOT EXECUTE unless:
--   1. 2026-08-18_production_precheck.sql passed on the target production DB;
--   2. free local apply/rollback tests are green;
--   3. the user explicitly approved production DB modification.
--
-- Target audited project: nestory-listing-tool-test / tbgtqwvuohmdxnxisrgr
-- This package does NOT replay 001–039 and does NOT modify product/business data.

begin;

-- A1. Restore the 8 missing migration-004 catalog/rule RLS policies.

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

-- A2. Harden the 3 simple timestamp trigger helpers.

alter function public.set_updated_at()
  set search_path = pg_catalog;

alter function public.touch_image_batches_updated_at()
  set search_path = pg_catalog;

alter function public.touch_publish_batches_updated_at()
  set search_path = pg_catalog;

-- A3. Remove direct client EXECUTE from repo-owned trigger-only functions.
-- Local runtime proof shows the triggers continue to execute after this change.

revoke execute on function public.guard_sensitive_product_draft_fields()
  from public, anon, authenticated;
grant execute on function public.guard_sensitive_product_draft_fields()
  to service_role;

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
grant execute on function public.handle_new_user()
  to service_role;

-- Intentionally unchanged:
--   public.current_user_role()
--   public.is_admin()
--   public.is_reviewer()
--   public.user_owns_*_batch(...)
--   public.rls_auto_enable()  -- hosted-only; no free-local runtime proof

commit;
