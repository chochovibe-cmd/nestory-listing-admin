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

psql_local() {
  docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
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

operator_id='10000000-0000-4000-8000-000000000001'
admin_id='10000000-0000-4000-8000-000000000002'
reviewer_id='10000000-0000-4000-8000-000000000004'

echo "==> SD-1 static source guard: app must not directly RPC-call pure RLS helpers"
if grep -R -n -E "\.rpc\([[:space:]]*['\"](current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)['\"]" src; then
  echo "ERROR: app source directly calls an RLS-only helper RPC; private-schema migration would be unsafe." >&2
  exit 1
fi

echo "==> SD-1 apply private-schema prototype to isolated local DB"
psql_local < supabase/verification/private-rls-helper-prototype.sql >/dev/null

echo "==> SD-1 structural assertions"
psql_local >/dev/null <<'SQL'
do $$
declare
  private_fn_count integer;
  private_policy_count integer;
  legacy_policy_count integer;
  explicit_public_policy_count integer;
  bad_private_search_path integer;
begin
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
    raise exception 'SD-1 expected 7 private RLS helpers, got %', private_fn_count;
  end if;

  select count(*) into private_policy_count
  from pg_policies
  where schemaname='public'
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
      'private\.(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)';
  if private_policy_count <> 35 then
    raise exception 'SD-1 expected exactly 35 policies to use private helpers, got %', private_policy_count;
  end if;

  select count(*) into explicit_public_policy_count
  from pg_policies
  where schemaname='public'
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
      'public\.(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)';
  if explicit_public_policy_count <> 0 then
    raise exception 'SD-1 public helper references remain in % policies', explicit_public_policy_count;
  end if;

  select count(*) into legacy_policy_count
  from pg_policies
  where schemaname='public'
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
      '(^|[^[:alnum:]_.])(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)\(';
  if legacy_policy_count <> 0 then
    raise exception 'SD-1 unqualified legacy helper references remain in % policies', legacy_policy_count;
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
    raise exception 'SD-1 every private helper must pin search_path=pg_catalog';
  end if;
end
$$;
SQL

assert_count "$(query_local -c "select has_schema_privilege('anon','private','USAGE')::int;")" 0 "anon private schema usage"
assert_count "$(query_local -c "select has_schema_privilege('authenticated','private','USAGE')::int;")" 1 "authenticated private schema usage for RLS"

for signature in \
  'current_user_role()' \
  'is_admin()' \
  'is_reviewer()' \
  'user_owns_image_batch(uuid)' \
  'user_owns_items_in_image_batch(uuid)' \
  'user_owns_publish_batch(uuid)' \
  'user_owns_items_in_publish_batch(uuid)'
do
  assert_count "$(query_local -c "select has_function_privilege('authenticated','public.$signature','EXECUTE')::int;")" 0 "authenticated direct public EXECUTE $signature"
  assert_count "$(query_local -c "select has_function_privilege('anon','public.$signature','EXECUTE')::int;")" 0 "anon direct public EXECUTE $signature"
  assert_count "$(query_local -c "select has_function_privilege('authenticated','private.$signature','EXECUTE')::int;")" 1 "authenticated private helper EXECUTE $signature"
done

# Out-of-scope privileged business RPC must be unchanged by SD-1.
assert_count "$(query_local -c "select has_function_privilege('authenticated','public.requeue_revision_for_generation(uuid,text)','EXECUTE')::int;")" 1 "requeue_revision_for_generation remains unchanged"

echo "==> SD-1 RLS behavior after private helper rewrite"
# The existing CI fixture rows were created by the reconciliation tests earlier
# in this same local database.
assert_count "$(run_as_user "$operator_id" "select count(*) from public.ip_catalog where ip_name in ('CI Active IP','CI Inactive IP');")" 1 "operator catalog active-only visibility"
assert_count "$(run_as_user "$admin_id" "select count(*) from public.ip_catalog where ip_name in ('CI Active IP','CI Inactive IP');")" 2 "admin catalog active+inactive visibility"

if query_local >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$operator_id';
insert into public.ip_catalog (ip_name, is_active) values ('CI SD1 Operator Must Fail', true);
commit;
SQL
then
  echo "ERROR: operator unexpectedly wrote catalog data after private helper rewrite." >&2
  exit 1
fi

query_local >/dev/null <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$admin_id';
insert into public.ip_catalog (ip_name, is_active) values ('CI SD1 Admin Write OK', true);
rollback;
SQL

echo "==> SD-1 rerun full role/draft/archive/batch RLS matrix"
bash scripts/test-supabase-role-rls-local.sh

# Reviewer role must still be resolvable through private helper after the role
# matrix has recreated/confirmed reviewer fixture state.
assert_count "$(run_as_user "$reviewer_id" "select (private.is_reviewer())::int;")" 1 "reviewer private helper"
assert_count "$(run_as_user "$admin_id" "select (private.is_admin())::int;")" 1 "admin private helper"
assert_count "$(run_as_user "$operator_id" "select (private.is_admin())::int;")" 0 "operator private admin helper"

echo "PASS: SD-1 private-schema RLS helper prototype preserves runtime authorization behavior."
