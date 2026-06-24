# v0.1 Completion Audit

This audit maps the 13 requested success criteria to current evidence in the
workspace. It intentionally distinguishes implemented/static evidence from
runtime evidence that still requires git and a test Supabase project.

## Current Result

Status: **partially complete, blocked on git/Supabase runtime for final proof**

The app skeleton, schema, routes, contracts, mock fixtures, and safety documents
are implemented. Final completion still needs:

- git branch creation,
- Supabase migration/runtime flow test.

## Criteria

| # | Criterion | Current status | Evidence | Remaining proof |
| --- | --- | --- | --- | --- |
| 1 | Create a new branch, do not edit main | Blocked | Current folder has no `.git`; `git` is unavailable on PATH | Initialize/open git repo and create `codex/nestory-v0.1-safety-skeleton` |
| 2 | Do not commit `.env` or real keys | Implemented/static verified | `.gitignore`, `.env.example`, repeated safety scans, no `.env` present, `.pnpm-store/` ignored, `pnpm-lock.yaml` scanned | Re-check before any commit |
| 3 | Next.js PWA team admin skeleton | Implemented and build verified | `package.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `public/manifest.webmanifest`, `public/icon.svg`, `tsc --noEmit`, `next build` | Runtime UI QA |
| 4 | Supabase schema, Auth roles, RLS, Storage spec | Implemented/static verified | `supabase/migrations/001_initial_schema.sql`, `docs/supabase-storage.md`, `docs/rls-policy-guide.md`, `scripts/verify-sql-schema.mjs` | Apply migration to test Supabase |
| 5 | Product can be added from PWA into `pending_copy` | Implemented/static and mock-flow verified | `src/components/listing/ProductInputForm.tsx`, `scripts/verify-requirements.mjs`, `scripts/verify-mock-flow.mjs`, `supabase/seeds/001_mock_draft.sql` | Run PWA with test Supabase and submit draft |
| 6 | Product queue page and review page exist | Implemented/build verified | `src/app/drafts/page.tsx`, `src/app/review/page.tsx`, `src/app/drafts/[id]/page.tsx`, setup notice env guard, `next build` | Runtime UI QA with Supabase env |
| 7 | Worker `claim / complete / fail` APIs | Implemented/static verified | `src/app/api/worker/*`, `docs/worker-contract.md`, `docs/api-contracts.md` | Runtime API test with `WORKER_API_TOKEN` |
| 8 | Preserve `generation_mode = codex_skill | api_llm | manual` | Implemented/static verified | SQL enum, TS domain type, `scripts/verify-sql-schema.mjs` | Supabase migration verification |
| 9 | Preserve `publish_mode = active | draft` | Implemented/static verified | SQL enum, TS domain type, publish UI, `scripts/verify-requirements.mjs` | Supabase migration verification |
| 10 | Shopify publish payload/API, no real token/live publish today | Implemented/static and mock-flow verified | `src/lib/shopify/payload.ts`, `src/app/api/drafts/[id]/publish/route.ts`, `SHOPIFY_PUBLISH_MOCK=true` default, `docs/shopify-publish-payload.md`, `fixtures/publish-active-sample.json`, `scripts/verify-mock-flow.mjs` | Mock publish runtime test |
| 11 | Matrixify CSV fallback mapping | Implemented/static and mock-flow verified | `src/lib/csv/matrixify.ts`, `src/app/api/exports/matrixify/route.ts`, `scripts/verify-contracts.mjs`, `scripts/verify-mock-flow.mjs` | Download CSV in runtime |
| 12 | ACTIVE publish button has double confirmation | Implemented/static verified | `src/components/listing/DraftReviewForm.tsx`, `docs/manual-qa-checklist.md` | Browser QA confirmation |
| 13 | Report each phase with files/functions/risks/next step | Ongoing | Conversation updates and `docs/v0.1-status-report.md` | Continue reporting until final verification |

## Verification Commands Available Without Dependencies

These use the bundled Node runtime and do not need npm packages:

```powershell
node scripts/verify-static.mjs
node scripts/verify-requirements.mjs
node scripts/verify-contracts.mjs
node scripts/verify-sql-schema.mjs
node scripts/verify-no-secrets.mjs
node scripts/verify-all.mjs
```

Current local result:

```text
verify-static: passed
verify-requirements: passed
verify-contracts: passed
verify-sql-schema: passed
verify-mock-flow: passed
verify-no-secrets: passed
verify-all: passed
```

## Environment Blockers

Observed blockers in this workspace:

- `git` command unavailable.
- No `.git` directory present.
- `npm`, `npx`, and `corepack` unavailable on PATH; local verification uses bundled Node and bundled pnpm.
- No Supabase test project/env has been applied yet, so runtime database/RLS/storage flow remains unverified.
- `.pnpm-store/`, `node_modules/`, and `.next/` are generated locally and ignored by `.gitignore`.

## Dependency And Build Verification

Current dependency/build result:

```text
pnpm install --offline --store-dir .pnpm-store: passed
tsc --noEmit: passed
next build: passed
```

`pnpm-workspace.yaml` explicitly rejects dependency build scripts for `sharp`
and `unrs-resolver`, which keeps the install policy conservative for v0.1.

## Completion Gate

Do not mark v0.1 complete until all are true:

- Branch exists.
- Dependencies are installed.
- `typecheck` passes.
- `build` passes.
- Migration applies in test Supabase.
- Mock flow passes:
  - PWA draft creation,
  - image upload,
  - worker claim,
  - worker complete,
  - review,
  - mock publish,
  - Matrixify fallback.
- No real credentials are committed.
