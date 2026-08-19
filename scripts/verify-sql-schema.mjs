import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const historicalDir = path.join(root, "supabase", "history", "pre_tracking_migrations");
const sql = fs.readFileSync(path.join(historicalDir, "001_initial_schema.sql"), "utf8");
const runtimePermissionsSql = fs.existsSync(path.join(historicalDir, "003_runtime_permissions_patch.sql"))
  ? fs.readFileSync(path.join(historicalDir, "003_runtime_permissions_patch.sql"), "utf8")
  : "";
const seed = fs.readFileSync(path.join(root, "supabase/seeds/001_mock_draft.sql"), "utf8");

function requirePatterns(label, patterns) {
  return patterns
    .filter((pattern) => !pattern.test(sql))
    .map((pattern) => `${label} missing ${pattern}`);
}

const errors = [
  ...requirePatterns("tables", [
    /create table public\.profiles/i,
    /create table public\.product_drafts/i,
    /create table public\.product_images/i,
    /create table public\.product_variants/i,
    /create table public\.generation_runs/i,
    /create table public\.publish_jobs/i,
    /create table public\.automation_logs/i,
    /create table public\.review_logs/i
  ]),
  ...requirePatterns("generation fallback columns", [
    /source_url text/i,
    /generation_mode public\.generation_mode not null default 'codex_skill'/i,
    /generation_provider public\.generation_provider not null default 'codex'/i,
    /generation_status public\.generation_status not null default 'pending'/i,
    /generation_rule_version text/i,
    /generation_model text/i,
    /generation_cost_estimate numeric/i,
    /generation_error text/i,
    /worker_id text/i,
    /worker_locked_at timestamptz/i,
    /worker_lock_expires_at timestamptz/i,
    /worker_attempts integer not null default 0/i,
    /max_worker_attempts integer not null default 3/i,
    /next_retry_at timestamptz/i
  ]),
  ...requirePatterns("publish fallback columns", [
    /publish_mode public\.publish_mode not null default 'active'/i,
    /publish_method public\.publish_method not null default 'shopify_api'/i,
    /publish_status public\.publish_status not null default 'pending'/i,
    /shopify_product_id text/i,
    /shopify_admin_url text/i,
    /shopify_handle text/i,
    /shopify_tags text\[\] not null default '\{\}'/i,
    /shopify_collections text\[\] not null default '\{\}'/i,
    /metafields_json jsonb not null default '\{\}'::jsonb/i,
    /generated_payload_json jsonb not null default '\{\}'::jsonb/i,
    /shopify_payload_preview jsonb not null default '\{\}'::jsonb/i
  ]),
  ...requirePatterns("image reserved fields", [
    /image_type text not null check/i,
    /original_file_url text/i,
    /processed_file_url text/i,
    /generated_file_url text/i,
    /alt_text text/i,
    /ocr_text text/i,
    /translated_text text/i,
    /processing_status text not null default 'uploaded'/i,
    /processing_error text/i
  ]),
  ...requirePatterns("enum values", [
    /create type public\.generation_mode as enum \('codex_skill', 'api_llm', 'manual'\)/i,
    /create type public\.publish_mode as enum \('active', 'draft'\)/i,
    /create type public\.publish_method as enum \('shopify_api', 'matrixify_csv', 'manual'\)/i,
    /'active_published'/i,
    /'draft_created'/i,
    /'api_failed'/i,
    /'csv_ready'/i
  ]),
  ...requirePatterns("security functions and triggers", [
    /handle_new_user\(\)/i,
    /current_user_role\(\)/i,
    /guard_sensitive_product_draft_fields\(\)/i,
    /product_drafts_guard_sensitive_fields/i,
    /claim_pending_generation/i,
    /for update skip locked/i,
    /worker_attempts < max_worker_attempts/i,
    /worker_lock_expires_at is null or worker_lock_expires_at <= now\(\)/i,
    /requeue_revision_for_generation/i
  ]),
  ...requirePatterns("RLS and storage", [
    /alter table public\.product_drafts enable row level security/i,
    /create policy "operators can insert drafts"/i,
    /create policy "operators update own unpublished drafts"/i,
    /d\.status in \('pending_input', 'pending_copy', 'needs_revision', 'ready_for_review'\)/i,
    /insert into storage\.buckets/i,
    /'product-images'/i,
    /authenticated users can upload product images/i,
    /public can read product images/i
  ])
];

if (runtimePermissionsSql) {
  for (const pattern of [
    /grant usage on schema public to anon, authenticated, service_role/i,
    /grant all privileges on all tables in schema public to service_role/i,
    /grant select, insert, update on public\.product_drafts to authenticated/i,
    /grant select, insert, update, delete on public\.product_images to authenticated/i,
    /grant execute on function public\.claim_pending_generation\(integer, text, text\) to service_role/i
  ]) {
    if (!pattern.test(runtimePermissionsSql)) {
      errors.push(`runtime permissions missing ${pattern}`);
    }
  }
}

const seedChecks = [
  /00000000-0000-4000-8000-000000000001/,
  /00000000-0000-4000-8000-000000000101/,
  /pending_copy/,
  /codex_skill/,
  /shopify_api/,
  /https:\/\/example\.com\/nestory-mock-main\.jpg/
];

for (const pattern of seedChecks) {
  if (!pattern.test(seed)) {
    errors.push(`seed missing ${pattern}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("SQL schema checks passed from pre-tracking archive");
