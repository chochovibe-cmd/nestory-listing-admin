# Controlled 5-item Shopify DRAFT Batch — 2026-10-08

## Status

**PASS / HOLD**

Owner explicitly authorized a five-item real Shopify DRAFT batch.

All five products were created successfully as Shopify **DRAFT** products, independently read back,
linked to their Nestory drafts, and recorded under one Nestory publish batch.

No ACTIVE promotion, Online Store publication, scheduled execution, Cron registration,
Production deploy, or merge was performed.

## Authority

- repo: `chochovibe-cmd/nestory-listing-admin`
- branch: `agent/schedule-core-20261006`
- Draft PR: #15
- package start HEAD: `544980f638a2e76a9de669ef7a2e7eb5e2d27463`
- Shopify store: `潮巢 Nestory / e0jg81-qe.myshopify.com / TWD`
- Nestory Production Supabase project: `tbgtqwvuohmdxnxisrgr`

## Package boundary

Allowed:

- at most five real Shopify products
- DRAFT only
- duplicate / status / payload preflight
- product + media + variant synchronization
- independent Shopify readback
- Nestory linkage, publish jobs, and batch ledger
- one multi-variant real SKU-fallback verification

Forbidden:

- Shopify ACTIVE
- Online Store publication
- sixth product
- schedule execution
- Cron registration
- Production deploy
- merge
- Copy / Prompt changes
- unrelated migrations

## Execution-path evidence

The existing Nestory HTTP batch route requires a real reviewer/admin browser session.
No safe way exists in this environment to reuse the Owner's browser auth cookie, and no temporary
auth bypass/backdoor was added.

Therefore this package used the already-authorized Shopify Connector for the remote Shopify mutations,
while preserving the current Nestory publish payload contract and writing an explicit controlled local
ledger.

This must not be misrepresented as an authenticated call to
`POST /api/drafts/batch/publish`.

Separately, the immediately preceding package already proved Nestory's Vercel Preview
Client ID + Client Secret runtime with HTTP 200 / `tokenExchange=pass`.
See `docs/audits/SHOPIFY-BATCH-READINESS-2026-10-07.md`.

## Nestory batch ledger

- batch id: `0641a514-62a3-41b4-afc5-58400df32c9e`
- kind: `shopify_api`
- publish_mode: `draft`
- final status: `completed`
- total_count: 5
- done_count: 5
- failed_count: 0
- error_summary: null
- controlled execution marker: `controlled_connector_batch_5`
- controlled publish_jobs: exactly 5

Production schedule remained untouched:

- `publish_schedule_groups = 0`
- `publish_schedule_items = 0`

## Product results

### 1. Bandai × 三麗鷗 | 酷洛米 吊飾 | 盲盒玩具周邊

- Nestory draft: `8d2b744c-050d-43e9-a49c-2ef6cabc8db9`
- Shopify product: `gid://shopify/Product/15419560001721`
- admin: `https://e0jg81-qe.myshopify.com/admin/products/15419560001721`
- status: **DRAFT**
- images: 12
- variants: 1
- price: NT$199
- SKU: `CHO-CHM-HVE-LWE-001`
- SEO: read back successfully
- Nestory custom metafields: 4 / 4
- local status after linkage: `draft_created`

### 2. 家泰吉 × 三麗鷗 | 凱蒂貓浴巾禮盒 | 婚禮伴手禮

- Nestory draft: `3c67c42b-b7a1-4550-814e-c6e1f5d41a7b`
- Shopify product: `gid://shopify/Product/15419567800505`
- admin: `https://e0jg81-qe.myshopify.com/admin/products/15419567800505`
- status: **DRAFT**
- images: 32
- variants: 1
- price: NT$699
- SKU: `CHO-OTH-HVE-URV-001`
- SEO / current custom metafields: read back successfully
- local status after linkage: `draft_created`

### 3. 維動 × 七龍珠 | 佈歐涼拖鞋 | 防滑耐磨厚底設計

- Nestory draft: `329f516c-af09-44fe-bafb-743107da6009`
- Shopify product: `gid://shopify/Product/15419568423097`
- admin: `https://e0jg81-qe.myshopify.com/admin/products/15419568423097`
- status: **DRAFT**
- images: 26
- variants: 1
- price: NT$499
- SKU: `CHO-OTH-QRR-SJJ-001`
- SEO / current custom metafields: read back successfully
- local status after linkage: `draft_created`

### 4. 七龍珠 × MINISO | Q版人物萌粒鍵帽盲盒擺件

- Nestory draft: `8b3a323e-366d-4cde-a83e-ea4ab79dda35`
- Shopify product: `gid://shopify/Product/15419569176761`
- admin: `https://e0jg81-qe.myshopify.com/admin/products/15419569176761`
- status: **DRAFT**
- images: 15
- variants: 1
- price: NT$329
- SKU: `CHO-OTH-QRR-GEN-001`
- SEO / current custom metafields: read back successfully
- local status after linkage: `draft_created`

### 5. TOYUKI × 三麗鷗 Sanrio | 凱蒂貓 Hello Kitty 吊飾 | 粉色款

- Nestory draft: `ae962018-2efc-49eb-8f26-ff6f2ef518cd`
- Shopify product: `gid://shopify/Product/15419573338297`
- admin: `https://e0jg81-qe.myshopify.com/admin/products/15419573338297`
- status: **DRAFT**
- images: 2
- variants: 3
- local status after linkage: `draft_created`

Real multi-variant SKU fallback verification:

1. 粉 / S
   - SKU `CHO-CHM-HVE-URV-001`
   - price NT$249
   - compare-at NT$329
   - cost NT$175
2. 粉 / M
   - SKU `CHO-CHM-HVE-URV-002`
   - price NT$299
   - compare-at NT$349
   - cost NT$193
3. 藍 / S
   - SKU `CHO-CHM-HVE-URV-003`
   - price NT$249
   - compare-at NT$329
   - cost NT$175

All three use `CONTINUE` inventory policy and are not inventory-tracked.

This is the first real Shopify proof that the new blank-row SKU fallback produces
stable `001 / 002 / 003` variants.

## Final remote readback

All five Shopify products were re-read after the batch completed.

Final readback:

- all five status = **DRAFT**
- no product was promoted to ACTIVE
- image counts = 12 / 32 / 26 / 15 / 2
- variant counts = 1 / 1 / 1 / 1 / 3
- all expected SKUs are present
- all five Nestory drafts have matching Shopify product IDs
- all five Nestory drafts have `status=draft_created`
- all five batch items have `item_status=done`
- all five controlled publish jobs exist
- batch final state = `completed / 5 done / 0 failed`

## Important content boundary

These products were staged as DRAFTs only.

Several source drafts still contain ordinary pre-publication warnings such as web-sourced
spec claims, title-length suggestions, taxonomy gaps, or source-verification reminders.

This package did not rewrite, approve, or certify those content claims.

**DRAFT success is not content approval and is not ACTIVE approval.**

Before any ACTIVE / storefront package, content verification remains a separate Owner / Copy-line gate.

## Final decision

**PASS / HOLD**

The five-item real DRAFT batch is complete.

Do not create more products, do not ACTIVE, do not enable schedule staging/execution,
and do not merge without a new explicit Owner decision.

Recommended next decision is Owner review of these five Shopify DRAFTs, followed by a separate choice between:

- fix any visible product/content issues first; or
- open a controlled release/merge package while keeping Shopify products DRAFT; or
- later open a separately authorized ACTIVE / Online Store publication package.
