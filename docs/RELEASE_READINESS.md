# Nestory — Release Readiness

> Canonical release / QA / deployment gate for humans and AI agents.
> Current status is intentionally conservative: a check being documented does **not** mean it has passed.
> For day-to-day progress read `AI_START_HERE.md` and `docs/CURRENT_STATUS.md` first.

Updated: 2026-08-18

## 1. Release policy

Nestory is not release-ready merely because a preview deploy succeeds. A release candidate must pass the repository CI gate and the manual checks below.

Required automated gate:
1. `pnpm install --frozen-lockfile`
2. `pnpm run verify:all`
3. `pnpm run typecheck`
4. `pnpm run build`

Required manual/runtime gate:
- authenticated app smoke
- role/RLS cases
- mobile ResultCard regression cases
- Variant regression cases
- Shopify mock publish
- one controlled real-product E2E only after production configuration is explicitly approved

Do not mark the current stabilization stack complete until the automated gate is green and the relevant runtime cases have been exercised.

## 2. Deployment safety checklist

Before any production deploy:
- Review `AI_START_HERE.md`, `docs/CURRENT_STATUS.md`, and `docs/STABILIZATION_PLAN.md`.
- Confirm the intended branch/commit and review its diff.
- Confirm GitHub CI is green.
- Keep `SHOPIFY_PUBLISH_MOCK=true` unless a real Shopify publish test is explicitly intended and approved.
- ACTIVE publish must always require explicit confirmation; do not weaken the existing `confirmActive` guard.
- Never place `SUPABASE_SERVICE_ROLE_KEY`, Shopify client secret, AI API keys, worker tokens, or webhooks in browser storage or `NEXT_PUBLIC_*` variables.
- Do not replay historical Supabase migrations `001–039` into the live database. Read `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md` first.
- Do not push/deploy directly from the canonical/default branch as an ad-hoc test. Use a reviewed branch/PR and the CI gate.
- A Vercel preview failure caused by account build-rate-limit is not equivalent to a code build failure; GitHub CI is the independent compile gate.

## 3. Core API contracts that must remain stable

These are contract anchors, not an exhaustive API reference.

### Worker
- `POST /api/worker/claim` — atomically claims eligible generation work.
- `POST /api/worker/complete` — records successful generation output.
- `POST /api/worker/fail` — records failed generation work.

### Draft review
- `POST /api/drafts/{id}/request-revision` — returns a draft to `needs_revision` without bypassing role/RLS rules.
- Review/approve actions must preserve reviewer/admin authorization semantics.

### Publish
- `POST /api/drafts/{id}/publish` — single publish; ACTIVE requires `confirmActive`.
- Batch publish must preserve the same ACTIVE-confirmation and publisher-role rules.
- Shopify mock mode must never create a real product.
- Duplicate variant combinations must be rejected before publish.

### Matrixify CSV fallback
- Matrixify CSV Fallback remains available independently of Shopify API publish.
- Export mapping is implemented under `src/lib/csv/matrixify.ts` and the export route.

### Archive
- Batch archive/unarchive must authorize requested draft IDs through the signed-in/RLS client before any service-role mutation.
- Operator scope = own drafts; reviewer/admin may act across the team according to RLS.

## 4. Mock fixtures / deterministic checks

Keep these fixtures available for source-contract and mock-flow checks:
- `fixtures/worker-complete-sample.json`
- `fixtures/publish-active-sample.json`
- `fixtures/matrixify-export-sample.json`
- `fixtures/ui-states.json`

Generation/copy rules are governed by current source + `AGENTS.md` / canonical project docs. Do not make CI depend on a retired hard-coded Codex skill version string unless that exact version is again a runtime contract.

## 5. Manual QA matrix

### Publish safety
- ACTIVE publish shows a second explicit browser/user confirmation.
- DRAFT publish does not require the ACTIVE confirmation but still enforces publisher role.
- `SHOPIFY_PUBLISH_MOCK=true` produces no real Shopify product.
- Reviewer can export Matrixify CSV.

### Role / RLS
- Operator can read/update own eligible draft.
- Operator cannot update another member's draft by submitting its ID to a service-role API.
- Reviewer/admin can read team drafts according to current policy.
- Operator cannot directly write admin-governed catalog/rule tables.

### Mobile ResultCard
- Long-press blank card surface enters selection mode.
- Expand/collapse control remains available in selection mode.
- Touching an interactive control does not trigger card long-press/swipe.
- Swipe still works from non-interactive card surface.

### Variant editor
- Destructive axis change does not commit dimensions before confirmation.
- Duplicate hand-filled option combinations are protected from silent loss.
- Desktop picker first/middle/last-column hover preview stays visible within containment.

### Read-Only Route Smoke
Use `scripts/verify-pwa-smoke.mjs` against a running app and verify `/`, `/login`, `/drafts`, `/drafts/new`, and `/review` return the expected shell/auth states.

## 6. Current completion status

Current stabilization work has multiple implemented branches but still requires complete CI/runtime validation before merge/release. See:
- `docs/CURRENT_STATUS.md`
- `docs/STABILIZATION_PLAN.md`
- `docs/REGRESSION_AUDIT.md`
- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`

Do not interpret historical v0.1 completion/audit filenames as the current source of truth. The canonical completion decision is this release gate plus `CURRENT_STATUS`.

## 7. Team / AI handoff evidence

Every new coding session should start with:
1. `AI_START_HERE.md`
2. `docs/CURRENT_STATUS.md`
3. `AGENTS.md`
4. `docs/STABILIZATION_PLAN.md` and the relevant audit when changing stabilized areas

Before modifying code, confirm current branch/HEAD and whether the issue already has a stabilization branch. After modifying code, update the canonical handoff/status/audit documentation and keep the change scope isolated.

Manual QA Still Needed is a valid status. Agents must not convert an unexecuted manual check into a claimed pass.
