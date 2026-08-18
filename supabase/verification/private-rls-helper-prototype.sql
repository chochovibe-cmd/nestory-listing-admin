-- SD-1 LOCAL-ONLY PROTOTYPE
--
-- Purpose:
--   Move pure RLS authorization helpers out of exposed public schema while
--   preserving every existing policy expression and role semantic.
--
-- This file is intentionally under supabase/verification/, NOT migrations/.
-- It has NOT been approved or applied to production.
--
-- Out of scope here:
--   public.requeue_revision_for_generation(uuid,text)
--   public.rls_auto_enable()

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select role
  from public.profiles
  where id = auth.uid()
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(private.current_user_role() = 'admin'::public.user_role, false)
$$;

create or replace function private.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    private.current_user_role() in ('admin'::public.user_role, 'reviewer'::public.user_role),
    false
  )
$$;

create or replace function private.user_owns_image_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.image_batches b
    where b.id = p_batch_id
      and b.created_by = auth.uid()
  )
$$;

create or replace function private.user_owns_items_in_image_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.image_batch_items i
    join public.product_drafts d on d.id = i.draft_id
    where i.batch_id = p_batch_id
      and d.created_by = auth.uid()
  )
$$;

create or replace function private.user_owns_publish_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.publish_batches b
    where b.id = p_batch_id
      and b.created_by = auth.uid()
  )
$$;

create or replace function private.user_owns_items_in_publish_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.publish_batch_items i
    join public.product_drafts d on d.id = i.draft_id
    where i.batch_id = p_batch_id
      and d.created_by = auth.uid()
  )
$$;

revoke all on function private.current_user_role() from public, anon;
revoke all on function private.is_admin() from public, anon;
revoke all on function private.is_reviewer() from public, anon;
revoke all on function private.user_owns_image_batch(uuid) from public, anon;
revoke all on function private.user_owns_items_in_image_batch(uuid) from public, anon;
revoke all on function private.user_owns_publish_batch(uuid) from public, anon;
revoke all on function private.user_owns_items_in_publish_batch(uuid) from public, anon;

grant execute on function private.current_user_role() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.is_reviewer() to authenticated, service_role;
grant execute on function private.user_owns_image_batch(uuid) to authenticated, service_role;
grant execute on function private.user_owns_items_in_image_batch(uuid) to authenticated, service_role;
grant execute on function private.user_owns_publish_batch(uuid) to authenticated, service_role;
grant execute on function private.user_owns_items_in_publish_batch(uuid) to authenticated, service_role;

