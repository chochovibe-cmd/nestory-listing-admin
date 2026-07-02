# API Provider And Automation Plan

## OpenAI / Anthropic Provider Setup

The Worker now supports both Anthropic and OpenAI behind the same frontend endpoints:

- `POST /api/generate`
- `POST /api/recognize`
- `POST /api/search`
- `GET /api/status`

Cloudflare Worker Variables:

```text
OPENAI_API_KEY=<your OpenAI key>
OPENAI_MODEL=gpt-5.2
LLM_PROVIDER=openai
```

Optional Anthropic variables can stay:

```text
ANTHROPIC_API_KEY=<your Anthropic key>
```

Provider behavior:

- `LLM_PROVIDER=openai`: use OpenAI if `OPENAI_API_KEY` exists.
- `LLM_PROVIDER=anthropic`: use Anthropic if `ANTHROPIC_API_KEY` exists.
- `LLM_PROVIDER=auto` or unset: prefer Anthropic if present, else OpenAI, else mock.

After updating Variables, paste the latest `chochonest-worker.js` into Cloudflare Worker and save/deploy. Then open the Pages app and click deployment status check. The AI pill should show `openai`.

## Supabase Next-Stage Integration Plan

Recommended database: Supabase.

Reason:

- The main project already has Supabase structure.
- It supports Postgres tables, auth later, storage if needed, and Edge Functions / REST access.
- It is easier to audit reviewed listings than localStorage.

Existing main-project tables to map:

```text
product_drafts
- id
- source_type
- source_url
- taobao_url
- taobao_title
- original_title
- cny_price
- twd_cost
- twd_price
- pricing_formula
- title_zh
- description_html
- seo_title
- seo_description
- tags
- shopify_tags
- collection_suggestion
- metafields_json
- generated_payload_json
- status
- generation_status
- publish_status
- created_at
- updated_at

product_images
- id
- draft_id
- kind: main / detail / spec
- cloudinary_url
- position
- ocr_text

product_variants
- id
- draft_id
- option1_value
- sku
- price
- inventory_qty

publish_jobs
- id
- draft_id
- channel: matrixify / shopify_api
- status: queued / running / success / failed
- error_message
- published_at
```

Frontend JSON fields already available for mapping:

```text
source, originalTitle, costCurrency, sourceCost,
costTWD, sellPrice, compareAtPrice, pricingFormula,
title, description, seo_title, seo_description,
tags, collections, detected_category, sku,
imgURLs.main/detail/spec, specText, variants,
approved, status, status_reason, aiProvider
```

Next implementation slice:

1. Add Worker route `POST /api/save-draft`.
2. Add a result-card button named `存入資料庫`.
3. Only enable save when the result is marked approved.
4. Worker uses Supabase service role from Worker secrets, never browser localStorage.
5. Insert into `product_drafts`, then related `product_images` and `product_variants`.
6. Keep Matrixify CSV download as the fallback export path.
7. Build a Supabase dashboard tab only after save is verified.

## Automation Plan

Best staged path:

1. Keep manual CSV export as fallback.
2. Add Supabase save for approved listings.
3. Add a scheduled publisher job that only reads `approved` listings.
4. First publish path should create Matrixify-ready CSV batches.
5. Later upgrade to Shopify Admin API direct product creation.

Recommended automation:

- Short term: Supabase + Make or n8n for scheduled polling.
- Medium term: Supabase Edge Function scheduled job for batch CSV/publish queue.
- Later: Shopify Admin API direct publish with audit logs.

Codex automation can help monitor or run assistant-driven review tasks, but it should not be the primary production publisher unless the workflow explicitly requires human-in-the-loop review.

## Guardrails

- Never publish anything not marked `approved`.
- Keep `published` and `failed` job logs.
- Keep CSV fallback until Shopify API publishing is proven stable.
- Store API keys only in Worker/Supabase secrets, never in browser localStorage.
