# Controlled Shopify DRAFT E2E — 2026-10-07

## Status

**PASS / HOLD**

A single Owner-authorized real Shopify DRAFT was created and independently read back.
No ACTIVE publish, Online Store publication, schedule execution, Cron registration,
Production deployment, or merge was performed.

This package proves the Shopify payload / remote DRAFT / local linkage path described
below. It does **not** prove Nestory's Vercel client-credentials runtime end-to-end,
because Vercel MCP did not expose decrypted sensitive env values and a project-bound
sandbox did not inherit project env variables.

## Authority

- repo: `chochovibe-cmd/nestory-listing-admin`
- feature branch: `agent/schedule-core-20261006`
- Draft PR: #15
- source HEAD immediately before the real Shopify write:
  `85cc2d6424c8ff589febc32ff1d7268d31be2e59`
- connected Shopify store read-only preflight:
  `潮巢 Nestory` / `www.chochonest.com` / TWD / Taiwan

## Package scope

Allowed:

1. exactly one real Shopify product
2. DRAFT only
3. preflight / duplicate / schema / payload checks
4. independent remote readback
5. minimal Nestory local linkage + explicit audit record

Forbidden:

- ACTIVE
- Online Store publication
- second product / batch
- scheduled execution
- Cron registration
- Production deploy
- merge
- copy / prompt redesign
- unrelated DB cleanup or migration

## Candidate

Nestory draft:

- draft id: `8b3a35b9-2a9b-4b14-84d3-5c7e84f9b8f8`
- title: `馬克圖布 × Miffy | 米菲 70週年典藏臺燈 | 蘋果樹設計`
- source status before write: `approved`
- source pipeline stage before write: `image_review`
- source Shopify id before write: null
- handle: `dick-bruna-nijntje-8b3a35`
- source duplicate search in Shopify: 0 matches

Reason selected:

- already approved
- two defined variants
- both variants use `inventory_policy=continue`
- no finite inventory, so no Shopify Location mutation was required
- 10 publishable images
- no existing Shopify linkage

## Preflight

Passed:

- Shopify connected store identity
- exact-handle duplicate search: 0
- draft Race Guard before mutation
- hidden `generated_payload_json` / `metafields_json` overrides: empty
- `internal_link_urls_by_ip`: empty, so no guessed internal link
- Shopify GraphQL schema validation for:
  - `productCreate`
  - `productVariantsBulkUpdate`
  - `productVariantsBulkCreate`
  - final Product audit query

All three mutation operations validated against Shopify Admin GraphQL before execution.

## Real Shopify result

Created product:

- Shopify product id: `gid://shopify/Product/15417952698553`
- numeric id: `15417952698553`
- status: **DRAFT**
- `publishedAt`: **null**
- handle: `dick-bruna-nijntje-8b3a35`
- vendor: `潮巢 Nestory`
- product type: `燈具小物`
- media: **10**
- variants: **2**
- inventory tracking: off / CONTINUE

Variants:

1. `gid://shopify/ProductVariant/67658520527033`
   - price: NT$4,480
   - compare-at: NT$5,480
   - cost: NT$1,644
   - policy: CONTINUE

2. `gid://shopify/ProductVariant/67658521608377`
   - price: NT$4,480
   - compare-at: NT$5,480
   - cost: NT$1,705
   - policy: CONTINUE

Independent readback also confirmed:

- SEO title / description match the Nestory source payload
- all four Nestory custom metafields exist:
  - `custom.why_nestory_pick`
  - `custom.product_highlights`
  - `custom.product_faq`
  - `custom.product_specs`
- all 10 product images were imported to Shopify CDN
- store apps added additional Judge.me metafields after creation; these were not part
  of Nestory's request payload

## Nestory local linkage

The first direct SQL linkage attempt was correctly blocked by
`guard_sensitive_product_draft_fields()`; the transaction rolled back completely.

A rollback-only check then verified that the trigger recognizes
`request.jwt.claims.role=service_role`.

The actual linkage used one controlled transaction with:

- local service-role request context
- CAS guard:
  - draft must still be `approved`
  - `shopify_product_id` must still be null
- product draft update + controlled publish-job insert in the same transaction

Final Nestory state:

- status: `draft_created`
- pipeline_stage: `published` (current source mapping for `draft_created`)
- publish_status: `draft_created`
- publish_mode: `draft`
- Shopify product id: `gid://shopify/Product/15417952698553`
- Shopify admin URL:
  `https://e0jg81-qe.myshopify.com/admin/products/15417952698553`
- error: null

Controlled publish job:

- exactly one row
- publish method: `shopify_api`
- publish status: `draft_created`
- execution-path marker:
  `controlled_shopify_connector_draft_test`
- response explicitly records that this was a real DRAFT and does not prove the
  Vercel client-credentials runtime

## Important limitations / blockers before ACTIVE

1. **Nestory Vercel client-credentials runtime is still not directly proven.**
   The Shopify connector path worked, but the Preview app's own
   `SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET` exchange was not executed.

2. **Variant SKU gap remains.**
   This draft has a product-level SKU, but both persisted multi-variant rows have
   `sku=null`. Current Nestory multi-variant publishing uses row-level SKU, so both
   real Shopify variants were created with null SKU. Record this; do not silently
   redesign SKU behavior in this package.

3. **Content verification remains required before ACTIVE.**
   The draft still contains a source-verification warning for material / dimensions /
   feature claims. This package did not re-author or approve copy.

4. **Current ChaoNest formatter behavior is visible in the DRAFT.**
   The final long paragraph after the four highlight bullets is rendered as another
   highlight list item by the current formatter. Copy/prompt scope is separate.

5. **No Online Store publication proof is needed for DRAFT.**
   Shopify returned `status=DRAFT` and `publishedAt=null`, so the product is not
   publicly sellable. Future ACTIVE work must separately verify publication/channel
   state rather than treating Product status alone as storefront proof.

## Environment safety

No Vercel schedule safety flag was enabled.
No `SHOPIFY_LIVE_TEST_DRAFT_ID` branch override was added because the final write
was executed through the already-connected Shopify connector path, not through the
Preview runtime.

A temporary Vercel sandbox used only to test whether project env was inherited:

- sandbox: `nestory-env-preflight-20261007`
- network policy: deny-all
- result: project env was not inherited
- final status: **stopped**

No secret values were printed or copied into repo files.

## Final decision

**PASS / HOLD**

The single real Shopify DRAFT and Nestory linkage are complete and internally
consistent. Do not create a second product, do not ACTIVE, and do not enable scheduled
execution without a new Owner-approved package.

Recommended next package: first prove Nestory's own client-credentials runtime safely;
then decide whether to fix the row-level SKU gap before any 5-item batch or ACTIVE test.
