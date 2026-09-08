# COPY C1.R0B — Title / SKU / FAQ Scope Recovery Audit

Date: 2026-08-25
Repo: `chochovibe-cmd/nestory-listing-admin`
Branch: `agent/copy-chaocao-sales-tone`
PR: #9
Start HEAD: `17005bc73d87c24fba54fe78d26fa414477fdb6a`
Production authority: `21e9d1c90697797aaa6d982e9454ccd4a6955fd8`

## Scope

R0B recovers only three shared contracts that drifted outside the Owner-approved COPY C1 scope:

1. title generation returns to the Production title machinery, keeping only separator normalization and second-segment product-type append;
2. SKU generation/publish precedence returns to Production;
3. global FAQ/GEO guidance returns to Production.

R0A data-pipeline recovery remains authoritative. This package does not reintroduce Evidence Pack, Full Generate Vision bridge, deterministic Web Search-to-spec merge, or any spec merge architecture.

## Title recovery

`src/lib/contentGenerator/titleGeneratorBase.ts` is the exact Production `21e9d1c...` `titleGenerator.ts` blob. Its character rules, `TITLE_DEDUPE_TERMS`, style → series → function → feature → variant → size → scenario → fallback ladder, blacklist, `scrubEnrichedTitleSegment3`, and clamp behavior are not edited.

`src/lib/contentGenerator/titleFinalizer.ts` adds only the two Owner fixes:

- normalize all pipe spellings/spacing to ` | `;
- append the detected product-type text to the existing second segment when absent.

The helper never reconstructs segment 1 or segment 2 from classification, never assigns segment 1/3, never removes product-type/character text from segment 3, and never ranks a new feature. After the two small fixes it delegates third-segment scrub and length handling to the unchanged Production implementation.

Full Generate and single-field `enriched_title` regeneration both consume the AI's complete title and pass through the same finalizer.

Regression fixtures lock:

- `YOSIDA × 可可貓 | 可可貓 | 吐司麵包頭套吊飾` + `鑰匙圈` → `YOSIDA × 可可貓 | 可可貓 鑰匙圈 | 吐司麵包頭套吊飾`;
- `Razer × 寶可夢|皮卡丘聯名|毒蝰V3專業版SE無線遊戲滑鼠` + `無線滑鼠` → `Razer × 寶可夢 | 皮卡丘聯名 無線滑鼠 | 毒蝰V3專業版SE無線遊戲滑鼠`;
- `MARtube × Pingu|Pingu|迷你相機盲盒創意吊飾` + `迷你相機盲盒` → `MARtube × Pingu | Pingu 迷你相機盲盒 | 迷你相機盲盒創意吊飾`.

For all three fixtures segment 1 and segment 3 are preserved after trimming.

## SKU recovery

Full generation once again treats provider `raw.sku` as the detected SKU and persists `detected.sku || null`. The C1.3 backend-generated/persisted-SKU authority is removed.

The shared prompt again instructs the model to generate:

`CHO-{型態縮寫}-{IP縮寫}-{角色縮寫}-001`

with 2–3 character uppercase English abbreviations and fixed sequence `001`.

Shopify payload returns to the Production `generateSku(...)` seed behavior and Production `variantSeed` precedence. The Chaochao Boss description branch remains layered beside it; SKU recovery does not revert that tone-specific formatting.

Pingu regression fixture: a stale existing draft value `Pingu相機盲盒` must not protect itself against provider output `CHO-BBX-PNG-PNG-001` during Full Generate. Single-field copy regeneration has no SKU mapping/write.

## FAQ / GEO recovery

Shared prompt semantics are restored from the pre-C1.1 Production-derived prompt base:

- 3–5 questions;
- `<h3><strong>問題</strong></h3> + <p>回答</p>`;
- 2–3 sentences per answer;
- creative, interesting, sales-oriented questions aimed at the target audience;
- original suggested question directions;
- original guidance to avoid low-value boilerplate questions;
- GEO answers must stand alone and be understandable without surrounding fields;
- `如上所述` / `如前面提到` / `如圖所示`-style context references are prohibited.

No FAQ Writer V2, new pain-point FAQ strategy, creativity gate, or Chaochao-specific FAQ architecture is added. Chaochao keeps only its already-approved tone-specific emoji allowance; the original six tone semantics stay in the shared base.

## Prompt recovery boundary

`src/lib/providers/systemPromptBase.ts` is the exact initial C1 (`ac86acb...`) shared prompt blob, which preserves Production FAQ/GEO, Production SKU authority, operator-spec authority, direct Web Search context, SEO/secondhand/classification/output rules, while already knowing the seventh manual tone.

`src/lib/providers/systemPrompt.ts` is a thin recovery wrapper. It adds only:

- title separator ` | `;
- append detected product type to the existing second segment;
- Taiwan Traditional customer-facing language requirement;
- tone-specific Chaochao Boss description hierarchy / human brand voice.

The wrapper does not own FAQ architecture, SKU authority, spec merge, Web Search parsing, title feature selection, or title segment reconstruction.

## Taiwan Traditional and R0A parity

`customerFacingFinalizer.ts` remains responsible only for Taiwan Traditional localization and customer source-marker cleanup. Original source fields such as `taobao_title`, `original_title`, raw OCR, and raw Web Search cache are not rewritten.

R0A `specAuthority.ts` remains existing-first: a non-empty `draft.spec_text` is authoritative; only an empty existing spec may adopt provider spec. Single-field regeneration still cannot write spec.

## Explicitly superseded

The following later COPY C1 shared changes are superseded by this recovery:

- C1.2 structured title assembly / model-feature-only title regeneration;
- C1.3 persisted-SKU authority and backend SKU override;
- later global FAQ simplification/rewrite.

Final shared COPY C1 allowlist is only:

1. title separator normalization;
2. title segment 2 product-type append;
3. Taiwan Traditional customer output.

Final tone-specific allowlist is only:

1. seventh manual `潮巢導購版` tone;
2. Boss description hierarchy;
3. Chaochao human/humorous/cute brand voice and its tone-specific emoji allowance.

## Scope freeze

No UI work, title segment-3 redesign, first-segment redesign, new SKU design, FAQ enhancement, Evidence Pack, Vision bridge, Web Search redesign, spec redesign/merge, Why/Highlights enhancement, pricing/variant/inventory change, Shopify lifecycle/go-live change, DB migration, or Shopify production write is part of R0B.

GitHub CI is the authoritative verify/typecheck/build gate for this remote-only package. The immutable final commit SHA is reported by PR #9 and the Commander handoff because a Git commit cannot embed its own final SHA in itself.
