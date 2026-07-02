# v5 Contract

This contract keeps the lightweight v5 branch migration-ready for a future Next/Supabase version.

## Product Draft Shape

Frontend queue items use this portable shape:

```json
{
  "id": "string",
  "title": "string",
  "originalTitle": "string",
  "source": "淘寶",
  "price": 0,
  "currency": "CNY",
  "compareAtPrice": "",
  "category": "figure",
  "note": "string",
  "useWebSearch": false,
  "approved": false,
  "variants": [
    {
      "name": "string",
      "sku": "string",
      "price": "optional price override",
      "qty": "optional inventory quantity"
    }
  ],
  "imageCounts": {
    "main": 0,
    "detail": 0,
    "spec": 0
  },
  "status": "waiting"
}
```

Runtime-only `files` values are browser `File` objects and are not migration data.

## Worker API

All endpoints require:

```http
X-Access-Token: <ACCESS_TOKEN>
```

### `GET /api/ping`

Returns:

```json
{ "ok": true }
```

### `POST /api/upload`

Request: `multipart/form-data` with one `file` field.

Returns:

```json
{
  "public_id": "cloudinary-public-id",
  "secure_url": "https://res.cloudinary.com/...",
  "width": 800,
  "height": 800,
  "format": "jpg"
}
```

### `POST /api/generate`

Request:

```json
{
  "model": "optional-model-name",
  "max_tokens": 1500,
  "system": "copywriting system prompt",
  "messages": [
    { "role": "user", "content": "product context" }
  ]
}
```

Returns the upstream Anthropic Messages response. The frontend expects `content[0].text` to contain JSON:

```json
{
  "title": "string",
  "seo_title": "string",
  "description": "string",
  "seo_description": "string",
  "tags": ["string"]
}
```

### `POST /api/recognize`

Request:

```json
{
  "image_b64": "base64-image-data",
  "media_type": "image/jpeg"
}
```

Returns the upstream Anthropic Messages response. The frontend uses `content[0].text` as `specText`.

### `POST /api/search`

Optional enrichment endpoint used only when a queue item enables Web Search.

Request:

```json
{
  "title": "raw product title",
  "category": "公仔模型",
  "note": "optional operator note"
}
```

Returns:

```json
{ "summary": "Traditional Chinese search summary, or empty string when unavailable" }
```

## Result Shape

Completed frontend results are stored locally as:

```json
{
  "title": "string",
  "seo_title": "string",
  "description": "string",
  "seo_description": "string",
  "faq": [
    { "q": "string", "a": "string" }
  ],
  "tags": ["string"],
  "collections": {
    "ip": ["string"],
    "type": ["string"],
    "theme": ["string"],
    "promo": ["string"]
  },
  "status": "ready",
  "status_reason": null,
  "costTWD": 0,
  "sellPrice": 0,
  "compareAtPrice": "",
  "approved": false,
  "variants": [],
  "profitPct": 0,
  "source": "淘寶",
  "costCurrency": "CNY",
  "sourceCost": 0,
  "cnyPrice": 0,
  "category": "figure",
  "imgURLs": {
    "main": ["https://..."],
    "detail": ["https://..."],
    "spec": ["https://..."]
  },
  "specText": "string"
}
```

## Matrixify CSV Columns

The v5 CSV currently emits:

- `Handle`
- `Title`
- `Body (HTML)`
- `Vendor`
- `Type`
- `Tags`
- `Published`
- `SEO Title`
- `SEO Description`
- `Variant Price`
- `Variant Compare At Price`
- `Variant Cost`
- `Variant Inventory Qty`
- `Variant SKU`
- `Variant Requires Shipping`
- `Option1 Name`
- `Option1 Value`
- `Status`
- `Image Src`
- `Image Position`
- `Image Alt Text`
- `Metafield: faq [json]`
- `Metafield: collections_suggestion [string]`
- `Metafield: listing_status [string]`
- `Metafield: status_reason [string]`

Future Supabase migration should preserve these fields as the Matrixify fallback export contract.
