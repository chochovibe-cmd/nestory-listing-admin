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

verify_d310a_columns() {
  assert_scalar "$(query_local -c "select count(*) from information_schema.columns where table_schema='public' and table_name='product_variants' and column_name in ('cost_is_inherited','sell_price_locked','compare_at_locked');")" 3 "D3.10A split override column count"
}

verify_shopify_full_sync_columns() {
  assert_scalar "$(query_local -c "select count(*) from information_schema.columns where table_schema='public' and table_name='product_drafts' and column_name in ('shopify_sync_status','shopify_synced_at','shopify_remote_updated_at','shopify_sync_hash','shopify_sync_error');")" 5 "G4 Shopify draft sync column count"
  assert_scalar "$(query_local -c "select count(*) from information_schema.columns where table_schema='public' and table_name='product_variants' and column_name in ('shopify_variant_id','shopify_inventory_item_id');")" 2 "G4 Shopify variant identity column count"
  assert_scalar "$(query_local -c "select count(*) from information_schema.columns where table_schema='public' and table_name='product_images' and column_name in ('shopify_media_id','shopify_file_id','shopify_source_hash');")" 3 "G4 Shopify image identity/source column count"
  assert_scalar "$(query_local -c "select to_regclass('public.shopify_sync_jobs') is not null;")" t "G4 Shopify sync ledger table"
  assert_scalar "$(query_local -c "select count(*) from pg_policies where schemaname='public' and tablename='shopify_sync_jobs';")" 1 "G4 Shopify sync ledger read policy"
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

echo "==> D3.10A: apply additive split-override migration"
psql_local < /tmp/nestory-forward-migrations/20260822223100_variant_split_override_semantics.sql >/dev/null
verify_d310a_columns

echo "==> D3.10A: rollback split-override columns and verify reversibility"
psql_local -c "alter table public.product_variants drop column if exists cost_is_inherited, drop column if exists sell_price_locked, drop column if exists compare_at_locked;" >/dev/null
assert_scalar "$(query_local -c "select count(*) from information_schema.columns where table_schema='public' and table_name='product_variants' and column_name in ('cost_is_inherited','sell_price_locked','compare_at_locked');")" 0 "D3.10A rollback column count"

echo "==> D3.10A: re-apply forward migration"
psql_local < /tmp/nestory-forward-migrations/20260822223100_variant_split_override_semantics.sql >/dev/null
verify_d310a_columns

echo "==> G4: apply additive Shopify full-sync migration"
psql_local < /tmp/nestory-forward-migrations/20260903100000_shopify_full_sync_state.sql >/dev/null
verify_shopify_full_sync_columns

echo "==> G4: rollback Shopify full-sync migration and verify reversibility"
psql_local -c "drop table if exists public.shopify_sync_jobs; alter table public.product_drafts drop column if exists shopify_sync_status, drop column if exists shopify_synced_at, drop column if exists shopify_remote_updated_at, drop column if exists shopify_sync_hash, drop column if exists shopify_sync_error; alter table public.product_variants drop column if exists shopify_variant_id, drop column if exists shopify_inventory_item_id; alter table public.product_images drop column if exists shopify_media_id, drop column if exists shopify_file_id, drop column if exists shopify_source_hash;" >/dev/null
assert_scalar "$(query_local -c "select count(*) from information_schema.columns where table_schema='public' and table_name='product_drafts' and column_name in ('shopify_sync_status','shopify_synced_at','shopify_remote_updated_at','shopify_sync_hash','shopify_sync_error');")" 0 "G4 rollback Shopify draft sync columns"
assert_scalar "$(query_local -c "select count(*) from information_schema.columns where table_schema='public' and table_name='product_images' and column_name in ('shopify_media_id','shopify_file_id','shopify_source_hash');")" 0 "G4 rollback Shopify image sync columns"
assert_scalar "$(query_local -c "select to_regclass('public.shopify_sync_jobs') is null;")" t "G4 rollback Shopify sync ledger table"

echo "==> G4: re-apply forward migration"
psql_local < /tmp/nestory-forward-migrations/20260903100000_shopify_full_sync_state.sql >/dev/null
verify_shopify_full_sync_columns

after_counts="$(snapshot_counts)"
if [[ "$after_counts" != "$before_counts" ]]; then
  echo "ERROR: production package changed protected business-row counts: before=$before_counts after=$after_counts" >&2
  exit 1
fi

echo "PASS: production package, D3.10A, and G4 Shopify full-sync migrations are locally reversible and data-preserving."
