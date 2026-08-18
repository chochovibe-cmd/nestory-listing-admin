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

snapshot_counts() {
  query_local -c "select concat_ws(':', (select count(*) from public.product_drafts), (select count(*) from public.product_images), (select count(*) from public.product_variants), (select count(*) from public.profiles));"
}

verify_rollback_state() {
  assert_scalar "$(query_local -c "select count(*) from pg_policies where schemaname='public' and tablename in ('ip_catalog','ip_characters','tag_rules','collection_rules');")" 0 "rollback catalog/rule policy count"

  assert_scalar "$(query_local -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('set_updated_at','touch_image_batches_updated_at','touch_publish_batches_updated_at') and 'search_path=pg_catalog'=any(coalesce(p.proconfig,'{}'::text[]));")" 0 "rollback timestamp search_path state"

  assert_scalar "$(query_local -c "select has_function_privilege('authenticated','public.handle_new_user()','EXECUTE')::int;")" 1 "rollback handle_new_user authenticated EXECUTE"
  assert_scalar "$(query_local -c "select has_function_privilege('anon','public.handle_new_user()','EXECUTE')::int;")" 1 "rollback handle_new_user anon EXECUTE"
  assert_scalar "$(query_local -c "select has_function_privilege('authenticated','public.guard_sensitive_product_draft_fields()','EXECUTE')::int;")" 1 "rollback sensitive guard authenticated EXECUTE"
  assert_scalar "$(query_local -c "select has_function_privilege('anon','public.guard_sensitive_product_draft_fields()','EXECUTE')::int;")" 1 "rollback sensitive guard anon EXECUTE"
}

before_counts="$(snapshot_counts)"

echo "==> Package cycle: return local DB to audited production pre-state"
psql_local < supabase/reconcile/2026-08-18_production_rollback.sql >/dev/null
verify_rollback_state

echo "==> Package cycle: production precheck must pass on audited pre-state"
psql_local < supabase/reconcile/2026-08-18_production_precheck.sql >/dev/null

echo "==> Package cycle: exact production apply"
psql_local < supabase/reconcile/2026-08-18_production_apply.sql >/dev/null

echo "==> Package cycle: exact production postcheck"
psql_local < supabase/reconcile/2026-08-18_production_postcheck.sql >/dev/null

echo "==> Package cycle: rollback and verify exact audited pre-state"
psql_local < supabase/reconcile/2026-08-18_production_rollback.sql >/dev/null
verify_rollback_state

echo "==> Package cycle: precheck must pass again after rollback"
psql_local < supabase/reconcile/2026-08-18_production_precheck.sql >/dev/null

echo "==> Package cycle: re-apply and postcheck to prove repeatable recovery path"
psql_local < supabase/reconcile/2026-08-18_production_apply.sql >/dev/null
psql_local < supabase/reconcile/2026-08-18_production_postcheck.sql >/dev/null

after_counts="$(snapshot_counts)"
if [[ "$after_counts" != "$before_counts" ]]; then
  echo "ERROR: production package changed protected business-row counts: before=$before_counts after=$after_counts" >&2
  exit 1
fi

echo "PASS: production precheck/apply/postcheck/rollback/re-apply package is locally reversible and data-preserving."
