-- Nestory production Supabase ROLLBACK REFERENCE — 2026-08-18
--
-- IMPORTANT AFTER MIGRATION TRACKING STARTED:
--   Production reconcile is now tracked as migration 20260818142919.
--   DO NOT run this file manually in production by itself. Doing so would
--   revert schema state while leaving the migration ledger inconsistent.
--
-- This file is retained as the locally proven inverse-SQL reference for ONLY
-- the changes in the 2026-08-18 reconcile. If a production revert is ever
-- required, create/test/apply a NEW tracked forward revert migration using
-- these inverse operations, then run postchecks. Never delete/fake ledger rows.
--
-- The inverse deliberately restores the audited pre-reconcile state, including
-- zero catalog/rule policies and the prior trigger-function EXECUTE surface.
-- It does not modify product/business rows.

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
