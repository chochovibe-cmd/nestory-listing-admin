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

protected_counts() {
  query_local -F '|' -c "select (select count(*) from public.product_drafts),(select count(*) from public.product_images),(select count(*) from public.product_variants),(select count(*) from public.profiles);"
}

echo "==> SD-1 package: capture protected row counts before reversible cycle"
before_counts="$(protected_counts | tail -n 1)"

echo "==> SD-1 package: return current local prototype state to production pre-SD1 shape"
psql_local < supabase/reconcile/2026-08-18_sd1_private_helpers_revert.sql >/dev/null

assert_count "$(query_local -c "select (to_regnamespace('private') is null)::int;")" 1 "private schema removed after revert"
assert_count "$(query_local -c "select has_function_privilege('authenticated','public.is_admin()','EXECUTE')::int;")" 1 "legacy authenticated is_admin restored"
assert_count "$(query_local -c "select has_function_privilege('anon','public.is_admin()','EXECUTE')::int;")" 1 "legacy PUBLIC role-helper execute restored"
assert_count "$(query_local -c "select has_function_privilege('anon','public.user_owns_image_batch(uuid)','EXECUTE')::int;")" 0 "batch helper remains non-PUBLIC after revert"

legacy_policy_count="$(query_local -c "select count(*) from pg_policies where schemaname='public' and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ '(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)\\(' and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) !~ 'private\\.(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)';")"
assert_count "$legacy_policy_count" 35 "legacy policy count after revert"

echo "==> SD-1 package: seed only the local migration-ledger state needed to mirror production precheck"
psql_local >/dev/null <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations(version, statements, name)
values
  ('20260818142712', '{}'::text[], 'baseline_existing_schema_20260818'),
  ('20260818142919', '{}'::text[], 'production_reconcile_20260818')
on conflict (version) do update set name=excluded.name;
delete from supabase_migrations.schema_migrations
where version not in ('20260818142712','20260818142919');
SQL

echo "==> SD-1 package: production precheck candidate"
precheck_output="$(psql_local -qAt < supabase/reconcile/2026-08-18_sd1_private_helpers_precheck.sql)"
if ! grep -q '^SD1_PRECHECK_OK$' <<<"$precheck_output"; then
  echo "ERROR: SD-1 precheck did not return SD1_PRECHECK_OK." >&2
  echo "$precheck_output" >&2
  exit 1
fi

echo "==> SD-1 package: apply exact already-prototyped helper SQL"
psql_local < supabase/verification/private-rls-helper-prototype.sql >/dev/null

echo "==> SD-1 package: postcheck candidate after apply"
postcheck_output="$(psql_local -qAt < supabase/reconcile/2026-08-18_sd1_private_helpers_postcheck.sql)"
if ! grep -q '^SD1_POSTCHECK_OK$' <<<"$postcheck_output"; then
  echo "ERROR: SD-1 postcheck did not return SD1_POSTCHECK_OK." >&2
  echo "$postcheck_output" >&2
  exit 1
fi

echo "==> SD-1 package: role/RLS runtime matrix after exact package apply"
bash scripts/test-supabase-role-rls-local.sh

echo "==> SD-1 package: execute tested inverse SQL"
psql_local < supabase/reconcile/2026-08-18_sd1_private_helpers_revert.sql >/dev/null

assert_count "$(query_local -c "select (to_regnamespace('private') is null)::int;")" 1 "private schema absent after package revert"
assert_count "$(query_local -c "select has_function_privilege('authenticated','public.current_user_role()','EXECUTE')::int;")" 1 "current_user_role ACL restored after package revert"
assert_count "$(query_local -c "select has_function_privilege('authenticated','public.user_owns_publish_batch(uuid)','EXECUTE')::int;")" 1 "publish batch helper ACL restored after package revert"

legacy_policy_count="$(query_local -c "select count(*) from pg_policies where schemaname='public' and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ '(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)\\(' and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) !~ 'private\\.(current_user_role|is_admin|is_reviewer|user_owns_image_batch|user_owns_items_in_image_batch|user_owns_publish_batch|user_owns_items_in_publish_batch)';")"
assert_count "$legacy_policy_count" 35 "legacy policy count after package revert"

after_revert_counts="$(protected_counts | tail -n 1)"
if [[ "$after_revert_counts" != "$before_counts" ]]; then
  echo "ERROR: protected row counts changed across SD-1 apply/revert cycle: before=$before_counts after=$after_revert_counts" >&2
  exit 1
fi

echo "==> SD-1 package: re-apply exact helper SQL and postcheck once more"
psql_local < supabase/verification/private-rls-helper-prototype.sql >/dev/null
postcheck_output="$(psql_local -qAt < supabase/reconcile/2026-08-18_sd1_private_helpers_postcheck.sql)"
if ! grep -q '^SD1_POSTCHECK_OK$' <<<"$postcheck_output"; then
  echo "ERROR: SD-1 second postcheck did not return SD1_POSTCHECK_OK." >&2
  echo "$postcheck_output" >&2
  exit 1
fi

after_reapply_counts="$(protected_counts | tail -n 1)"
if [[ "$after_reapply_counts" != "$before_counts" ]]; then
  echo "ERROR: protected row counts changed after SD-1 re-apply: before=$before_counts after=$after_reapply_counts" >&2
  exit 1
fi

echo "PASS: SD-1 precheck/apply/postcheck/revert/re-apply package cycle passed locally."
