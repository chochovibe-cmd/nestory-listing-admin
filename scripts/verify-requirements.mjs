import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function contains(relativePath, pattern) {
  return exists(relativePath) && pattern.test(read(relativePath));
}

const initialSchema = "supabase/migrations/001_initial_schema.sql";
const releaseReadiness = "docs/RELEASE_READINESS.md";
const productionSupabaseAudit = "docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md";

const checks = [
  {
    name: "Next.js PWA scaffold exists",
    ok: exists("src/app/layout.tsx") && exists("src/app/page.tsx") && exists("package.json")
  },
  {
    name: "Supabase schema and core RLS exist",
    ok: exists(initialSchema)
      && contains(initialSchema, /create type public\.user_role/)
      && contains(initialSchema, /enable row level security/i)
      && contains(initialSchema, /create policy/i)
  },
  {
    name: "Storage bucket plan exists",
    ok: contains(initialSchema, /product-images/) && exists("docs/supabase-storage.md")
  },
  {
    name: "PWA draft creation defaults to pending_copy",
    ok: contains("src/components/listing/WorkspaceInputPanel.tsx", /status:\s*"pending_copy"/)
  },
  {
    name: "Draft queue and review pages exist",
    ok: exists("src/app/drafts/page.tsx") && exists("src/app/review/page.tsx")
  },
  {
    name: "Worker claim/complete/fail APIs exist",
    ok: exists("src/app/api/worker/claim/route.ts")
      && exists("src/app/api/worker/complete/route.ts")
      && exists("src/app/api/worker/fail/route.ts")
  },
  {
    name: "Worker claim uses locked SQL queue",
    ok: contains(initialSchema, /claim_pending_generation/)
      && contains(initialSchema, /for update skip locked/i)
      && contains(initialSchema, /worker_lock_expires_at/i)
      && contains(initialSchema, /worker_attempts < max_worker_attempts/i)
  },
  {
    name: "Generation and publish enum fallbacks are preserved",
    ok: /codex_skill.*api_llm.*manual/.test(read(initialSchema).replace(/\n/g, " "))
      && contains(initialSchema, /publish_mode as enum \('active', 'draft'\)/)
  },
  {
    name: "Shopify publish API is mock-safe and requires active confirmation",
    ok: contains("src/lib/shopify/publishDraft.ts", /SHOPIFY_PUBLISH_MOCK/)
      && contains("src/app/api/drafts/[id]/publish/route.ts", /confirmActive/)
      && contains("src/app/api/drafts/batch/publish/route.ts", /confirmActive/)
  },
  {
    name: "Matrixify fallback mapping exists",
    ok: exists("src/lib/csv/matrixify.ts")
      && contains("src/app/api/exports/matrixify/route.ts", /matrixify_csv/)
  },
  {
    name: "Local environment and dependency caches are not committed",
    ok: !exists(".env")
      && contains(".gitignore", /\.env\.\*/)
      && contains(".gitignore", /\.pnpm-store\//)
  },
  {
    name: "Sensitive workflow field guard exists",
    ok: contains(initialSchema, /guard_sensitive_product_draft_fields/)
      && contains(initialSchema, /new\.publish_mode is distinct from old\.publish_mode/)
      && contains(initialSchema, /move drafts into generation, review, or publish states/)
  },
  {
    name: "RLS/admin security guides exist",
    ok: exists("docs/rls-policy-guide.md")
      && contains("docs/rls-policy-guide.md", /guard_sensitive_product_draft_fields/)
      && exists("docs/admin-bootstrap.md")
      && exists("docs/rls-smoke-tests.md")
      && contains("docs/rls-smoke-tests.md", /Operator Cannot Escalate Workflow/)
  },
  {
    name: "Local preview and preflight scripts exist",
    ok: exists("scripts/start-local.ps1")
      && contains("scripts/start-local.ps1", /next.*start/i)
      && exists("scripts/preflight-local.ps1")
      && contains("scripts/preflight-local.ps1", /verify-all\.mjs/)
      && contains("README.md", /scripts\/start-local\.ps1/)
      && contains("README.md", /scripts\/preflight-local\.ps1/)
  },
  {
    name: "PWA manifest exists",
    ok: exists("public/manifest.webmanifest")
      && exists("public/icon.svg")
      && contains("src/app/layout.tsx", /manifest:\s*"\/manifest\.webmanifest"/)
  },
  {
    name: "Request revision API exists",
    ok: exists("src/app/api/drafts/[id]/request-revision/route.ts")
      && contains("src/app/api/drafts/[id]/request-revision/route.ts", /needs_revision/)
      && contains("src/components/listing/ResultCard.tsx", /request-revision/)
  },
  {
    name: "Mock flow fixtures and verifier exist",
    ok: exists("fixtures/worker-complete-sample.json")
      && exists("fixtures/publish-active-sample.json")
      && exists("fixtures/matrixify-export-sample.json")
      && exists("fixtures/ui-states.json")
      && exists("scripts/verify-mock-flow.mjs")
      && contains("scripts/verify-mock-flow.mjs", /worker-complete-sample\.json/)
      && contains("package.json", /verify:mock-flow/)
  },
  {
    name: "Mock Supabase seed exists",
    ok: exists("supabase/seeds/001_mock_draft.sql")
      && contains("supabase/seeds/001_mock_draft.sql", /00000000-0000-4000-8000-000000000001/)
      && contains("supabase/seeds/001_mock_draft.sql", /pending_copy/)
  },
  {
    name: "Canonical release readiness documents deployment safety and API contracts",
    ok: exists(releaseReadiness)
      && contains(releaseReadiness, /SHOPIFY_PUBLISH_MOCK=true/)
      && contains(releaseReadiness, /ACTIVE publish must always require explicit confirmation/)
      && contains(releaseReadiness, /POST \/api\/worker\/claim/)
      && contains(releaseReadiness, /POST \/api\/drafts\/\{id\}\/request-revision/)
      && contains(releaseReadiness, /POST \/api\/drafts\/\{id\}\/publish/)
      && contains(releaseReadiness, /Matrixify CSV Fallback/)
  },
  {
    name: "Canonical release readiness documents manual QA and incomplete states",
    ok: contains(releaseReadiness, /Manual QA matrix/)
      && contains(releaseReadiness, /ACTIVE publish shows a second explicit/)
      && contains(releaseReadiness, /Reviewer can export Matrixify CSV/)
      && contains(releaseReadiness, /Read-Only Route Smoke/)
      && contains(releaseReadiness, /Manual QA Still Needed is a valid status/)
  },
  {
    name: "AI handoff and current-status sources exist",
    ok: exists("AI_START_HERE.md")
      && exists("docs/CURRENT_STATUS.md")
      && exists("docs/STABILIZATION_PLAN.md")
      && exists("AGENTS.md")
      && contains("AI_START_HERE.md", /CURRENT_STATUS\.md/)
      && contains(releaseReadiness, /Every new coding session should start with/)
  },
  {
    name: "Production Supabase reconciliation is documented and replay-safe",
    ok: exists(productionSupabaseAudit)
      && contains(productionSupabaseAudit, /nestory-listing-tool-test/)
      && contains(productionSupabaseAudit, /001–039 live-state reconciliation complete/i)
      && contains(productionSupabaseAudit, /Do not replay `001–039`/i)
      && contains(productionSupabaseAudit, /004_ip_tag_collection_tables\.sql/)
      && contains(productionSupabaseAudit, /ip_catalog/)
      && contains(productionSupabaseAudit, /ip_characters/)
      && contains(productionSupabaseAudit, /tag_rules/)
      && contains(productionSupabaseAudit, /collection_rules/)
      && contains(productionSupabaseAudit, /8 policies total/i)
      && exists("supabase/reconcile/2026-08-18_production_reconcile_draft.sql")
  },
  {
    name: "PWA smoke verifier remains wired",
    ok: exists("scripts/verify-pwa-smoke.mjs")
      && contains("package.json", /verify:pwa-smoke/)
  }
];

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}`);
}

if (failed.length) {
  process.exit(1);
}

console.log(`Requirements checks passed: ${checks.length} current contracts`);
