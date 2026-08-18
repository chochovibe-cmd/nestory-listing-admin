-- Nestory production Supabase PRE-APPLY CHECK RECORD — 2026-08-18
-- READ/CHECK ONLY. This describes the audited PRE-RECONCILE state.
--
-- Production has since been successfully reconciled and migration tracking now
-- contains 20260818142712 + 20260818142919. Therefore this historical precheck
-- is EXPECTED TO FAIL after the successful apply (for example, policies now
-- exist and search_path is hardened). Do not use that expected failure as a
-- reason to roll back or rewrite the current production state.
--
-- Retained as evidence of the exact gate that passed immediately before apply.
-- Target: nestory-listing-tool-test / tbgtqwvuohmdxnxisrgr

do $$
declare
  t text;
  rls_enabled boolean;
  policy_total integer;
  role_labels text[];
  already_hardened integer;
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into role_labels
  from pg_type ty
  join pg_namespace n on n.oid = ty.typnamespace
  join pg_enum e on e.enumtypid = ty.oid
  where n.nspname = 'public'
    and ty.typname = 'user_role';

  if role_labels is distinct from array['admin','operator','reviewer']::text[] then
    raise exception 'PRECHECK FAIL: public.user_role changed; found %', role_labels;
  end if;

  foreach t in array array['ip_catalog','ip_characters','tag_rules','collection_rules'] loop
    if to_regclass(format('public.%I', t)) is null then
      raise exception 'PRECHECK FAIL: missing table public.%', t;
    end if;

    select c.relrowsecurity
      into rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = t;

    if coalesce(rls_enabled, false) is not true then
      raise exception 'PRECHECK FAIL: RLS is not enabled on public.%', t;
    end if;
  end loop;

  select count(*)
    into policy_total
  from pg_policies
  where schemaname = 'public'
    and tablename in ('ip_catalog','ip_characters','tag_rules','collection_rules');

  if policy_total <> 0 then
    raise exception 'PRECHECK FAIL: expected 0 catalog/rule policies before apply, found %. Re-audit live DB.', policy_total;
  end if;

  if to_regprocedure('public.set_updated_at()') is null
     or to_regprocedure('public.touch_image_batches_updated_at()') is null
     or to_regprocedure('public.touch_publish_batches_updated_at()') is null
     or to_regprocedure('public.handle_new_user()') is null
     or to_regprocedure('public.guard_sensitive_product_draft_fields()') is null then
    raise exception 'PRECHECK FAIL: one or more required functions are missing';
  end if;

  select count(*)
    into already_hardened
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'set_updated_at',
      'touch_image_batches_updated_at',
      'touch_publish_batches_updated_at'
    )
    and 'search_path=pg_catalog' = any(coalesce(p.proconfig, '{}'::text[]));

  if already_hardened <> 0 then
    raise exception 'PRECHECK FAIL: timestamp helper search_path already changed on % function(s); re-audit first', already_hardened;
  end if;

  if not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
     or not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.guard_sensitive_product_draft_fields()', 'EXECUTE')
     or not has_function_privilege('anon', 'public.guard_sensitive_product_draft_fields()', 'EXECUTE') then
    raise exception 'PRECHECK FAIL: trigger-function EXECUTE ACL no longer matches audited pre-state';
  end if;

  if not has_function_privilege('authenticated', 'public.current_user_role()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_reviewer()', 'EXECUTE') then
    raise exception 'PRECHECK FAIL: authenticated RLS helper execution changed';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'on_auth_user_created'
  ) then
    raise exception 'PRECHECK FAIL: auth.users trigger on_auth_user_created is missing';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname = 'product_drafts'
      and t.tgname = 'product_drafts_guard_sensitive_fields'
  ) then
    raise exception 'PRECHECK FAIL: product_drafts sensitive-field trigger is missing';
  end if;
end
$$;

select
  'PRECHECK_OK' as status,
  (select count(*) from public.product_drafts) as product_draft_rows,
  (select count(*) from public.product_images) as product_image_rows,
  (select count(*) from public.product_variants) as product_variant_rows,
  (select count(*) from public.profiles) as profile_rows;
