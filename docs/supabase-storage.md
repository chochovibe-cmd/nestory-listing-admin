# Supabase Storage Plan

Bucket: `product-images`

Path convention:

```text
{user_id}/{draft_id}/main/{filename}
{user_id}/{draft_id}/detail/{filename}
{user_id}/{draft_id}/spec/{filename}
{user_id}/{draft_id}/generated_detail/{filename}
{user_id}/{draft_id}/variant/{filename}
```

The bucket is public-read in v0.1 so Shopify and Matrixify can consume image URLs.
Writes are limited by RLS storage policy to the authenticated user's top-level
folder. Sensitive credentials are not needed in the browser.

Image table fields reserved for later phases:

- `ocr_text`
- `translated_text`
- `generated_file_url`
- `processing_status`
- `processing_error`