-- Rewrite only policies that already reference the seven known public RLS
-- helpers. ALTER POLICY preserves policy name, command, target roles and all
-- unrelated expression text; only helper schema qualification changes.
do $$
declare
  r record;
  new_qual text;
  new_check text;
  ddl text;
  affected_count integer := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~
        '(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)'
    order by tablename, policyname
  loop
    new_qual := r.qual;
    new_check := r.with_check;

    if new_qual is not null then
      new_qual := replace(new_qual, 'public.current_user_role()', 'private.current_user_role()');
      new_qual := replace(new_qual, 'public.is_admin()', 'private.is_admin()');
      new_qual := replace(new_qual, 'public.is_reviewer()', 'private.is_reviewer()');
      new_qual := replace(new_qual, 'public.user_owns_image_batch(', 'private.user_owns_image_batch(');
      new_qual := replace(new_qual, 'public.user_owns_items_in_image_batch(', 'private.user_owns_items_in_image_batch(');
      new_qual := replace(new_qual, 'public.user_owns_publish_batch(', 'private.user_owns_publish_batch(');
      new_qual := replace(new_qual, 'public.user_owns_items_in_publish_batch(', 'private.user_owns_items_in_publish_batch(');

      new_qual := regexp_replace(new_qual, '(^|[^[:alnum:]_.])current_user_role\(\)', E'\\1private.current_user_role()', 'g');
      new_qual := regexp_replace(new_qual, '(^|[^[:alnum:]_.])is_admin\(\)', E'\\1private.is_admin()', 'g');
      new_qual := regexp_replace(new_qual, '(^|[^[:alnum:]_.])is_reviewer\(\)', E'\\1private.is_reviewer()', 'g');
      new_qual := regexp_replace(new_qual, '(^|[^[:alnum:]_.])user_owns_image_batch\(', E'\\1private.user_owns_image_batch(', 'g');
      new_qual := regexp_replace(new_qual, '(^|[^[:alnum:]_.])user_owns_items_in_image_batch\(', E'\\1private.user_owns_items_in_image_batch(', 'g');
      new_qual := regexp_replace(new_qual, '(^|[^[:alnum:]_.])user_owns_publish_batch\(', E'\\1private.user_owns_publish_batch(', 'g');
      new_qual := regexp_replace(new_qual, '(^|[^[:alnum:]_.])user_owns_items_in_publish_batch\(', E'\\1private.user_owns_items_in_publish_batch(', 'g');
    end if;

    if new_check is not null then
      new_check := replace(new_check, 'public.current_user_role()', 'private.current_user_role()');
      new_check := replace(new_check, 'public.is_admin()', 'private.is_admin()');
      new_check := replace(new_check, 'public.is_reviewer()', 'private.is_reviewer()');
      new_check := replace(new_check, 'public.user_owns_image_batch(', 'private.user_owns_image_batch(');
      new_check := replace(new_check, 'public.user_owns_items_in_image_batch(', 'private.user_owns_items_in_image_batch(');
      new_check := replace(new_check, 'public.user_owns_publish_batch(', 'private.user_owns_publish_batch(');
      new_check := replace(new_check, 'public.user_owns_items_in_publish_batch(', 'private.user_owns_items_in_publish_batch(');

      new_check := regexp_replace(new_check, '(^|[^[:alnum:]_.])current_user_role\(\)', E'\\1private.current_user_role()', 'g');
      new_check := regexp_replace(new_check, '(^|[^[:alnum:]_.])is_admin\(\)', E'\\1private.is_admin()', 'g');
      new_check := regexp_replace(new_check, '(^|[^[:alnum:]_.])is_reviewer\(\)', E'\\1private.is_reviewer()', 'g');
      new_check := regexp_replace(new_check, '(^|[^[:alnum:]_.])user_owns_image_batch\(', E'\\1private.user_owns_image_batch(', 'g');
      new_check := regexp_replace(new_check, '(^|[^[:alnum:]_.])user_owns_items_in_image_batch\(', E'\\1private.user_owns_items_in_image_batch(', 'g');
      new_check := regexp_replace(new_check, '(^|[^[:alnum:]_.])user_owns_publish_batch\(', E'\\1private.user_owns_publish_batch(', 'g');
      new_check := regexp_replace(new_check, '(^|[^[:alnum:]_.])user_owns_items_in_publish_batch\(', E'\\1private.user_owns_items_in_publish_batch(', 'g');
    end if;

    case r.cmd
      when 'SELECT' then
        ddl := format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, new_qual);
      when 'DELETE' then
        ddl := format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, new_qual);
      when 'INSERT' then
        ddl := format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, new_check);
      when 'UPDATE' then
        ddl := format('alter policy %I on %I.%I using (%s) with check (%s)', r.policyname, r.schemaname, r.tablename, new_qual, new_check);
      when 'ALL' then
        ddl := format('alter policy %I on %I.%I using (%s) with check (%s)', r.policyname, r.schemaname, r.tablename, new_qual, new_check);
      else
        raise exception 'SD-1 unexpected policy command % for %.%', r.cmd, r.tablename, r.policyname;
    end case;

    execute ddl;
    affected_count := affected_count + 1;
  end loop;

  if affected_count <> 35 then
    raise exception 'SD-1 expected to rewrite exactly 35 policies, rewrote %', affected_count;
  end if;
end
$$;

-- Once all RLS policies use private.* helpers, direct client execution of the
-- legacy public RLS helper surface is unnecessary. Keep the functions in place
-- for now because other server/legacy functions may still reference them.
revoke execute on function public.current_user_role() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.is_reviewer() from public, anon, authenticated;
revoke execute on function public.user_owns_image_batch(uuid) from public, anon, authenticated;
revoke execute on function public.user_owns_items_in_image_batch(uuid) from public, anon, authenticated;
revoke execute on function public.user_owns_publish_batch(uuid) from public, anon, authenticated;
revoke execute on function public.user_owns_items_in_publish_batch(uuid) from public, anon, authenticated;

grant execute on function public.current_user_role() to service_role;
grant execute on function public.is_admin() to service_role;
grant execute on function public.is_reviewer() to service_role;
grant execute on function public.user_owns_image_batch(uuid) to service_role;
grant execute on function public.user_owns_items_in_image_batch(uuid) to service_role;
grant execute on function public.user_owns_publish_batch(uuid) to service_role;
grant execute on function public.user_owns_items_in_publish_batch(uuid) to service_role;

commit;
