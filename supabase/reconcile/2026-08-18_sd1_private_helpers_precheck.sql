-- SD-1 production PRECHECK candidate — read-only.
--
-- This file must succeed before any future production private-helper migration.
-- It does not mutate schema or data.

do $$
declare
  latest_version text;
  affected_policy_count integer;
  affected_table_count integer;
  existing_private_helpers integer;
  public_helper_count integer;
  public_helper_definer_count integer;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'SD-1 PRECHECK FAIL: migration ledger missing';
  end if;

  select max(version) into latest_version
  from supabase_migrations.schema_migrations;

  if latest_version is distinct from '20260818142919' then
    raise exception 'SD-1 PRECHECK FAIL: unexpected latest tracked migration %', latest_version;
  end if;

  -- Count any policy reference to the seven legacy helpers as long as it is NOT
  -- already a private.* reference. This accepts PostgreSQL rendering either
  -- `is_admin()` or `public.is_admin()` without weakening the state assertion.
  select count(*), count(distinct tablename)
    into affected_policy_count, affected_table_count
  from pg_policies
  where schemaname='public'
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
      '(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)\('
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) !~
      'private\.(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)';

  if affected_policy_count <> 35 or affected_table_count <> 19 then
    raise exception 'SD-1 PRECHECK FAIL: expected 35 affected policies / 19 tables, found % / %',
      affected_policy_count, affected_table_count;
  end if;

  select count(*) into public_helper_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'current_user_role','is_admin','is_reviewer',
      'user_owns_image_batch','user_owns_items_in_image_batch',
      'user_owns_publish_batch','user_owns_items_in_publish_batch'
    );

  select count(*) into public_helper_definer_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'current_user_role','is_admin','is_reviewer',
      'user_owns_image_batch','user_owns_items_in_image_batch',
      'user_owns_publish_batch','user_owns_items_in_publish_batch'
    )
    and p.prosecdef;

  if public_helper_count <> 7 or public_helper_definer_count <> 7 then
    raise exception 'SD-1 PRECHECK FAIL: expected 7 public SECURITY DEFINER RLS helpers, found % / % definers',
      public_helper_count, public_helper_definer_count;
  end if;

  if to_regnamespace('private') is null then
    existing_private_helpers := 0;
  else
    select count(*) into existing_private_helpers
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private'
      and p.proname in (
        'current_user_role','is_admin','is_reviewer',
        'user_owns_image_batch','user_owns_items_in_image_batch',
        'user_owns_publish_batch','user_owns_items_in_publish_batch'
      );
  end if;

  if existing_private_helpers <> 0 then
    raise exception 'SD-1 PRECHECK FAIL: private RLS helpers already exist (%); do not double-apply', existing_private_helpers;
  end if;

  if not has_function_privilege('authenticated','public.current_user_role()','EXECUTE')
     or not has_function_privilege('authenticated','public.is_admin()','EXECUTE')
     or not has_function_privilege('authenticated','public.is_reviewer()','EXECUTE') then
    raise exception 'SD-1 PRECHECK FAIL: legacy role-helper ACL changed since audit';
  end if;

  if not has_function_privilege('authenticated','public.requeue_revision_for_generation(uuid,text)','EXECUTE') then
    raise exception 'SD-1 PRECHECK FAIL: out-of-scope requeue RPC ACL changed since audit';
  end if;
end
$$;

select 'SD1_PRECHECK_OK' as status;
select
  (select count(*) from public.product_drafts) as product_drafts,
  (select count(*) from public.product_images) as product_images,
  (select count(*) from public.product_variants) as product_variants,
  (select count(*) from public.profiles) as profiles;
