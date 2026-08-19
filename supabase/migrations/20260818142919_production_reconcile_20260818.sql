-- Nestory production reconciliation — tracked migration applied 2026-08-18.
-- Production version: 20260818142919
--
-- Scope was prechecked and locally proven reversible before production apply.
-- Historical migrations 001–039 predate migration tracking and must not be replayed.

begin;

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

alter function public.set_updated_at()
  set search_path = pg_catalog;

alter function public.touch_image_batches_updated_at()
  set search_path = pg_catalog;

alter function public.touch_publish_batches_updated_at()
  set search_path = pg_catalog;

revoke execute on function public.guard_sensitive_product_draft_fields()
  from public, anon, authenticated;
grant execute on function public.guard_sensitive_product_draft_fields()
  to service_role;

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
grant execute on function public.handle_new_user()
  to service_role;

commit;
