import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const activeDir = path.join(root, "supabase", "migrations");
const archiveDir = path.join(root, "supabase", "history", "pre_tracking_migrations");

const expectedActive = [
  "20260818142712_baseline_existing_schema_20260818.sql",
  "20260818142919_production_reconcile_20260818.sql",
  "20260822223100_variant_split_override_semantics.sql",
  "20260902090000_guard_current_image_batch_pointer.sql",
  "20260903100000_shopify_full_sync_state.sql"
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

function withoutDollarQuotedFunctions(sql) {
  return sql.replace(
    /create\s+(?:or\s+replace\s+)?function\b[\s\S]*?\bas\s+\$\$[\s\S]*?\$\$\s*;/gi,
    ""
  );
}

const active = files(activeDir);
if (JSON.stringify(active) !== JSON.stringify(expectedActive)) {
  fail(`active Supabase migration queue must match the tracked production ledger; found ${active.join(", ")}`);
}

const archived = files(archiveDir);
if (archived.length !== 39) {
  fail(`pre-tracking migration archive must contain exactly 39 SQL files; found ${archived.length}`);
}

for (let index = 1; index <= 39; index += 1) {
  const prefix = String(index).padStart(3, "0") + "_";
  if (!archived.some((name) => name.startsWith(prefix))) {
    fail(`pre-tracking archive is missing historical migration ${String(index).padStart(3, "0")}`);
  }
}

if (active.some((name) => /^\d{3}_/.test(name))) {
  fail("historical 001–039 SQL must never re-enter the active migration queue");
}

const baseline = fs.readFileSync(path.join(activeDir, expectedActive[0]), "utf8");
for (const required of [
  "first tracked production migration",
  "admin','operator','reviewer",
  "BASELINE FAIL",
  "Historical SQL 001–039 predates tracking"
]) {
  if (!baseline.includes(required)) {
    fail(`baseline marker is missing required contract text: ${required}`);
  }
}

const reconcile = fs.readFileSync(path.join(activeDir, expectedActive[1]), "utf8");
const requiredReconcileFragments = [
  "ip_catalog_select_authenticated",
  "ip_catalog_write_admin",
  "ip_characters_select_authenticated",
  "ip_characters_write_admin",
  "tag_rules_select_authenticated",
  "tag_rules_write_admin",
  "collection_rules_select_authenticated",
  "collection_rules_write_admin",
  "alter function public.set_updated_at()",
  "alter function public.touch_image_batches_updated_at()",
  "alter function public.touch_publish_batches_updated_at()",
  "revoke execute on function public.guard_sensitive_product_draft_fields()",
  "revoke execute on function public.handle_new_user()"
];
for (const fragment of requiredReconcileFragments) {
  if (!reconcile.includes(fragment)) {
    fail(`tracked reconcile migration is missing: ${fragment}`);
  }
}
if (/alter function public\.rls_auto_enable|revoke execute on function public\.rls_auto_enable/i.test(reconcile)) {
  fail("hosted-only rls_auto_enable must stay outside the minimal tracked reconcile");
}

const splitOverrides = fs.readFileSync(path.join(activeDir, expectedActive[2]), "utf8");
for (const fragment of [
  "alter table public.product_variants",
  "add column if not exists cost_is_inherited boolean",
  "add column if not exists sell_price_locked boolean",
  "add column if not exists compare_at_locked boolean",
  "NULL means the row predates D3.10A"
]) {
  if (!splitOverrides.includes(fragment)) {
    fail(`D3.10A additive variant migration is missing: ${fragment}`);
  }
}
if (/drop\s+column|alter\s+column[^;]+set\s+not\s+null|update\s+public\.product_variants/i.test(splitOverrides)) {
  fail("D3.10A variant migration must stay additive/null-preserving for legacy fallback");
}

const batchPointerGuard = fs.readFileSync(path.join(activeDir, expectedActive[3]), "utf8");
for (const fragment of [
  "create or replace function public.guard_sensitive_product_draft_fields()",
  "new.current_image_batch_id is distinct from old.current_image_batch_id",
  "role in ('admin', 'reviewer')",
  "coalesce(auth.jwt() ->> 'role', '') = 'service_role'"
]) {
  if (!batchPointerGuard.includes(fragment)) {
    fail(`P1-AUTH batch-pointer guard migration is missing: ${fragment}`);
  }
}
if (/drop\s+column|delete\s+from|update\s+public\.product_drafts/i.test(batchPointerGuard)) {
  fail("P1-AUTH batch-pointer migration must only replace the guard function, never mutate draft rows");
}

const shopifyFullSync = fs.readFileSync(path.join(activeDir, expectedActive[4]), "utf8");
for (const fragment of [
  "shopify_sync_status",
  "product_drafts_shopify_sync_status_check",
  "shopify_variant_id",
  "shopify_inventory_item_id",
  "shopify_media_id",
  "shopify_file_id",
  "shopify_source_hash",
  "create table if not exists public.shopify_sync_jobs",
  "shopify_sync_jobs_operation_check",
  "shopify_sync_jobs_status_check",
  "create or replace function public.mark_linked_product_draft_dirty()",
  "create or replace function public.mark_linked_product_child_dirty()",
  "update public.product_drafts",
  "alter table public.shopify_sync_jobs enable row level security",
  "grant all privileges on public.shopify_sync_jobs to service_role"
]) {
  if (!shopifyFullSync.includes(fragment)) {
    fail(`G4 full-sync migration is missing: ${fragment}`);
  }
}
const shopifyFullSyncTopLevel = withoutDollarQuotedFunctions(shopifyFullSync);
if (/drop\s+column|delete\s+from|update\s+public\.(product_drafts|product_variants|product_images)/i.test(shopifyFullSyncTopLevel)) {
  fail("G4 full-sync migration must stay additive and must not mutate existing rows");
}

const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "supabase-local.yml"), "utf8");
if (!workflow.includes("cp supabase/history/pre_tracking_migrations/*.sql /tmp/nestory-migrations/")) {
  fail("free local DB gate must bootstrap from the pre-tracking archive");
}
if (workflow.includes("cp supabase/migrations/*.sql /tmp/nestory-migrations/")) {
  fail("free local DB gate must not replay the active tracked migration queue as historical bootstrap SQL");
}
if (!workflow.includes("cp supabase/migrations/20260822223100_variant_split_override_semantics.sql /tmp/nestory-forward-migrations/")) {
  fail("D3.10A forward migration must be staged explicitly for the local reversible gate");
}
if (!workflow.includes("cp supabase/migrations/20260903100000_shopify_full_sync_state.sql /tmp/nestory-forward-migrations/")) {
  fail("G4 full-sync migration must be staged explicitly for the local reversible gate");
}

const productionPackageTest = fs.readFileSync(path.join(root, "scripts", "test-supabase-production-package-local.sh"), "utf8");
for (const fragment of [
  "D3.10A: apply additive split-override migration",
  "verify_d310a_columns",
  "drop column if exists cost_is_inherited",
  "D3.10A: re-apply forward migration",
  "G4: apply additive Shopify full-sync migration",
  "verify_shopify_full_sync_columns",
  "G4: re-apply forward migration"
]) {
  if (!productionPackageTest.includes(fragment)) {
    fail(`D3.10A local migration apply/rollback gate is missing: ${fragment}`);
  }
}

console.log("PASS: Supabase migration baseline/archive contract is intact.");
