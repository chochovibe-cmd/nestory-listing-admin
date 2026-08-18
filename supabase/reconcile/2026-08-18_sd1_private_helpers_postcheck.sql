-- SD-1 production POSTCHECK candidate — read-only.
-- Run immediately after any future tracked SD-1 migration.

do $$
declare
  private_fn_count integer;
  private_policy_count integer;
  explicit_public_policy_count integer;
  unqualified_legacy_policy_count integer;
  bad_private_search_path integer;
  event_trigger_count integer;
begin
  if to_regnamespace('private') is null then
    raise exception 'SD-1 POSTCHECK FAIL: private schema missing';
  end if;

  select count(*) into private_fn_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.proname in (
      'current_user_role','is_admin','is_reviewer',
      'user_owns_image_batch','user_owns_items_in_image_batch',
      'user_owns_publish_batch','user_owns_items_in_publish_batch'
    );
  if private_fn_count <> 7 then
    raise exception 'SD-1 POSTCHECK FAIL: expected 7 private helpers, got %', private_fn_count;
  end if;

  select count(*) into private_policy_count
  from pg_policies
  where schemaname='public'
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
      'private\.(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)';
  if private_policy_count <> 35 then
    raise exception 'SD-1 POSTCHECK FAIL: expected 35 private-helper policies, got %', private_policy_count;
  end if;

  select count(*) into explicit_public_policy_count
  from pg_policies
  where schemaname='public'
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
      'public\.(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)';
  if explicit_public_policy_count <> 0 then
    raise exception 'SD-1 POSTCHECK FAIL: % policies still call explicit public helpers', explicit_public_policy_count;
  end if;

  select count(*) into unqualified_legacy_policy_count
  from pg_policies
  where schemaname='public'
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
      '(^|[^[:alnum:]_.])(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)\(';
  if unqualified_legacy_policy_count <> 0 then
    raise exception 'SD-1 POSTCHECK FAIL: % policies still call unqualified legacy helpers', unqualified_legacy_policy_count;
  end if;

  select count(*) into bad_private_search_path
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.proname in (
      'current_user_role','is_admin','is_reviewer',
      'user_owns_image_batch','user_owns_items_in_image_batch',
      'user_owns_publish_batch','user_owns_items_in_publish_batch'
    )
    and not ('search_path=pg_catalog' = any(coalesce(p.proconfig, '{}'::text[])));
  if bad_private_search_path <> 0 then
    raise exception 'SD-1 POSTCHECK FAIL: % private helpers lack fixed pg_catalog search_path', bad_private_search_path;
  end if;

  if has_schema_privilege('anon','private','USAGE') then
    raise exception 'SD-1 POSTCHECK FAIL: anon unexpectedly has private schema usage';
  end if;
  if not has_schema_privilege('authenticated','private','USAGE') then
    raise exception 'SD-1 POSTCHECK FAIL: authenticated cannot evaluate private RLS helpers';
  end if;

  if has_function_privilege('authenticated','public.current_user_role()','EXECUTE')
     or has_function_privilege('authenticated','public.is_admin()','EXECUTE')
     or has_function_privilege('authenticated','public.is_reviewer()','EXECUTE')
     or has_function_privilege('authenticated','public.user_owns_image_batch(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.user_owns_items_in_image_batch(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.user_owns_publish_batch(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.user_owns_items_in_publish_batch(uuid)','EXECUTE') then
    raise exception 'SD-1 POSTCHECK FAIL: authenticated still has direct EXECUTE on a legacy public RLS helper';
  end if;

  if not has_function_privilege('authenticated','public.requeue_revision_for_generation(uuid,text)','EXECUTE') then
    raise exception 'SD-1 POSTCHECK FAIL: out-of-scope requeue RPC was changed';
  end if;

  select count(*) into event_trigger_count
  from pg_event_trigger e
  join pg_proc p on p.oid=e.evtfoid
  join pg_namespace n on n.oid=p.pronamespace
  where e.evtname='ensure_rls'
    and p.proname='rls_auto_enable'
    and n.nspname='public';

  -- Hosted Supabase has this object; free local stack may not. Do not fail when
  -- absent locally, but if it exists it must remain untouched and attached.
  if to_regprocedure('public.rls_auto_enable()') is not null and event_trigger_count <> 1 then
    raise exception 'SD-1 POSTCHECK FAIL: hosted ensure_rls event-trigger binding changed';
  end if;
end
$$;

select 'SD1_POSTCHECK_OK' as status;
select
  (select count(*) from public.product_drafts) as product_drafts,
  (select count(*) from public.product_images) as product_images,
  (select count(*) from public.product_variants) as product_variants,
  (select count(*) from public.profiles) as profiles;
