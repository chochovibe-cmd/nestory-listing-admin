# Shopify Publish Payload v0.1

The publish API is server-only:

```http
POST /api/drafts/{id}/publish
Content-Type: application/json

{
  "publishMode": "active",
  "confirmActive": true
}
```

`publishMode` can be:

- `active`: main flow, requires `confirmActive: true`.
- `draft`: fallback safety mode.

v0.1 defaults to `SHOPIFY_PUBLISH_MOCK=true`, which writes publish state and
payload records without calling Shopify. Set it to `false` only after credentials
and a test store are ready.

The generated payload includes:

- title
- descriptionHtml
- vendor
- productType
- tags
- SEO fields
- status `ACTIVE` or `DRAFT`
- media image URLs
- variant seed metadata for later variant/inventory work

Shopify's current `productCreate` mutation creates product records and supports
product status, but sales-channel publication can require a follow-up
`publishablePublish` step. v0.1 keeps this as a documented next verification
item because this run must not use real Shopify tokens or publish live products.

If Shopify returns an error, the API sets:

```text
product_drafts.status = api_failed
product_drafts.publish_status = api_failed
publish_jobs.error_message = raw Shopify error
```

The PWA can then trigger Matrixify CSV fallback.
