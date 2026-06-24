# v0.1 Deployment Checklist

This checklist is for the first safe test deployment of the Nestory team listing
admin. It assumes mock-safe Shopify publishing.

## 0. Source Control

- Confirm the folder is a git repository.
- Create a branch before continuing:

```powershell
git checkout -b codex/nestory-v0.1-safety-skeleton
```

- Confirm `.env`, `.env.local`, and real credentials are ignored.
- Do not push or deploy from `main` directly.

## 1. Install And Verify Locally

Install dependencies:

```powershell
pnpm install
```

Run checks:

```powershell
pnpm run verify:all
pnpm run verify:static
pnpm run verify:requirements
pnpm run verify:contracts
pnpm run verify:sql
pnpm run verify:no-secrets
pnpm run typecheck
pnpm run build
```

If `pnpm` is unavailable, use npm equivalents after installing Node/npm.

## 2. Supabase Test Project

- Create a test Supabase project.
- Apply:

```text
supabase/migrations/001_initial_schema.sql
```

- Confirm `product-images` Storage bucket exists.
- Confirm RLS is enabled on all public tables.
- Confirm `claim_pending_generation()` can only be executed by `service_role`.

Optional mock seed for faster API testing:

```text
supabase/seeds/001_mock_draft.sql
```

## 3. Environment Variables

Create local `.env.local` from `.env.example`. Do not commit it.

Required for mock flow:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WORKER_API_TOKEN=
SHOPIFY_PUBLISH_MOCK=true
```

Optional for notification smoke tests:

```text
MAKE_WEBHOOK_URL=
```

Do not fill real Shopify production credentials for v0.1 mock testing.

## 4. Admin Bootstrap

Follow:

```text
docs/admin-bootstrap.md
```

Create:

```text
admin@example.com      role = admin
operator@example.com   role = operator
reviewer@example.com   role = reviewer
```

## 5. RLS Smoke Tests

Run scenarios in:

```text
docs/rls-smoke-tests.md
```

Required pass conditions:

- Operator can create a draft.
- Operator cannot move a draft to `ready_for_review`.
- Operator cannot write `shopify_product_id`.
- Worker claim/complete can move a draft to `ready_for_review`.
- Reviewer can approve.
- ACTIVE publish requires `confirmActive=true`.
- CSV fallback is reviewer/admin only.

## 6. PWA Mock Flow

Run:

```text
docs/mock-flow.md
```

Required pass conditions:

- `/drafts/new` creates `pending_copy`.
- `/drafts` shows the queue item.
- `/api/worker/claim` claims the item once.
- `/api/worker/complete` writes copy and sets `ready_for_review`.
- `/review` shows the item.
- `/drafts/{id}` allows review edits.
- ACTIVE publish shows two browser confirmations.
- Mock publish sets `active_published` without a real Shopify call.
- CSV fallback downloads a Matrixify CSV and sets `csv_ready`.

## 7. Shopify Safety

Keep:

```text
SHOPIFY_PUBLISH_MOCK=true
```

Do not set real Shopify credentials until:

- local build passes,
- Supabase RLS smoke tests pass,
- mock publish flow passes,
- Matrixify fallback CSV has been inspected,
- a Shopify test store is ready.

Before real Shopify testing:

- Use a test store.
- Use a token scoped only for required product permissions.
- Test `publish_mode = draft` first.
- Verify whether the `ACTIVE` product status also publishes to the intended
  sales channel, or whether a follow-up `publishablePublish` mutation is needed.

## 8. Go / No-Go

Go for v0.1 mock demo only if:

- All verification scripts pass.
- Build passes.
- RLS smoke tests pass.
- Manual QA checklist passes.
- No real credentials are committed.
- `.env.local` exists only locally.
- Shopify publish is still mock-safe.

No-go if:

- `.env` or real keys appear in source control.
- `typecheck` or `build` fails.
- Operator can write system fields.
- Worker needs direct service role access outside server routes.
- ACTIVE publish can be triggered without confirmation.
