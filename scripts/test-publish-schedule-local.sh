#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

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

assert_scalar() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  actual="$(echo "$actual" | tail -n 1 | tr -d '[:space:]')"
  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: $label expected $expected, got ${actual:-<empty>}." >&2
    exit 1
  fi
}

MIGRATION="/tmp/nestory-forward-migrations/20261006121816_publish_schedule_core.sql"
if [[ ! -f "$MIGRATION" ]]; then
  echo "ERROR: staged schedule migration missing: $MIGRATION" >&2
  exit 1
fi

echo "==> Schedule: apply migration"
psql_local < "$MIGRATION" >/dev/null

assert_scalar "$(query_local -c "select to_regclass('public.publish_schedule_groups') is not null;")" t "schedule groups table"
assert_scalar "$(query_local -c "select to_regclass('public.publish_schedule_items') is not null;")" t "schedule items table"
assert_scalar "$(query_local -c "select relrowsecurity::int from pg_class where oid='public.publish_schedule_groups'::regclass;")" 1 "schedule groups RLS"
assert_scalar "$(query_local -c "select relrowsecurity::int from pg_class where oid='public.publish_schedule_items'::regclass;")" 1 "schedule items RLS"
assert_scalar "$(query_local -c "select count(*) from pg_indexes where schemaname='public' and indexname='uq_publish_schedule_active_draft';")" 1 "active draft unique index"
assert_scalar "$(query_local -c "select has_function_privilege('service_role','public.claim_due_publish_schedule_items(date, integer)','EXECUTE')::int;")" 1 "service_role claim execute"
assert_scalar "$(query_local -c "select has_function_privilege('authenticated','public.claim_due_publish_schedule_items(date, integer)','EXECUTE')::int;")" 0 "authenticated claim execute"
assert_scalar "$(query_local -c "select has_function_privilege('anon','public.claim_due_publish_schedule_items(date, integer)','EXECUTE')::int;")" 0 "anon claim execute"

before_groups="$(query_local -c "select count(*) from public.publish_schedule_groups;")"
before_items="$(query_local -c "select count(*) from public.publish_schedule_items;")"

echo "==> Schedule: transactional runtime checks"
psql_local <<'SQL' >/dev/null
begin;

do $$
declare
  draft_a uuid;
  draft_b uuid;
  group_active uuid;
  group_paused uuid;
  dup_blocked boolean := false;
  claimed_count integer;
begin
  select id into draft_a from public.product_drafts order by created_at nulls last, id limit 1;
  select id into draft_b from public.product_drafts where id <> draft_a order by created_at nulls last, id limit 1;

  if draft_a is null or draft_b is null then
    raise exception 'Need at least 2 product_drafts for schedule runtime test';
  end if;

  insert into public.publish_schedule_groups (
    start_date, daily_limit, timezone, active_weekdays, status, total_count
  ) values (
    current_date, 20, 'Asia/Taipei', '{0,1,2,3,4,5,6}', 'active', 1
  ) returning id into group_active;

  insert into public.publish_schedule_groups (
    start_date, daily_limit, timezone, active_weekdays, status, total_count
  ) values (
    current_date, 20, 'Asia/Taipei', '{0,1,2,3,4,5,6}', 'paused', 1
  ) returning id into group_paused;

  insert into public.publish_schedule_items (
    group_id, draft_id, scheduled_for, position, status
  ) values (
    group_active, draft_a, current_date, 1, 'queued'
  );

  begin
    insert into public.publish_schedule_items (
      group_id, draft_id, scheduled_for, position, status
    ) values (
      group_paused, draft_a, current_date + 1, 2, 'queued'
    );
  exception when unique_violation then
    dup_blocked := true;
  end;

  if not dup_blocked then
    raise exception 'Active schedule duplicate protection did not fire';
  end if;

  insert into public.publish_schedule_items (
    group_id, draft_id, scheduled_for, position, status
  ) values (
    group_paused, draft_b, current_date, 1, 'queued'
  );

  select count(*) into claimed_count
  from public.claim_due_publish_schedule_items(current_date, 20);

  if claimed_count <> 1 then
    raise exception 'Expected exactly one claimable item, got %', claimed_count;
  end if;

  if not exists (
    select 1 from public.publish_schedule_items
    where group_id = group_active and draft_id = draft_a and status = 'claimed'
  ) then
    raise exception 'Active due item was not claimed';
  end if;

  if not exists (
    select 1 from public.publish_schedule_items
    where group_id = group_paused and draft_id = draft_b and status = 'queued'
  ) then
    raise exception 'Paused group item must remain queued';
  end if;
end
$$;

rollback;
SQL

after_groups="$(query_local -c "select count(*) from public.publish_schedule_groups;")"
after_items="$(query_local -c "select count(*) from public.publish_schedule_items;")"

if [[ "$before_groups" != "$after_groups" || "$before_items" != "$after_items" ]]; then
  echo "ERROR: schedule runtime test leaked rows: groups $before_groups->$after_groups, items $before_items->$after_items" >&2
  exit 1
fi

echo "PASS: schedule migration, RLS, uniqueness, paused-group guard, atomic claim, and rollback checks passed."
