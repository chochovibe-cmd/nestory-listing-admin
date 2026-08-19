-- Nestory migration tracking baseline — first tracked production migration.
--
-- This file DOES NOT create the historical schema from scratch.
-- It asserts that the existing production database matches the audited
-- pre-reconciliation state before migration tracking begins.
-- Historical SQL 001–039 predates tracking and is archived separately.

do $$
declare
  role_labels text[];
  policy_total integer;
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into role_labels
  from pg_type ty
  join pg_namespace n on n.oid = ty.typnamespace
  join pg_enum e on e.enumtypid = ty.oid
  where n.nspname = 'public'
    and ty.typname = 'user_role';

  if role_labels is distinct from array['admin','operator','reviewer']::text[] then
    raise exception 'BASELINE FAIL: public.user_role changed; found %', role_labels;
  end if;

  if to_regclass('public.product_drafts') is null
     or to_regclass('public.product_images') is null
     or to_regclass('public.product_variants') is null
     or to_regclass('public.ip_catalog') is null
     or to_regclass('public.ip_characters') is null
     or to_regclass('public.tag_rules') is null
     or to_regclass('public.collection_rules') is null then
    raise exception 'BASELINE FAIL: required production tables are missing';
  end if;

  select count(*) into policy_total
  from pg_policies
  where schemaname='public'
    and tablename in ('ip_catalog','ip_characters','tag_rules','collection_rules');

  if policy_total <> 0 then
    raise exception 'BASELINE FAIL: expected audited pre-reconcile catalog/rule policy count 0, found %', policy_total;
  end if;

  if to_regprocedure('public.current_user_role()') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.is_reviewer()') is null
     or to_regprocedure('public.handle_new_user()') is null
     or to_regprocedure('public.guard_sensitive_product_draft_fields()') is null then
    raise exception 'BASELINE FAIL: required production functions are missing';
  end if;
end
$$;
