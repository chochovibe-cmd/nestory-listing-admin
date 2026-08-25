# COPY C1.4 — Evidence + Spec Foundation Audit

Date: 2026-08-25
Branch: `agent/copy-chaocao-sales-tone`
PR: #9 (OPEN / NOT MERGED at start)
Start HEAD: `ed52ddc8cd005891886ce2f600965bd3976863e3`
Default authority: `21e9d1c90697797aaa6d982e9454ccd4a6955fd8`
Final SHA: this document's single C1.4 commit; the immutable SHA is recorded by PR #9 HEAD and the Commander final report because a Git commit cannot embed its own hash.

## Scope

C1.4 only connects existing product evidence to full copy generation:

1. Vision evidence bridge before both full-generation entry points.
2. One typed Product Evidence Pack consumed by CopyProvider.
3. Evidence-preserving customer spec merge.

No writer/FAQ/Why/Highlights redesign, UI redesign, title first-segment redesign, DB migration, OCR vendor, Shopify write, or Shopify lifecycle change is included.

## Existing Vision flow audit

- `/api/analyze-images` already separated Vision latency from `/api/generate` and already read `main + detail`, preferred `vision_mid_url`, wrote aggregate `image_description`, and stored status only in `image_flags.vision_status`.
- `describeProductImages()` already emitted `【外觀描述】 + 【圖上文字】`; its prompt already excluded seller promotions and prohibited guessing numeric specs.
- The new-product client only called analyze when that submit had new uploads. Existing images with an empty/stale aggregate were missed.
- ResultCard full regenerate called `/api/generate` directly. Single-field regenerate also called generate directly and remains intentionally Vision-free.
- No reliable upload-side aggregate invalidation existed. C1.4 therefore uses an ordered main/detail source fingerprint inside existing `image_flags`—no schema change—to validate cache freshness.

## Vision bridge and cache/failure behavior

Shared client helper `prepareVisionEvidenceForFullGenerate()` is used by Workspace Full Generate and ResultCard full regenerate. It calls analyze first, then callers always continue to copy generation.

The endpoint returns cached evidence without a model call only when all three are true:

- `image_description` is non-empty;
- `image_flags.vision_status === "done"`;
- the saved ordered image fingerprint matches current main/detail URLs and order.

Any image add/delete/reorder or URL change changes the fingerprint and re-runs one aggregate analysis. No-image state clears stale `image_description` while leaving `spec_text` and `image_status` untouched. Failure clears unusable aggregate evidence, preserves the copy request, and forwards the warning `圖片辨識未成功，本次文案未使用詳情圖資訊`.

## Image cap and sampling policy

Hard cap remains `MAX_DESCRIBE_IMAGES = 6` and there is still only one Vision call. Selection is deterministic:

1. first valid main image;
2. remaining slots use evenly spaced detail images across the full ordered set, including front/middle/back;
3. additional main images only fill unused slots.

Duplicate/empty URLs are removed. This improves coverage without turning 16 detail images into 16 requests.

## ONE Product Evidence Pack

Reusable typed helper: `buildProductEvidencePack()` + `formatProductEvidencePack()`.

Sections:

- `classification`
- `raw_product_text`
- `variant_facts`
- `image_facts`
- `image_visible_text`
- `existing_specs`
- `web_product_facts`
- `ip_context`

Per-image stored text prefers `translated_text`, falls back to `ocr_text`, and adds nothing when both are empty. Aggregate Vision `【外觀描述】` and `【圖上文字】` are separated. IP context is explicitly isolated from product numeric facts.

Trust order in the serialized pack is saved clean fields → Variant → raw source text → visible image text → confirmed same-product web facts → objective appearance → IP background. Numeric facts require explicit text. Conflicting sources must be omitted rather than silently chosen.

Full Generate passes `evidencePackText` into the existing provider interface. Legacy individual fields remain optional so the original six tones, test mode, and cached single-field regeneration remain compatible.

## Spec merge authority

`mergeCustomerSpecEvidence()` replaces provider-wins behavior on Full Generate. It cleans and merges:

- existing `spec_text`;
- structured brand/IP/characters/product type;
- Variant facts;
- provider spec;
- aggregate/per-image evidence;
- web evidence.

Existing clean spec, confirmed classification, and explicit Variant facts are protected from lower-authority overwrites. Other same-key conflicts are omitted with a review warning. Exact/near-equivalent values are deduplicated. All non-conflicting useful keys remain; there is no 3–4-line output cap.

Cleanup removes marketplace/admin fields and seller-service/promotion data before merge. Aliases include `商品材質 / 主要材質 → 材質` and `使用方式 / 適用情境 / 用途 → 使用情境`. Unknown useful physical labels may remain when they pass seller/platform safety checks. A conservative usage scenario is derived only for clearly matching product types such as a hanger/keychain or display figure.

The Vision route never writes `spec_text`; manual spec protection remains at the merge boundary. Description/FAQ/SEO/title/highlights single-field regeneration still has no `spec_text` mapping or write and never invokes Vision.

## Tests and gates

The existing COPY C1 verifier is extended as the C1.4 dedicated verifier. Coverage includes:

- Workspace and ResultCard analyze-before-generate order;
- non-blocking honest Vision warning;
- cache fingerprint guard and stale aggregate clearing;
- hard cap and front/middle/back sampling fixture;
- all Evidence Pack sections and translated/OCR priority/fallback/empty behavior;
- CopyProvider pack wiring and IP-context separation;
- existing-size/material protection while provider adds brand/content;
- junk cleanup;
- eight-fact richness retention;
- single-field Vision/spec safety;
- retained C1.3 SKU/title and frozen Shopify lifecycle contracts.

Final local and CI results are reported in the Commander handoff. CI is authoritative if dependencies/runtime cannot be completed locally.
