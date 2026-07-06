import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const checks = [
  {
    name: "Next.js PWA scaffold exists",
    ok: exists("src/app/layout.tsx") && exists("src/app/page.tsx") && exists("package.json")
  },
  {
    name: "Supabase schema exists",
    ok: exists("supabase/migrations/001_initial_schema.sql")
  },
  {
    name: "Auth roles and RLS are defined",
    ok: /create type public\.user_role/.test(read("supabase/migrations/001_initial_schema.sql"))
      && /enable row level security/i.test(read("supabase/migrations/001_initial_schema.sql"))
      && /create policy/i.test(read("supabase/migrations/001_initial_schema.sql"))
  },
  {
    name: "Storage bucket plan exists",
    ok: /product-images/.test(read("supabase/migrations/001_initial_schema.sql"))
      && exists("docs/supabase-storage.md")
  },
  {
    name: "PWA draft creation defaults to pending_copy",
    ok: /status:\s*"pending_copy"/.test(read("src/components/listing/WorkspaceInputPanel.tsx"))
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
    ok: /claim_pending_generation/.test(read("supabase/migrations/001_initial_schema.sql"))
      && /for update skip locked/i.test(read("supabase/migrations/001_initial_schema.sql"))
      && /worker_lock_expires_at/i.test(read("supabase/migrations/001_initial_schema.sql"))
      && /worker_attempts < max_worker_attempts/i.test(read("supabase/migrations/001_initial_schema.sql"))
      && /grant execute on function public\.claim_pending_generation/i.test(read("supabase/migrations/001_initial_schema.sql"))
  },
  {
    name: "generation_mode fallback values are preserved",
    ok: /codex_skill.*api_llm.*manual/.test(read("supabase/migrations/001_initial_schema.sql").replace(/\n/g, " "))
  },
  {
    name: "publish_mode active/draft values are preserved",
    ok: /publish_mode as enum \('active', 'draft'\)/.test(read("supabase/migrations/001_initial_schema.sql"))
  },
  {
    name: "Shopify publish API is mock-safe and requires active confirmation",
    ok: /SHOPIFY_PUBLISH_MOCK/.test(read("src/lib/shopify/publishDraft.ts"))
      && /confirmActive/.test(read("src/app/api/drafts/[id]/publish/route.ts"))
      && /confirmActive/.test(read("src/app/api/drafts/batch/publish/route.ts"))
  },
  {
    name: "Matrixify fallback mapping exists",
    ok: exists("src/lib/csv/matrixify.ts") && /matrixify_csv/.test(read("src/app/api/exports/matrixify/route.ts"))
  },
  {
    name: "Local env file is ignored, not committed",
    ok: !exists(".env") && /\.env\.\*/.test(read(".gitignore"))
  },
  {
    name: "Generated dependency cache is ignored",
    ok: /\.pnpm-store\//.test(read(".gitignore"))
  },
  {
    name: "Sensitive field guard exists",
    ok: /guard_sensitive_product_draft_fields/.test(read("supabase/migrations/001_initial_schema.sql"))
      && /new\.publish_mode is distinct from old\.publish_mode/.test(read("supabase/migrations/001_initial_schema.sql"))
  },
  {
    name: "Non-reviewer status escalation is guarded",
    ok: /move drafts into generation, review, or publish states/.test(read("supabase/migrations/001_initial_schema.sql"))
      && /new\.status not in \('pending_input', 'pending_copy', 'needs_revision', 'archived'\)/.test(read("supabase/migrations/001_initial_schema.sql"))
  },
  {
    name: "RLS policy guide exists",
    ok: exists("docs/rls-policy-guide.md")
      && /guard_sensitive_product_draft_fields/.test(read("docs/rls-policy-guide.md"))
      && /WORKER_API_TOKEN/.test(read("docs/rls-policy-guide.md"))
  },
  {
    name: "Admin bootstrap and RLS smoke tests are documented",
    ok: exists("docs/admin-bootstrap.md")
      && /role = 'admin'/.test(read("docs/admin-bootstrap.md"))
      && exists("docs/rls-smoke-tests.md")
      && /Operator Cannot Escalate Workflow/.test(read("docs/rls-smoke-tests.md"))
  },
  {
    name: "Deployment checklist exists",
    ok: exists("docs/deployment-checklist.md")
      && /SHOPIFY_PUBLISH_MOCK=true/.test(read("docs/deployment-checklist.md"))
      && /Do not push or deploy from `main` directly/.test(read("docs/deployment-checklist.md"))
      && /ACTIVE publish can be triggered without confirmation/.test(read("docs/deployment-checklist.md"))
  },
  {
    name: "Local preview script exists",
    ok: exists("scripts/start-local.ps1")
      && /next.*start/i.test(read("scripts/start-local.ps1"))
      && /127\.0\.0\.1/.test(read("scripts/start-local.ps1"))
      && /scripts\/start-local\.ps1/.test(read("README.md"))
  },
  {
    name: "Local preflight script exists",
    ok: exists("scripts/preflight-local.ps1")
      && /verify-all\.mjs/.test(read("scripts/preflight-local.ps1"))
      && /\.env\.local exists; values are not printed/.test(read("scripts/preflight-local.ps1"))
      && /scripts\/preflight-local\.ps1/.test(read("README.md"))
  },
  {
    name: "PWA manifest exists",
    ok: exists("public/manifest.webmanifest")
      && exists("public/icon.svg")
      && /manifest:\s*"\/manifest\.webmanifest"/.test(read("src/app/layout.tsx"))
  },
  {
    name: "API contracts are documented",
    ok: exists("docs/api-contracts.md")
      && /POST \/api\/worker\/claim/.test(read("docs/api-contracts.md"))
      && /POST \/api\/drafts\/\{id\}\/request-revision/.test(read("docs/api-contracts.md"))
      && /POST \/api\/drafts\/\{id\}\/publish/.test(read("docs/api-contracts.md"))
      && /Matrixify CSV Fallback/.test(read("docs/api-contracts.md"))
  },
  {
    name: "Request revision API exists",
    ok: exists("src/app/api/drafts/[id]/request-revision/route.ts")
      && /needs_revision/.test(read("src/app/api/drafts/[id]/request-revision/route.ts"))
      && /requestRevision/.test(read("src/components/listing/ResultCard.tsx"))
      && /request-revision/.test(read("src/components/listing/ResultCard.tsx"))
  },
  {
    name: "Codex Skill rules and mock fixtures exist",
    ok: exists("docs/codex-skill-rules.md")
      && /chochonest-copywriter@2026-06-24-v1/.test(read("docs/codex-skill-rules.md"))
      && exists("fixtures/worker-complete-sample.json")
      && exists("fixtures/publish-active-sample.json")
      && exists("fixtures/matrixify-export-sample.json")
  },
  {
    name: "Mock flow verifier exists",
    ok: exists("scripts/verify-mock-flow.mjs")
      && /worker-complete-sample\.json/.test(read("scripts/verify-mock-flow.mjs"))
      && /Mock flow checks passed/.test(read("scripts/verify-mock-flow.mjs"))
      && /verify:mock-flow/.test(read("package.json"))
  },
  {
    name: "Mock Supabase seed exists",
    ok: exists("supabase/seeds/001_mock_draft.sql")
      && /00000000-0000-4000-8000-000000000001/.test(read("supabase/seeds/001_mock_draft.sql"))
      && /pending_copy/.test(read("supabase/seeds/001_mock_draft.sql"))
  },
  {
    name: "Manual QA checklist and UI states exist",
    ok: exists("docs/manual-qa-checklist.md")
      && /Active publish shows second browser confirmation/.test(read("docs/manual-qa-checklist.md"))
      && /Reviewer can export Matrixify CSV/.test(read("docs/manual-qa-checklist.md"))
      && exists("fixtures/ui-states.json")
  },
  {
    name: "Completion audit exists",
    ok: exists("docs/completion-audit.md")
      && /13 requested success criteria/.test(read("docs/completion-audit.md"))
      && /Do not mark v0.1 complete/.test(read("docs/completion-audit.md"))
  },
  {
    name: "Team handoff and PWA smoke evidence exist",
    ok: exists("docs/v0.1-team-handoff.md")
      && /Manual QA Still Needed/.test(read("docs/v0.1-team-handoff.md"))
      && exists("scripts/verify-pwa-smoke.mjs")
      && /verify:pwa-smoke/.test(read("package.json"))
      && /Read-Only Route Smoke/.test(read("docs/manual-qa-checklist.md"))
  }
];

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}`);
}

if (failed.length) {
  process.exit(1);
}
