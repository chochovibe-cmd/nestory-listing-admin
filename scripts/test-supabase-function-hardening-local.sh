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

operator_a='10000000-0000-4000-8000-000000000001'
harden_user='10000000-0000-4000-8000-000000000006'
draft_a='20000000-0000-4000-8000-000000000001'

echo "==> Function hardening: verify repo trigger candidates exist"
assert_scalar "$(query_local -c "select (to_regprocedure('public.handle_new_user()') is not null)::int;")" 1 "handle_new_user exists"
assert_scalar "$(query_local -c "select (to_regprocedure('public.guard_sensitive_product_draft_fields()') is not null)::int;")" 1 "guard_sensitive_product_draft_fields exists"

rls_auto_enable_exists="$(query_local -c "select (to_regprocedure('public.rls_auto_enable()') is not null)::int;")"
if [[ "$rls_auto_enable_exists" == "0" ]]; then
  echo "INFO: rls_auto_enable is not present in local Supabase; treat it as hosted-platform-only and do not claim local revoke proof."
fi

echo "==> Revoke direct client EXECUTE from repo trigger functions locally"
query_local >/dev/null <<'SQL'
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.guard_sensitive_product_draft_fields() from public, anon, authenticated;

grant execute on function public.handle_new_user() to service_role;
grant execute on function public.guard_sensitive_product_draft_fields() to service_role;
SQL

for fn in \
  'public.handle_new_user()' \
  'public.guard_sensitive_product_draft_fields()'
do
  assert_scalar "$(query_local -c "select has_function_privilege('authenticated', '$fn', 'EXECUTE')::int;")" 0 "authenticated cannot directly execute $fn"
  assert_scalar "$(query_local -c "select has_function_privilege('anon', '$fn', 'EXECUTE')::int;")" 0 "anon cannot directly execute $fn"
done

echo "==> RLS helper functions intentionally remain executable by authenticated"
for fn in \
  'public.current_user_role()' \
  'public.is_admin()' \
  'public.is_reviewer()'
do
  assert_scalar "$(query_local -c "select has_function_privilege('authenticated', '$fn', 'EXECUTE')::int;")" 1 "authenticated retains RLS helper $fn"
done

echo "==> handle_new_user trigger still runs after direct EXECUTE revoke"
query_local >/dev/null <<SQL
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '$harden_user',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'hardening-trigger-ci@example.invalid',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
)
on conflict (id) do nothing;
SQL
assert_scalar "$(query_local -c "select count(*) from public.profiles where id='$harden_user'::uuid and role='operator';")" 1 "handle_new_user trigger after revoke"

echo "==> sensitive-field guard still fires after direct EXECUTE revoke"
if query_local >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$operator_a';
update public.product_drafts set status='approved' where id='$draft_a'::uuid;
commit;
SQL
then
  echo "ERROR: operator unexpectedly bypassed sensitive-field guard after EXECUTE revoke." >&2
  exit 1
fi

if [[ "$rls_auto_enable_exists" == "1" ]]; then
  echo "==> Optional local proof: harden rls_auto_enable when the local platform provides it"
  query_local >/dev/null <<'SQL'
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;
SQL
  assert_scalar "$(query_local -c "select has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE')::int;")" 0 "authenticated cannot directly execute rls_auto_enable"
  assert_scalar "$(query_local -c "select has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')::int;")" 0 "anon cannot directly execute rls_auto_enable"

  query_local >/dev/null <<'SQL'
drop table if exists public.ci_rls_auto_enable_probe;
create table public.ci_rls_auto_enable_probe (id integer primary key);
SQL
  assert_scalar "$(query_local -c "select relrowsecurity::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='ci_rls_auto_enable_probe';")" 1 "rls_auto_enable event trigger after revoke"
  query_local >/dev/null -c "drop table public.ci_rls_auto_enable_probe;"
else
  echo "SKIP: hosted production rls_auto_enable cannot be runtime-proven by the free local stack; leave production ACL unchanged."
fi

echo "PASS: repo trigger direct-EXECUTE hardening passed; hosted-only rls_auto_enable remains unmodified unless separately proven."
