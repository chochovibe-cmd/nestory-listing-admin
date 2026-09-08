# COPY C1 / C1.1 — Chaochao Sales Copy Tone

Date: 2026-08-25

## Git authority

- Repo: `chochovibe-cmd/nestory-listing-admin`
- COPY C1 base/default HEAD: `21e9d1c90697797aaa6d982e9454ccd4a6955fd8`
- Branch: `agent/copy-chaocao-sales-tone`
- Existing PR: `#9 Copy C1: add Chaochao sales copy tone`
- COPY C1 initial HEAD / C1.1 corrective parent: `ac86acbd4ed13e7d658daa6bb216b056f3b25c0b`
- C1.1 final commit: see immutable PR #9 final HEAD / Commander final report (do not add a second commit just to self-record its SHA).

## COPY C1 stable base

`潮巢導購版` remains the seventh **manual** tone:

- UI: `🛍️ 潮巢導購版`
- description: `痛點導購・資訊完整`
- placement: after `小編聊天口吻`, before `依IP自動匹配`
- `DEFAULT_TONE` unchanged
- `DEFAULT_IP_TONE_MAP` unchanged; C1 is not an auto-match target
- original six tones remain supported

## COPY C1.1 Owner corrective scope

Owner rejected C1 initial runtime output. C1.1 changes exactly three areas:

1. enriched-title contract bug: segment 2 must include `角色 + 商品類型`, all pipes normalize to ` | `;
2. `潮巢導購版` description uses the boss-format Shopify semantic hierarchy and a more human Chaochao voice;
3. all generated customer-facing copy is finalized to Taiwan Traditional, and full-generation `spec_text` becomes a clean Shopify-facing spec rather than raw marketplace/OCR backend fields.

No fourth feature is included.

## 1. Title corrective

Current first segment remains **品牌 × IP**. C1.1 does not decide the later Owner question of `IP × 品牌` vs `品牌 × IP`.

Final three-segment contract:

```text
品牌 × IP | 角色・角色 商品類型 | 特色
```

Deterministic backend normalization now owns:

- `A|B|C`, `A｜B｜C`, `A | B | C` → `A | B | C`;
- add detected product type to segment 2 when absent;
- do not append product type twice;
- safe removal of an exact repeated product type from segment 3;
- preserve third-segment blacklist;
- preserve 80-char enriched and 60-char official clamp behavior.

Acceptance fixture:

`MARtube × Pingu|Pingu|迷你相機盲盒創意吊飾` + detected type `盲盒`

must become a title whose prefix is:

`MARtube × Pingu | Pingu 盲盒 | ...`

## 2. Boss-format Chaochao description

`潮巢導購版` plain source contract:

```text
商品介紹
（正文）

收藏亮點
・...
・...
・...

導購小標：AI 依商品動態生成
（導購正文）
```

Shopify-bound main HTML:

```html
<h2>商品介紹</h2>
<p>短資訊型到貨提醒</p>
<p>正文...</p>
<h2>收藏亮點</h2>
<ul><li>...</li></ul>
<h2>動態導購小標</h2>
<p>導購正文...</p>
```

For this tone only:

- no `◈` in the main description;
- no main-section `<h3>`;
- no `商品資訊` / `購買提醒` H2;
- no inline font-size / typography styles;
- Nestory Preview recognizes the same C1 source contract and renders h2/p/ul/li;
- original six tones keep the existing `<h3><strong>◈ ...</strong></h3>` formatter.

Short C1 notices:

- overseas: `此為海外代購商品，預估約 14 天。`
- preorder: `此為預購商品，到貨時程以頁面說明為準。`
- Taiwan stock: `此為台灣現貨商品，約 1–3 個工作天出貨。`
- secondhand: `此為二手現貨商品，品況請見商品資訊，約 1–3 個工作天出貨。`

Legacy tone notices remain unchanged.

## 3. Human Chaochao voice

C1.1 explicitly rejects AI-commerce boilerplate such as:

