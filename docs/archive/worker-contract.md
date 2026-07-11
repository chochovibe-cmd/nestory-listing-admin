# Codex Skill Worker Contract

The v0.1 app does not call an LLM API from the product frontend. Copywriting is
done by a scheduled or manually-triggered Codex Skill worker through scoped API
endpoints.

## Auth

All worker requests send:

```http
Authorization: Bearer ${WORKER_API_TOKEN}
```

The worker does not need the Supabase service role key. Server routes use the
service key internally after validating the scoped worker token.

## Claim Pending Work

```http
POST /api/worker/claim
Content-Type: application/json

{
  "limit": 5,
  "ruleVersion": "chochonest-copywriter@2026-06-24-v1"
}
```

Behavior:

- Selects `product_drafts.status = pending_copy`.
- Limits to 1-10 items, default 5.
- Moves claimed rows to `processing`.
- Uses the `claim_pending_generation` SQL RPC with `FOR UPDATE SKIP LOCKED`
  so overlapping scheduled/manual runs do not claim the same draft.
- Creates generation and automation logs.

## Complete Generation

```http
POST /api/worker/complete
Content-Type: application/json

{
  "draftId": "uuid",
  "ruleVersion": "chochonest-copywriter@2026-06-24-v1",
  "model": "codex_skill",
  "output": {
    "title_zh": "商品標題",
    "description_html": "<h3>收藏亮點</h3>...",
    "description_plain": "純文字摘要",
    "seo_title": "SEO Title",
    "seo_description": "SEO Description",
    "tags": ["公仔", "動漫周邊"],
    "collection_suggestion": "公仔 / 手辦",
    "spec_text": "規格文字",
    "warnings": ["IP 資訊不足，請人工確認"],
    "image_alt_texts": [
      { "image_id": "uuid", "alt_text": "商品主圖 alt text" }
    ]
  }
}
```

Behavior:

- Writes generated fields to `product_drafts`.
- Updates image alt text when supplied.
- Sets `status = ready_for_review`.
- Records `generation_rule_version`.

## Fail Generation

```http
POST /api/worker/fail
Content-Type: application/json

{
  "draftId": "uuid",
  "ruleVersion": "chochonest-copywriter@2026-06-24-v1",
  "error": "原因"
}
```

v0.1 marks the draft `failed`. A later retry policy can move retryable failures
back to `pending_copy` with a retry counter.
