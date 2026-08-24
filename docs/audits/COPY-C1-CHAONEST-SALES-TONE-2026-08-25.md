# COPY C1 — Chaochao Sales Copy Tone

Date: 2026-08-25

## Start guard

- Repo: `chochovibe-cmd/nestory-listing-admin`
- Start HEAD: `21e9d1c90697797aaa6d982e9454ccd4a6955fd8`
- Branch: `agent/copy-chaocao-sales-tone`
- Default/base: `codex/nestory-v0.1-safety-skeleton`
- Final commit: see immutable branch / PR final HEAD

## Changed files

- `src/components/listing/WorkspaceInputPanel.tsx`
- `src/lib/providers/copy.ts`
- `src/lib/providers/systemPrompt.ts`
- `src/lib/contentGenerator/sectionHeaders.ts`
- `docs/文案排版規範-2026-07-18.md`
- `docs/CURRENT_STATUS.md`
- `docs/audits/COPY-C1-CHAONEST-SALES-TONE-2026-08-25.md`
- `scripts/verify-copy-c1-chaonest-sales-tone.mjs`
- `scripts/verify-all.mjs`

## Tone contract

`潮巢導購版` is the seventh **manual** copy tone. UI metadata:

- emoji: `🛍️`
- description: `痛點導購・資訊完整`
- `usesEmoji=true` means emoji is allowed, not mandatory.
- Placement: after `小編聊天口吻`, before `依IP自動匹配`.
- `DEFAULT_TONE` remains the original first tone (`黑膠文藝收藏感`).
- `DEFAULT_IP_TONE_MAP` is unchanged. No IP auto-match maps to `潮巢導購版`.

## Description layout

Only `tone === "潮巢導購版"` uses this description rhythm:

1. Pain / desire opening, no heading, 1–2 sentences, do not lead with product name.
2. Product introduction, 2–4 sentences, facts connected to consumer meaning.
3. `◈ 收藏亮點` — usually 3–4 product-specific feature + benefit bullets.
4. `◈ 為什麼會想帶回家` — short buying-motive / audience / usage-context paragraphs.
5. `◈ 商品資訊` — evidence-only facts; may be omitted if evidence is insufficient.
6. `◈ 購買提醒` — 1–3 product/material-specific reminders.

The original six tones keep the existing layout:

- opening
- `◈ 商品亮點`
- `◈ 適合誰`
- `◈ 商品資訊`
- `◈ 購買提醒`

The implementation uses one tone-aware description helper rather than duplicating the full system prompt. Shared evidence rules, detection, spec safety, SEO, FAQ and output contract remain shared.

## Parser compatibility

`sectionHeaders.ts` remains the single source of truth:

- `商品亮點` → B (existing)
- `收藏亮點` → B (new alias)
- `適合誰` → C (existing)
- `為什麼會想帶回家` → C (new alias)
- `商品資訊` → D
- `購買提醒` → E

No alternate parser was introduced.

## Factual safety

COPY C1 keeps the existing evidence hierarchy. The richer sales layout does not relax factual safety:

- exact dimensions, capacity, weight, count and other numbers require source/variant/spec/detail-image text or a trustworthy research summary;
- no precision guessing from visual appearance;
- no invented material, waterproofing, food-safety, thermal-retention, battery-runtime or similar claims;
- if the evidence pool contains at least three product-specific facts, description + highlights should use at least three; if not, do not invent facts to hit the count;
- feature → benefit is allowed only when the benefit reasonably follows from the known feature.

## Emoji

For `潮巢導購版`:

- description: 0–2 emoji;
- FAQ: 0–1 emoji;
- optional, never mandatory;
- no emoji in section headings, `enriched_title`, `seo_title`, or `meta_description`.

The existing mandatory `小編聊天口吻` emoji contract is not copied to this tone.

## Single-field regeneration

- Regenerating only `generated_description_html` reuses the tone-aware description helper, so COPY C1 keeps its dedicated layout.
- Regenerating only `generated_faq_html` stays on FAQ-specific instructions and does not alter the description layout.
- Workspace autosave/tone restore uses the existing dynamic tone-option validation, so the seventh tone can be restored without a hard-coded six-tone reset.

## Quality fixtures

No production LLM or Shopify call is needed for acceptance. The dedicated verifier carries three no-cost fixtures to confirm distinct buying motives and at least three product-specific evidence points per fixture:

- plush / charm: bag personality / character-identification angle;
- cup / daily-use item: bring a favourite character into a repeated daily routine;
- electronics / desktop function: add character identity and atmosphere to an already-functional desktop setup.

The fixtures explicitly avoid collapsing every product into the same `可愛 / 療癒 / 送禮 / 收藏` template.

## Verification gates

Dedicated verifier: `scripts/verify-copy-c1-chaonest-sales-tone.mjs`

It checks:

- CopyTone / COPY_TONES / seventh UI card / unchanged DEFAULT_TONE;
- manual-tone pass-through and unchanged auto-map semantics;
- dedicated description branch + required headings + feature → benefit + evidence safety;
- optional emoji policy;
- new and legacy section aliases;
- single-field regeneration semantics;
- layout documentation;
- frozen start-HEAD Git blob SHAs for `titleGenerator.ts` and Shopify lifecycle files;
- three distinct fixture categories.

The verifier is included in `scripts/verify-all.mjs`.

Canonical repository gates remain:

- dedicated verifier
- `verify:all`
- TypeScript typecheck
- relevant existing tests/verifiers
- production build

## Scope freeze declaration

COPY C1 explicitly does **not** change:

- title formula / `titleGenerator.ts` / enriched-title skeleton;
- SEO title formula;
- Shopify publish/unpublish lifecycle;
- Supabase schema or migrations;
- pricing;
- Variant behavior;
- ResultCard layout;
- auth;
- image pipeline.

No Shopify production write is part of this package. No competitor copy is stored or used as a few-shot example; only the owner-approved information-order/layout rhythm is borrowed, and all wording is generated under the Chaochao brand voice.
