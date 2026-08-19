-- Nestory production Supabase POSTCHECK — 2026-08-18
-- READ/CHECK ONLY after 2026-08-18_production_apply.sql.
-- Any exception = treat apply as not validated; investigate or use reviewed rollback.

do $$
declare
  t text;
  policy_count integer;
  bad_search_path integer;
  role_labels text[];
begin
  -- Canonical role model must remain unchanged.
  select array_agg(e.enumlabel order by e.enumsortorder)
    into role_labels
  from pg_type ty
  join pg_namespace n on n.oid = ty.typnamespace
  join pg_enum e on e.enumtypid = ty.oid
  where n.nspname = 'public'
    and ty.typname = 'user_role';

  if role_labels is distinct from array['admin','operator','reviewer']::text[] then
    raise exception 'POSTCHECK FAIL: public.user_role changed; found %', role_labels;
  end if;

  -- Each repaired table must have RLS ON and exactly the two intended policies.
  foreach t in array array['ip_catalog','ip_characters','tag_rules','collection_rules'] loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = t
        and c.relrowsecurity
    ) then
      raise exception 'POSTCHECK FAIL: RLS is not enabled on public.%', t;
    end if;

    select count(*) into policy_count
    from pg_policies
    where schemaname = 'public'
      and tablename = t;

    if policy_count <> 2 then
      raise exception 'POSTCHECK FAIL: public.% expected exactly 2 policies, found %', t, policy_count;
    end if;
  end loop;

  -- Exact policy names must all exist.
  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'ip_catalog_select_authenticated',
      'ip_catalog_write_admin',
      'ip_characters_select_authenticated',
      'ip_characters_write_admin',
      'tag_rules_select_authenticated',
      'tag_rules_write_admin',
      'collection_rules_select_authenticated',
      'collection_rules_write_admin'
    );

  if policy_count <> 8 then
    raise exception 'POSTCHECK FAIL: expected all 8 intended policy names, found %', policy_count;
  end if;

  -- All 3 timestamp helpers must pin pg_catalog.
  select count(*) into bad_search_path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'set_updated_at',
      'touch_image_batches_updated_at',
      'touch_publish_batches_updated_at'
    )
    and not ('search_path=pg_catalog' = any(coalesce(p.proconfig, '{}'::text[])));

  if bad_search_path <> 0 then
    raise exception 'POSTCHECK FAIL: % timestamp helper(s) are missing search_path=pg_catalog', bad_search_path;
  end if;

  -- Trigger-only functions must no longer be directly client-callable.
  if has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
     or has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_sensitive_product_draft_fields()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_sensitive_product_draft_fields()', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: trigger-only function still has direct client EXECUTE';
  end if;

  if not has_function_privilege('service_role', 'public.handle_new_user()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.guard_sensitive_product_draft_fields()', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: service_role lost trigger-function EXECUTE';
  end if;

  -- RLS helpers must remain callable by authenticated policy evaluation.
  if not has_function_privilege('authenticated', 'public.current_user_role()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_reviewer()', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: authenticated RLS helper execution was changed';
  end if;

  -- Trigger wiring must remain present.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='auth' and c.relname='users'
      and t.tgname='on_auth_user_created'
  ) then
    raise exception 'POSTCHECK FAIL: on_auth_user_created trigger missing';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='public' and c.relname='product_drafts'
      and t.tgname='product_drafts_guard_sensitive_fields'
  ) then
    raise exception 'POSTCHECK FAIL: sensitive-field trigger missing';
  end if;
end
$$;

select
  'POSTCHECK_OK' as status,
  (select count(*) from public.product_drafts) as product_draft_rows,
  (select count(*) from public.product_images) as product_image_rows,
  (select count(*) from public.product_variants) as product_variant_rows,
  (select count(*) from public.profiles) as profile_rows;
