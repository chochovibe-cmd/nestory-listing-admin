# v0.1 Mock Flow

This flow uses mock-safe publish behavior. Do not put real secrets in source
control.

## 1. Local Env

Create `.env.local` from `.env.example` and fill only test values:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
WORKER_API_TOKEN=local-worker-token
SHOPIFY_PUBLISH_MOCK=true
```

Optional test seed:

```text
supabase/seeds/001_mock_draft.sql
```

This seed matches the UUIDs used in `fixtures/worker-complete-sample.json`.

## 2. Create A Draft In PWA

Use `/drafts/new`.

Expected database defaults:

```text
status = pending_copy
generation_mode = codex_skill
generation_provider = codex
generation_status = pending
publish_mode = active
publish_method = shopify_api
publish_status = pending
```

## 3. Claim Pending Copy Work

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/worker/claim `
  -Headers @{ Authorization = "Bearer local-worker-token" } `
  -ContentType "application/json" `
  -Body '{"limit":1,"ruleVersion":"chochonest-copywriter@2026-06-24-v1"}'
```

Sample request body:

```text
fixtures/worker-claim-sample.json
```

Expected:

- Draft changes to `processing`.
- `generation_runs` row is created.
- Worker receives draft data and image URLs.

## 4. Complete Generation

```powershell
$body = Get-Content fixtures/worker-complete-sample.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/worker/complete `
  -Headers @{ Authorization = "Bearer local-worker-token" } `
  -ContentType "application/json" `
  -Body $body
```

Expected:

- Draft changes to `ready_for_review`.
- PWA `/review` shows the item.
- Make webhook is called if `MAKE_WEBHOOK_URL` is configured.

## 5. Review And Mock Publish

Use `/drafts/{id}`:

1. Save any edits.
2. Approve.
3. Click publish.
4. Confirm ACTIVE twice.

Expected with `SHOPIFY_PUBLISH_MOCK=true`:

- Draft becomes `active_published`.
- `shopify_product_id = mock-product-id`.
- `publish_jobs` records the Shopify payload.
- No real Shopify request is sent.

Sample request body:

```text
fixtures/publish-active-sample.json
```

## 6. CSV Fallback

Use the same detail page and click `產生 CSV 備援`.

Expected:

- Browser downloads Matrixify CSV.
- Draft becomes `csv_ready`.
- `publish_jobs.publish_method = matrixify_csv`.

Sample request body:

```text
fixtures/matrixify-export-sample.json
```
