# Manual QA Checklist v0.1

Use this checklist after dependencies install, the app builds, and a test
Supabase project is configured. Keep `SHOPIFY_PUBLISH_MOCK=true`.

For current handoff context and read-only route smoke evidence, see
`docs/v0.1-team-handoff.md`.

## Read-Only Route Smoke

- [x] `/` returns 200 on the local dev server.
- [x] `/login` returns 200 on the local dev server.
- [x] `/drafts` returns 200 and shows a signed-out prompt.
- [x] `/drafts/new` returns 200 and shows a signed-out prompt.
- [x] `/review` returns 200 and shows a signed-out prompt.

## Login

- [ ] Visiting `/drafts/new` while signed out shows a login prompt.
- [ ] Visiting `/drafts` while signed out shows a login prompt.
- [ ] Visiting `/review` while signed out shows a login prompt.
- [ ] Team login works with a test Supabase Auth user.

## New Draft

- [ ] `/drafts/new` shows product title, CNY price, category, Taobao URL, and note fields.
- [ ] Submitting without title fails client-side.
- [ ] Submitting without valid CNY price fails client-side.
- [ ] A valid submission redirects to `/drafts/{id}`.
- [ ] Created draft has:
  - [ ] `status = pending_copy`
  - [ ] `generation_mode = codex_skill`
  - [ ] `generation_status = pending`
  - [ ] `publish_mode = active`
  - [ ] `publish_method = shopify_api`

## Images

- [ ] Detail page shows main/detail/spec upload zones.
- [ ] Uploading a main image creates a `product_images` row.
- [ ] Uploaded image appears in preview.
- [ ] Image row includes `image_type`, URL fields, `sort_order`, and `processing_status = uploaded`.

## Queue

- [ ] `/drafts` lists the new draft.
- [ ] Queue row shows draft status.
- [ ] Queue row shows generation mode/status.
- [ ] Queue row shows publish mode/status.
- [ ] Draft title links to `/drafts/{id}`.

## Worker Flow

- [ ] `POST /api/worker/claim` with `WORKER_API_TOKEN` claims the draft.
- [ ] Draft moves to `processing`.
- [ ] `POST /api/worker/complete` with `fixtures/worker-complete-sample.json` moves the draft to `ready_for_review`.
- [ ] `/review` lists the draft.
- [ ] Result tabs show copy, SEO, images, and warnings.

## Review

- [ ] Reviewer can edit title, HTML description, SEO, tags, and publish mode.
- [ ] Saving changes persists after refresh.
- [ ] Reviewer can approve the draft.
- [ ] Reviewer can request revision with a comment.
- [ ] Request revision sets `status = needs_revision`.
- [ ] Operator cannot approve the draft.
- [ ] Review log row is created on approve.

## Publish Mock

- [ ] Active publish button is visually marked as dangerous.
- [ ] Active publish shows first browser confirmation.
- [ ] Active publish shows second browser confirmation.
- [ ] Canceling either confirmation does not call the API.
- [ ] Calling publish without `confirmActive=true` returns `400`.
- [ ] With `SHOPIFY_PUBLISH_MOCK=true`, publish does not call Shopify.
- [ ] Mock active publish sets `status = active_published`.
- [ ] Mock active publish writes a `publish_jobs` row.

## CSV Fallback

- [ ] Operator cannot export Matrixify CSV.
- [ ] Reviewer can export Matrixify CSV.
- [ ] CSV includes product fields, variant fields, inventory fields, and image fields.
- [ ] Exported draft moves to `csv_ready`.
- [ ] `publish_jobs` records `publish_method = matrixify_csv`.

## Safety

- [ ] `.env.local` is present only locally and is not committed.
- [ ] No API key appears in browser code.
- [ ] Supabase service role is only used server-side.
- [ ] Shopify real token is not configured for v0.1 mock QA.
