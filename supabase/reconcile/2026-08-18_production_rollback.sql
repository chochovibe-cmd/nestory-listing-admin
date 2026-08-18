-- Nestory production Supabase ROLLBACK — 2026-08-18
--
-- Emergency rollback for ONLY the changes in 2026-08-18_production_apply.sql.
-- It deliberately restores the audited pre-reconcile state, including the
-- missing catalog/rule policies and the prior direct trigger-function EXECUTE
-- surface. It does NOT modify product/business rows or migration history.
--
-- Use only if post-apply validation fails and rollback is explicitly chosen.

begin;

-- R1. Return the four catalog/rule tables to the audited pre-state: zero policies.

drop policy if exists ip_catalog_select_authenticated on public.ip_catalog;
drop policy if exists ip_catalog_write_admin on public.ip_catalog;
drop policy if exists ip_characters_select_authenticated on public.ip_characters;
drop policy if exists ip_characters_write_admin on public.ip_characters;
drop policy if exists tag_rules_select_authenticated on public.tag_rules;
drop policy if exists tag_rules_write_admin on public.tag_rules;
drop policy if exists collection_rules_select_authenticated on public.collection_rules;
drop policy if exists collection_rules_write_admin on public.collection_rules;

-- R2. Restore timestamp helper function config to the audited pre-state
-- (no function-level search_path setting).

alter function public.set_updated_at()
  reset search_path;

alter function public.touch_image_batches_updated_at()
  reset search_path;

alter function public.touch_publish_batches_updated_at()
  reset search_path;

-- R3. Restore the prior PUBLIC direct EXECUTE surface on the two trigger-only
-- functions. PUBLIC covers anon/authenticated; service_role remains explicit.

grant execute on function public.guard_sensitive_product_draft_fields()
  to public, service_role;

grant execute on function public.handle_new_user()
  to public, service_role;

commit;
