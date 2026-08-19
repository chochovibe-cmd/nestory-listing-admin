#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1 || true)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "ERROR: local Supabase database container was not found." >&2
  exit 1
fi

query_local() {
  docker exec -i "$DB_CONTAINER" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
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

run_as_user() {
  local user_id="$1"
  local sql="$2"
  query_local <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$user_id';
$sql
rollback;
SQL
}

operator_a='10000000-0000-4000-8000-000000000001'
admin_id='10000000-0000-4000-8000-000000000002'
operator_b='10000000-0000-4000-8000-000000000003'
reviewer_id='10000000-0000-4000-8000-000000000004'
new_user_id='10000000-0000-4000-8000-000000000005'

draft_a='20000000-0000-4000-8000-000000000001'
draft_b='20000000-0000-4000-8000-000000000002'

echo "==> Role/RLS phase 2: create additional isolated users"
query_local >/dev/null <<SQL
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('$operator_b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operator-b-ci@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('$reviewer_id', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reviewer-ci@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('$new_user_id', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'new-user-trigger-ci@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

update public.profiles set role = 'reviewer' where id = '$reviewer_id';
SQL

assert_count "$(query_local -c "select count(*) from public.profiles where id='$new_user_id'::uuid and role='operator';")" 1 "handle_new_user default operator profile"
assert_count "$(query_local -c "select count(*) from public.profiles where id='$reviewer_id'::uuid and role='reviewer';")" 1 "reviewer fixture role"

echo "==> Role/RLS phase 2: create two drafts with different owners"
query_local >/dev/null <<SQL
insert into public.product_drafts (id, original_title, cny_price, created_by, status)
values
  ('$draft_a', 'CI Draft Operator A', 10, '$operator_a', 'pending_copy'),
  ('$draft_b', 'CI Draft Operator B', 20, '$operator_b', 'pending_copy')
on conflict (id) do update set
  created_by = excluded.created_by,
  status = excluded.status,
  note = null;
SQL

echo "==> Operator can read/update own draft but not another operator's draft"
assert_count "$(run_as_user "$operator_a" "select count(*) from public.product_drafts where id='$draft_a'::uuid;")" 1 "operator own-draft read"
assert_count "$(run_as_user "$operator_a" "select count(*) from public.product_drafts where id='$draft_b'::uuid;")" 0 "operator cross-owner draft read"

assert_count "$(run_as_user "$operator_a" "with changed as (update public.product_drafts set note='operator-own-update' where id='$draft_a'::uuid returning 1) select count(*) from changed;")" 1 "operator own-draft update"
assert_count "$(run_as_user "$operator_a" "with changed as (update public.product_drafts set note='must-not-update' where id='$draft_b'::uuid returning 1) select count(*) from changed;")" 0 "operator cross-owner draft update"

echo "==> Reviewer/admin can read and update across team"
assert_count "$(run_as_user "$reviewer_id" "select count(*) from public.product_drafts where id in ('$draft_a'::uuid,'$draft_b'::uuid);")" 2 "reviewer cross-team read"
assert_count "$(run_as_user "$admin_id" "select count(*) from public.product_drafts where id in ('$draft_a'::uuid,'$draft_b'::uuid);")" 2 "admin cross-team read"
assert_count "$(run_as_user "$reviewer_id" "with changed as (update public.product_drafts set note='reviewer-cross-team-update' where id='$draft_a'::uuid returning 1) select count(*) from changed;")" 1 "reviewer cross-team update"

echo "==> Sensitive-field guard blocks operator workflow escalation"
if query_local >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$operator_a';
update public.product_drafts set status='approved' where id='$draft_a'::uuid;
commit;
SQL
then
  echo "ERROR: operator unexpectedly escalated draft status to approved." >&2
  exit 1
fi

echo "==> Reviewer can perform the same privileged workflow transition"
assert_count "$(run_as_user "$reviewer_id" "with changed as (update public.product_drafts set status='approved' where id='$draft_a'::uuid returning 1) select count(*) from changed;")" 1 "reviewer privileged draft transition"

echo "==> Build batch fixtures that force both non-recursive ownership helpers"
image_batch_item_owned="$(query_local -c "insert into public.image_batches (created_by) values ('$operator_b') returning id;")"
image_batch_header_owned="$(query_local -c "insert into public.image_batches (created_by) values ('$operator_a') returning id;")"
publish_batch_item_owned="$(query_local -c "insert into public.publish_batches (created_by) values ('$operator_b') returning id;")"
publish_batch_header_owned="$(query_local -c "insert into public.publish_batches (created_by) values ('$operator_a') returning id;")"

query_local >/dev/null <<SQL
insert into public.image_batch_items (batch_id, draft_id) values
  ('$image_batch_item_owned', '$draft_a'),
  ('$image_batch_header_owned', '$draft_b');
insert into public.publish_batch_items (batch_id, draft_id) values
  ('$publish_batch_item_owned', '$draft_a'),
  ('$publish_batch_header_owned', '$draft_b');
SQL

echo "==> Batch RLS helper paths return rows without 42P17 recursion"
assert_count "$(run_as_user "$operator_a" "select count(*) from public.image_batches where id='$image_batch_item_owned'::uuid;")" 1 "image batch visible through owned item helper"
assert_count "$(run_as_user "$operator_a" "select count(*) from public.image_batch_items where batch_id='$image_batch_header_owned'::uuid;")" 1 "image batch item visible through owned header helper"
assert_count "$(run_as_user "$operator_a" "select count(*) from public.publish_batches where id='$publish_batch_item_owned'::uuid;")" 1 "publish batch visible through owned item helper"
assert_count "$(run_as_user "$operator_a" "select count(*) from public.publish_batch_items where batch_id='$publish_batch_header_owned'::uuid;")" 1 "publish batch item visible through owned header helper"

assert_count "$(run_as_user "$reviewer_id" "select count(*) from public.image_batches where id in ('$image_batch_item_owned'::uuid,'$image_batch_header_owned'::uuid);")" 2 "reviewer image batch cross-team read"
assert_count "$(run_as_user "$reviewer_id" "select count(*) from public.publish_batches where id in ('$publish_batch_item_owned'::uuid,'$publish_batch_header_owned'::uuid);")" 2 "reviewer publish batch cross-team read"

echo "==> Archive authorization DB scope matches route design"
# The archive route now authorizes requested draft IDs through the signed-in RLS
# client before using service-role mutation. These counts prove the DB scope the
# route relies on: operator A can authorize only draft A; reviewer can authorize both.
assert_count "$(run_as_user "$operator_a" "select count(*) from public.product_drafts where id in ('$draft_a'::uuid,'$draft_b'::uuid);")" 1 "archive operator authorization scope"
assert_count "$(run_as_user "$reviewer_id" "select count(*) from public.product_drafts where id in ('$draft_a'::uuid,'$draft_b'::uuid);")" 2 "archive reviewer authorization scope"

echo "PASS: local Supabase role/RLS phase-2 runtime matrix passed."
