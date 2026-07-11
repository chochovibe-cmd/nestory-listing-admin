# API Contracts v0.1

This document describes the v0.1 backend route contracts. It is not a substitute
for runtime tests, but it keeps the PWA, Codex Skill worker, Matrixify fallback,
and Shopify publish boundary aligned.

## Auth Model

| API | Auth |
| --- | --- |
| `POST /api/worker/claim` | `Authorization: Bearer ${WORKER_API_TOKEN}` |
| `POST /api/worker/complete` | `Authorization: Bearer ${WORKER_API_TOKEN}` |
| `POST /api/worker/fail` | `Authorization: Bearer ${WORKER_API_TOKEN}` |
| `POST /api/drafts/{id}/approve` | Supabase user session, `admin` or `reviewer` |
| `POST /api/drafts/{id}/request-revision` | Supabase user session, `admin` or `reviewer` |
| `POST /api/drafts/{id}/publish` | Supabase user session, `admin` or `reviewer` |
| `POST /api/exports/matrixify` | Supabase user session, `admin` or `reviewer` |

Frontend code must not call Supabase with the service role key. Server routes
use service role access only after validating the scoped worker token or user
role.

## Worker Claim

```http
POST /api/worker/claim
Authorization: Bearer ${WORKER_API_TOKEN}
Content-Type: application/json
```

Request:

```json
{
  "limit": 5,
  "ruleVersion": "chochonest-copywriter@2026-06-24-v1"
}
```

Success `200`:

```json
{
  "claimed": [
    {
      "id": "draft uuid",
      "status": "processing",
      "generation_status": "processing",
      "product_images": []
    }
  ]
}
```

Behavior:

- Uses `claim_pending_generation()` SQL RPC.
- Claims only `pending_copy` + `generation_status = pending`.
- Uses `FOR UPDATE SKIP LOCKED`.
- Creates `generation_runs` and `automation_logs`.

Errors:

- `401` invalid worker token.
- `500` worker token missing or database error.

## Worker Complete

```http
POST /api/worker/complete
Authorization: Bearer ${WORKER_API_TOKEN}
Content-Type: application/json
```

Request:

```json
{
  "draftId": "draft uuid",
  "ruleVersion": "chochonest-copywriter@2026-06-24-v1",
  "model": "codex_skill",
  "output": {
    "title_zh": "商品標題",
    "description_html": "<h3>收藏亮點</h3>",
    "description_plain": "商品摘要",
    "seo_title": "SEO Title",
    "seo_description": "SEO Description",
    "tags": ["潮巢", "動漫周邊"],
    "collection_suggestion": "公仔 / 手辦",
    "spec_text": "規格文字",
    "warnings": ["請人工確認 IP 名稱"],
    "image_alt_texts": [
      { "image_id": "image uuid", "alt_text": "商品主圖 alt" }
    ]
  }
}
```

Success `200`:

```json
{
  "ok": true,
  "status": "ready_for_review"
}
```

Behavior:

- Writes generated copy fields.
- Updates supplied image alt text.
- Sets `status = ready_for_review`.
- Sets `generation_status = completed`.
- Writes `generation_runs` and `automation_logs`.
- Calls Make webhook with `ready_for_review` if configured.

Errors:

- `400` missing `draftId` or `output`.
- `401` invalid worker token.
- `500` database error.

## Worker Fail

```http
POST /api/worker/fail
Authorization: Bearer ${WORKER_API_TOKEN}
Content-Type: application/json
```

Request:

```json
{
  "draftId": "draft uuid",
  "ruleVersion": "chochonest-copywriter@2026-06-24-v1",
  "error": "reason"
}
```

Success `200`:

```json
{
  "ok": true,
  "status": "failed"
}
```

Behavior:

- Sets `status = failed`.
- Sets `generation_status = failed`.
- Writes `generation_error`, `generation_runs`, and `automation_logs`.
- Calls Make webhook with `generation_failed` if configured.

## Approve Draft

```http
POST /api/drafts/{id}/approve
Content-Type: application/json
```

Request:

```json
{
  "comment": "optional reviewer note"
}
```

Success `200`:

```json
{
  "ok": true,
  "status": "approved"
}
```

Behavior:

- Requires `admin` or `reviewer`.
- Sets `status = approved`.
- Sets `reviewed_by` to the current user.
- Writes `review_logs`.

Errors:

- `401` not signed in.
- `403` reviewer/admin role required.
- `500` database error.

## Request Revision

```http
POST /api/drafts/{id}/request-revision
Content-Type: application/json
```

Request:

```json
{
  "comment": "請補清楚尺寸或換主圖"
}
```

Success `200`:

```json
{
  "ok": true,
  "status": "needs_revision"
}
```

Behavior:

- Requires `admin` or `reviewer`.
- Sets `status = needs_revision`.
- Sets `reviewed_by` to the current user.
- Stores the comment in `error_message` for quick visibility.
- Writes `review_logs`.

Errors:

- `401` not signed in.
- `403` reviewer/admin role required.
- `500` database error.

## Publish Draft

```http
POST /api/drafts/{id}/publish
Content-Type: application/json
```

Request:

```json
{
  "publishMode": "active",
  "confirmActive": true
}
```

`publishMode` can be:

```text
active
draft
```

Success `200` in mock mode:

```json
{
  "ok": true,
  "mock": true,
  "payload": {}
}
```

Behavior:

- Requires `admin` or `reviewer`.
- Accepts drafts in `approved`, `ready_for_review`, or `api_failed`.
- Requires `confirmActive = true` for `publishMode = active`.
- Sets `status = publishing` before work.
- Uses `SHOPIFY_PUBLISH_MOCK=true` by default.
- In mock mode, writes `active_published` or `draft_created` without calling Shopify.
- If Shopify API fails, writes `api_failed` and keeps raw error for CSV fallback.

Errors:

- `400` invalid publish mode or missing `confirmActive`.
- `401` not signed in.
- `403` reviewer/admin role required.
- `404` draft not found.
- `409` draft status cannot be published.
- `502` Shopify API error.

## Matrixify CSV Fallback

```http
POST /api/exports/matrixify
Content-Type: application/json
```

Request:

```json
{
  "draftIds": ["draft uuid"]
}
```

Success `200`:

```text
text/csv; charset=utf-8
```

Behavior:

- Requires `admin` or `reviewer`.
- Exports only eligible statuses:
  - `approved`
  - `api_failed`
  - `csv_ready`
- Updates exported drafts:
  - `status = csv_ready`
  - `publish_method = matrixify_csv`
  - `publish_status = csv_ready`
- Writes `publish_jobs`.
- Calls Make webhook with `csv_ready` if configured.

Errors:

- `401` not signed in.
- `403` reviewer/admin role required.
- `500` database error.
