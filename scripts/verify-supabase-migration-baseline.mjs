import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const activeDir = path.join(root, "supabase", "migrations");
const archiveDir = path.join(root, "supabase", "history", "pre_tracking_migrations");

const expectedActive = [
  "20260818142712_baseline_existing_schema_20260818.sql",
  "20260818142919_production_reconcile_20260818.sql"
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

const active = files(activeDir);
if (JSON.stringify(active) !== JSON.stringify(expectedActive)) {
  fail(`active Supabase migration queue must match production ledger exactly; found ${active.join(", ")}`);
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

const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "supabase-local.yml"), "utf8");
if (!workflow.includes("cp supabase/history/pre_tracking_migrations/*.sql /tmp/nestory-migrations/")) {
  fail("free local DB gate must bootstrap from the pre-tracking archive");
}
if (workflow.includes("cp supabase/migrations/*.sql /tmp/nestory-migrations/")) {
  fail("free local DB gate must not replay the active tracked migration queue as historical bootstrap SQL");
}

console.log("PASS: Supabase migration baseline/archive contract is intact.");
