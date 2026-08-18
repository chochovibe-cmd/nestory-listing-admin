-- SD-1 inverse SQL reference for local testing / future tracked revert design.
--
-- IMPORTANT:
-- If SD-1 is ever applied as a tracked production migration, do NOT run this
-- file manually in production. Create a NEW tracked revert migration using the
-- tested inverse operations so schema state and migration ledger stay aligned.

begin;

-- Rewrite exactly the 35 private-helper policies back to their legacy public
-- helper references before removing the private helper functions.
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
    where schemaname='public'
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
        'private\.(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)'
    order by tablename, policyname
  loop
    new_qual := r.qual;
    new_check := r.with_check;

    if new_qual is not null then
      new_qual := replace(new_qual, 'private.current_user_role()', 'public.current_user_role()');
      new_qual := replace(new_qual, 'private.is_admin()', 'public.is_admin()');
      new_qual := replace(new_qual, 'private.is_reviewer()', 'public.is_reviewer()');
      new_qual := replace(new_qual, 'private.user_owns_image_batch(', 'public.user_owns_image_batch(');
      new_qual := replace(new_qual, 'private.user_owns_items_in_image_batch(', 'public.user_owns_items_in_image_batch(');
      new_qual := replace(new_qual, 'private.user_owns_publish_batch(', 'public.user_owns_publish_batch(');
      new_qual := replace(new_qual, 'private.user_owns_items_in_publish_batch(', 'public.user_owns_items_in_publish_batch(');
    end if;

    if new_check is not null then
      new_check := replace(new_check, 'private.current_user_role()', 'public.current_user_role()');
      new_check := replace(new_check, 'private.is_admin()', 'public.is_admin()');
      new_check := replace(new_check, 'private.is_reviewer()', 'public.is_reviewer()');
      new_check := replace(new_check, 'private.user_owns_image_batch(', 'public.user_owns_image_batch(');
      new_check := replace(new_check, 'private.user_owns_items_in_image_batch(', 'public.user_owns_items_in_image_batch(');
      new_check := replace(new_check, 'private.user_owns_publish_batch(', 'public.user_owns_publish_batch(');
      new_check := replace(new_check, 'private.user_owns_items_in_publish_batch(', 'public.user_owns_items_in_publish_batch(');
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
        raise exception 'SD-1 revert unexpected policy command % for %.%', r.cmd, r.tablename, r.policyname;
    end case;

    execute ddl;
    affected_count := affected_count + 1;
  end loop;

  if affected_count <> 35 then
    raise exception 'SD-1 revert expected exactly 35 policies, rewrote %', affected_count;
  end if;
end
$$;

-- Restore pre-SD1 direct EXECUTE shape for the legacy public helpers.
-- The three role helpers historically inherited PUBLIC EXECUTE as well as
-- explicit authenticated/service_role grants. The four batch ownership helpers
-- had authenticated/service_role grants without PUBLIC.
grant execute on function public.current_user_role() to public, authenticated, service_role;
grant execute on function public.is_admin() to public, authenticated, service_role;
grant execute on function public.is_reviewer() to public, authenticated, service_role;

grant execute on function public.user_owns_image_batch(uuid) to authenticated, service_role;
grant execute on function public.user_owns_items_in_image_batch(uuid) to authenticated, service_role;
grant execute on function public.user_owns_publish_batch(uuid) to authenticated, service_role;
grant execute on function public.user_owns_items_in_publish_batch(uuid) to authenticated, service_role;

revoke all on function private.current_user_role() from public, anon, authenticated, service_role;
revoke all on function private.is_admin() from public, anon, authenticated, service_role;
revoke all on function private.is_reviewer() from public, anon, authenticated, service_role;
revoke all on function private.user_owns_image_batch(uuid) from public, anon, authenticated, service_role;
revoke all on function private.user_owns_items_in_image_batch(uuid) from public, anon, authenticated, service_role;
revoke all on function private.user_owns_publish_batch(uuid) from public, anon, authenticated, service_role;
revoke all on function private.user_owns_items_in_publish_batch(uuid) from public, anon, authenticated, service_role;

drop function private.user_owns_items_in_publish_batch(uuid);
drop function private.user_owns_publish_batch(uuid);
drop function private.user_owns_items_in_image_batch(uuid);
drop function private.user_owns_image_batch(uuid);
drop function private.is_reviewer();
drop function private.is_admin();
drop function private.current_user_role();

revoke all on schema private from public, anon, authenticated, service_role;
drop schema private;

commit;
