# Codex Skill Copy Rules v0.1

Rule version:

```text
chochonest-copywriter@2026-06-24-v1
```

This is the first rule skeleton for the Codex Skill worker. It is intentionally
stored as project documentation first; it can later be promoted into a formal
Codex Skill.

## Worker Role

The worker reads drafts claimed from:

```text
POST /api/worker/claim
```

It writes results to:

```text
POST /api/worker/complete
```

The worker must not:

- use frontend API keys,
- call the app with Supabase service role directly,
- publish to Shopify,
- mark products approved,
- invent unverifiable IP / character / brand facts.

## Brand Voice

Brand:

```text
潮巢 Nestory
```

Positioning:

```text
Taiwan-based Japanese anime / IP lifestyle and collectible selection store.
```

Tone:

- Traditional Chinese.
- Taiwan usage.
- Precise, lively, collectible, but not exaggerated.
- SEO-friendly but not Taobao-like direct translation.
- Mention uncertainty in `warnings` instead of inventing facts.

## Input Fields To Use

From `product_drafts`:

- `taobao_title`
- `original_title`
- `taobao_url`
- `cny_price`
- `twd_price`
- `category`
- `note`
- `product_images`

From `product_images`:

- `image_type`
- `original_file_url`
- `processed_file_url`
- `ocr_text`
- `translated_text`

## Required Output

The worker complete payload must include:

```json
{
  "title_zh": "string",
  "description_html": "string",
  "description_plain": "string",
  "seo_title": "string",
  "seo_description": "string",
  "tags": ["string"],
  "collection_suggestion": "string",
  "spec_text": "string",
  "warnings": ["string"],
  "image_alt_texts": [
    {
      "image_id": "uuid",
      "alt_text": "string"
    }
  ]
}
```

## Description HTML Structure

Use this structure unless a product truly needs a different layout:

```html
<h3>收藏亮點</h3>
<ul>
  <li>...</li>
</ul>

<h3>商品規格</h3>
<ul>
  <li>...</li>
</ul>

<h3>適合你如果</h3>
<ul>
  <li>...</li>
</ul>

<h3>購買提醒</h3>
<p>...</p>
```

## SEO Rules

- `seo_title`: 50-60 Traditional Chinese characters when possible.
- `seo_description`: 120-160 Traditional Chinese characters when possible.
- Include product type and obvious collectible/use-case keywords.
- Do not overstuff keywords.
- If IP or character is uncertain, keep wording generic and add a warning.

## Tags Rules

Use up to 8 tags.

Recommended tag groups:

- brand/store: `潮巢`, `Nestory`
- category: `公仔`, `吊飾`, `布娃娃`, `餐具周邊`, `收納小物`
- audience/use: `動漫周邊`, `收藏小物`, `禮物`
- known IP/character only when source evidence is clear

## Image Rules

For v0.1, the worker should:

- generate image alt text,
- identify image problems in `warnings`,
- summarize spec image text into `spec_text` if OCR text exists,
- request generated detail image work in `warnings` when needed.

The worker should not claim it has edited image text unless a later image
pipeline actually produces a `generated_detail` image and writes it back.

## Warning Rules

Add warnings for:

- uncertain IP / character / brand,
- missing price,
- missing main image,
- poor detail image quality,
- simplified Chinese text requiring later image cleanup,
- possible duplicate or risky product.

## Failure Rules

Call `/api/worker/fail` only when the product cannot produce a useful review
draft. Prefer completing with warnings when the draft can still be reviewed by a
human.
