#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MIGRATION_SOURCE_DIR="${MIGRATION_SOURCE_DIR:-supabase/migrations}"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1 || true)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "ERROR: local Supabase database container was not found." >&2
  exit 1
fi

psql_local() {
  docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

query_local() {
  docker exec -i "$DB_CONTAINER" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

echo "==> Applying repo migrations 001–039 to an isolated local database"
echo "    migration source: $MIGRATION_SOURCE_DIR"
while IFS= read -r migration; do
  migration_name="$(basename "$migration")"

  if [[ "$migration_name" == "033_tag_rules_sync_boss_tool.sql" ]]; then
    echo "    applying CI-only legacy baseline required by migration 033"
    psql_local < supabase/reconcile/local-production-baseline.sql >/dev/null
  fi

  echo "    applying $migration_name"
  psql_local < "$migration" >/dev/null
done < <(find "$MIGRATION_SOURCE_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

policy_count="$(query_local -c "select count(*) from pg_policies where schemaname='public' and tablename in ('ip_catalog','ip_characters','tag_rules','collection_rules');")"
if [[ "$policy_count" != "8" ]]; then
  echo "ERROR: production-like migration build should create 8 catalog/rule policies; found $policy_count." >&2
  exit 1
fi

echo "==> Simulating the confirmed production drift (all 8 migration-004 policies missing)"
psql_local >/dev/null <<'SQL'
drop policy if exists ip_catalog_select_authenticated on public.ip_catalog;
drop policy if exists ip_catalog_write_admin on public.ip_catalog;
drop policy if exists ip_characters_select_authenticated on public.ip_characters;
drop policy if exists ip_characters_write_admin on public.ip_characters;
drop policy if exists tag_rules_select_authenticated on public.tag_rules;
drop policy if exists tag_rules_write_admin on public.tag_rules;
drop policy if exists collection_rules_select_authenticated on public.collection_rules;
drop policy if exists collection_rules_write_admin on public.collection_rules;
SQL

policy_count="$(query_local -c "select count(*) from pg_policies where schemaname='public' and tablename in ('ip_catalog','ip_characters','tag_rules','collection_rules');")"
if [[ "$policy_count" != "0" ]]; then
  echo "ERROR: drift simulation expected 0 catalog/rule policies; found $policy_count." >&2
  exit 1
fi

echo "==> Applying the production reconciliation review draft locally"
psql_local < supabase/reconcile/2026-08-18_production_reconcile_draft.sql >/dev/null

echo "==> Verifying restored policy structure and trigger search_path"
psql_local >/dev/null <<'SQL'
do $$
declare
  policy_total integer;
  bad_policy_tables integer;
  bad_search_path integer;
begin
  select count(*) into policy_total
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

  if policy_total <> 8 then
    raise exception 'expected 8 restored policies, got %', policy_total;
  end if;

  select count(*) into bad_policy_tables
  from (
    select tablename, count(*) as policy_count
    from pg_policies
    where schemaname = 'public'
      and tablename in ('ip_catalog','ip_characters','tag_rules','collection_rules')
    group by tablename
    having count(*) <> 2
  ) x;

  if bad_policy_tables <> 0 then
    raise exception 'each catalog/rule table must have exactly 2 policies';
  end if;

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
    raise exception 'all 3 timestamp trigger helpers must pin search_path=pg_catalog';
  end if;
end
$$;
SQL

echo "==> Creating isolated operator/admin identities and catalog fixtures"
psql_local >/dev/null <<'SQL'
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operator-ci@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-ci@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

update public.profiles
set role = 'admin'
where id = '10000000-0000-4000-8000-000000000002';

insert into public.ip_catalog (ip_name, aliases, sort_order, is_active)
values
  ('CI Active IP', '{}'::text[], 900001, true),
  ('CI Inactive IP', '{}'::text[], 900002, false)
on conflict (ip_name) do update set is_active = excluded.is_active;

insert into public.ip_characters (ip_name, character_name, aliases, sort_order, is_active)
values
  ('CI Active IP', 'CI Active Character', '{}'::text[], 1, true),
  ('CI Active IP', 'CI Inactive Character', '{}'::text[], 2, false)
on conflict (ip_name, character_name) do update set is_active = excluded.is_active;

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
values
  ('類型', 'CI Active Tag', 'CI_ACTIVE_TAG', false, true, 900001),
  ('類型', 'CI Inactive Tag', 'CI_INACTIVE_TAG', false, false, 900002)
on conflict (tag_value) do update set is_active = excluded.is_active;

insert into public.collection_rules (tag_value, collection_name, collection_handle, collection_url, is_secondhand, is_active, sort_order)
values
  ('CI_ACTIVE_TAG', 'CI Active Collection', 'ci-active-collection', null, false, true, 900001),
  ('CI_INACTIVE_TAG', 'CI Inactive Collection', 'ci-inactive-collection', null, false, false, 900002)
on conflict (tag_value, collection_handle) do update set is_active = excluded.is_active;
SQL

run_as_user_count() {
  local user_id="$1"
  local table_name="$2"
  local where_clause="$3"
  query_local <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$user_id';
select count(*) from public.$table_name where $where_clause;
rollback;
SQL
}

assert_count() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  actual="$(echo "$actual" | grep -E '^[0-9]+$' | tail -n 1)"
  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: $label expected $expected, got ${actual:-<empty>}." >&2
    exit 1
  fi
}

echo "==> Runtime RLS: operator sees active rows only"
operator_id='10000000-0000-4000-8000-000000000001'
admin_id='10000000-0000-4000-8000-000000000002'

assert_count "$(run_as_user_count "$operator_id" ip_catalog "ip_name like 'CI % IP'")" 1 "operator ip_catalog visibility"
assert_count "$(run_as_user_count "$operator_id" ip_characters "character_name like 'CI % Character'")" 1 "operator ip_characters visibility"
assert_count "$(run_as_user_count "$operator_id" tag_rules "tag_value in ('CI_ACTIVE_TAG','CI_INACTIVE_TAG')")" 1 "operator tag_rules visibility"
assert_count "$(run_as_user_count "$operator_id" collection_rules "collection_handle in ('ci-active-collection','ci-inactive-collection')")" 1 "operator collection_rules visibility"

echo "==> Runtime RLS: admin sees active + inactive rows"
assert_count "$(run_as_user_count "$admin_id" ip_catalog "ip_name like 'CI % IP'")" 2 "admin ip_catalog visibility"
assert_count "$(run_as_user_count "$admin_id" ip_characters "character_name like 'CI % Character'")" 2 "admin ip_characters visibility"
assert_count "$(run_as_user_count "$admin_id" tag_rules "tag_value in ('CI_ACTIVE_TAG','CI_INACTIVE_TAG')")" 2 "admin tag_rules visibility"
assert_count "$(run_as_user_count "$admin_id" collection_rules "collection_handle in ('ci-active-collection','ci-inactive-collection')")" 2 "admin collection_rules visibility"

echo "==> Runtime RLS: operator write is denied"
if query_local >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$operator_id';
insert into public.ip_catalog (ip_name, is_active) values ('CI Operator Must Fail', true);
commit;
SQL
then
  echo "ERROR: operator unexpectedly wrote to admin-governed ip_catalog." >&2
  exit 1
fi

echo "==> Runtime RLS: admin write is allowed"
query_local >/dev/null <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$admin_id';
insert into public.ip_catalog (ip_name, is_active) values ('CI Admin Write OK', true);
rollback;
SQL

echo "==> Trigger runtime: updated_at helpers still execute after search_path hardening"

catalog_before="$(query_local -c "select updated_at::text from public.ip_catalog where ip_name='CI Active IP';")"
sleep 0.02
catalog_advanced="$(query_local -c "update public.ip_catalog set sort_order = sort_order + 1 where ip_name='CI Active IP' returning (updated_at > '$catalog_before'::timestamptz)::int;")"
assert_count "$catalog_advanced" 1 "set_updated_at trigger"

image_batch_id="$(query_local -c "insert into public.image_batches default values returning id;")"
image_before="$(query_local -c "select updated_at::text from public.image_batches where id='$image_batch_id'::uuid;")"
sleep 0.02
image_advanced="$(query_local -c "update public.image_batches set total_count = total_count + 1 where id='$image_batch_id'::uuid returning (updated_at > '$image_before'::timestamptz)::int;")"
assert_count "$image_advanced" 1 "touch_image_batches_updated_at trigger"

publish_batch_id="$(query_local -c "insert into public.publish_batches default values returning id;")"
publish_before="$(query_local -c "select updated_at::text from public.publish_batches where id='$publish_batch_id'::uuid;")"
sleep 0.02
publish_advanced="$(query_local -c "update public.publish_batches set total_count = total_count + 1 where id='$publish_batch_id'::uuid returning (updated_at > '$publish_before'::timestamptz)::int;")"
assert_count "$publish_advanced" 1 "touch_publish_batches_updated_at trigger"

echo "PASS: local Supabase reconciliation test completed without touching production."