- `總是覺得……嗎？`
- `是否正在尋找……`
- `一大力作`
- `滿載童趣`
- `最佳選擇` / `完美選擇`
- `絕對不能錯過`
- `完美地將……`
- `帶給你無限……`
- `陪伴左右`
- `為生活增添一抹……`
- `不僅……更……`
- `療癒指數爆表`
- `收藏價值滿滿`
- `送禮自用兩相宜`
- `值得入手` / `值得考慮`

Desired direction: human, warm, funny, cute, lived-in Taiwanese copy; character jokes and light teasing are allowed; battle IP may use light `裝備 / 覺醒 / 戰力 / 召喚` language when suitable, but never as fake product functionality.

Boss/competitor wording is never used as few-shot material. Only the semantic HTML hierarchy is borrowed.

## 4. Taiwan Traditional customer-facing finalizer

Raw evidence stays raw: `taobao_title`, `original_title`, OCR/source cache are not rewritten.

Before customer-facing persistence, generated text is finalized through Taiwan Traditional localization + source-marker stripping for at least:

- title_zh / enriched history
- description
- FAQ
- SEO title
- meta description
- why_we_chose_it
- product_highlights
- spec_text

## 5. Full-generation spec canonicalization

C1.1 changes the old authoritative-spec bug:

- provider `spec` non-empty → provider-cleaned evidence spec is canonical for **full generation**;
- provider `spec` empty → fallback to existing `spec_text`;
- selected text → Taiwan Traditional → strip source markers → retain only customer-useful spec labels.

Useful customer labels include brand/IP/series/character/product type/material/size/capacity/package/accessories/variants/function/blind-box rule/license and evidence-backed electronic specs.

Raw marketplace backend labels such as `分類 / 貨品分類 / 顏色分類 / 適用人群 / 是否為特殊用途化妝品 / 流行趨勢詞 / 場景類型 / 適用節日 / seller promo / platform campaign` are not persisted verbatim.

If a junk-labeled line contains real purchase semantics, only the useful fact is preserved. Fixture example:

```text
分类：【盲盒不可指定】
品牌：MARtube/马克图布
颜色分类：【随机1个】
适用人群：女生
是否为特殊用途化妆品：否
流行趋势词：可爱
```

must keep useful facts such as:

```text
品牌：MARtube/馬克圖布
盲盒方式：隨機出貨，不可指定款式
```

without fabricating numeric specifications.

## 6. Regen safety

Single-field regeneration remains limited to the existing seven copy fields. `spec_text` is not in `REGEN_FIELD_TO_COLUMN`, and `handleFieldRegen` does not write it.

Therefore description / FAQ / SEO single-field regen does not overwrite a spec manually edited after full generation.

## 7. Verification

`scripts/verify-copy-c1-chaonest-sales-tone.mjs` is expanded to COPY C1.1 and checks:

- title separator + segment-2 product type fixture;
- 60/80 length/blacklist semantic source contracts;
- brand × IP first-segment freeze;
- boss-format three-H2 fixture and notice ordering;
- dynamic third H2 / no ◈ / no main H3 / no 商品資訊 or 購買提醒 H2;
- original six-tone formatter compatibility;
- Taiwan Traditional + Pingu raw-spec cleanup fixture;
- why_we_chose_it / product_highlights finalizer wiring;
- raw source fields not updated;
- single-field regen cannot write spec_text;
- P4 source/seller safety remains present;
- Shopify lifecycle files remain byte-identical.

Canonical CI gates remain `verify:all → typecheck → build`.

## Scope declaration

COPY C1.1 explicitly does **not** change:

- first title segment order (`品牌 × IP` remains current rule);
- SEO formula design;
- Tags V2;
- pricing / inventory / variants;
- mobile Variant UI;
- unrelated ResultCard layout;
- Shopify product publish/unpublish lifecycle;
- Shopify credentials / `SHOPIFY_PUBLISH_MOCK`;
- Supabase schema / migrations.

No Shopify production write is part of C1.1. PR #9 must remain unmerged until Owner iPhone + real generation acceptance.
