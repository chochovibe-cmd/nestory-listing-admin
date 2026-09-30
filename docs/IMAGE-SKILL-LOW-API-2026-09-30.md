# Nestory Image Skill Studio — Low-API MVP (2026-09-30)

> Branch: `gpt/image-skill-low-api-20260930`
>
> Status: isolated source/Preview work. **Not merged to default branch, not production.**
>
> Goal: make Station 2 image work feel closer to asking an image assistant to edit product assets, while keeping API spend predictable and avoiding an extra AI-planner call.

## Owner decision

The operator already knows what they want to do. Default flow is therefore:

```
human chooses task
→ task-specific Skill policy
→ deterministic tool when possible
→ otherwise ONE reference-image edit
→ human reviews result
```

No automatic per-image Vision/Planner is run by default.

Existing draft `image_description` is reused as optional verified visual context. The Studio does not pay for a second Vision analysis just to decide the task.

## User-facing tasks

| Task | Default API behavior | Purpose |
| --- | --- | --- |
| 免費補成方形 | 0 image API | add square canvas/negative space without crop or stretch |
| AI 延展成方形 | 1 image edit, low | naturally extend surrounding scene to square |
| 主圖優化 | 1 image edit, low | preserve product, improve background/spacing/presentation |
| 創意主圖 | 1 image edit, low | use 1–4 references, first image is identity anchor |
| AI 廣告圖 | 1 image edit, low + local typography | create text-free 4:5 visual base, then Nestory overlays Traditional Chinese |

`standard` quality is an explicit operator choice and maps to medium. The app never generates four candidates automatically; one click = one output.

For multi-reference tasks, UI warns that more reference images increase image-input token cost. Usually 1–2 references are enough.

## Existing marks

Visible legacy marks remain:

- 保留原圖
- 簡轉繁
- 去字

Historical `regenerate` remains supported in domain/backend for old rows and retries, but is hidden from new picks. Text-only regeneration was unsafe for exact merchandise because it could redraw licensed product details from title/description rather than anchor to the source image.

## GPT Image routing

- `OPENAI_IMAGE_MODEL`: legacy text-only regenerate path.
- `OPENAI_IMAGE_SKILL_MODEL`: reference-preserving edits and Studio; default `gpt-image-2`.
- `de_text`: GPT Image 2 edit, low quality by default.
- `to_trad`: GPT Image 2 edit, medium quality by default because rendered text needs more clarity.
- Studio economy: GPT Image 2 edit, low.
- Studio standard: GPT Image 2 edit, medium.

For de-text / Traditional conversion, output dimensions are derived from the source aspect ratio instead of blindly forcing 1024×1024.

## Product-fidelity policy

Every advanced Skill prompt treats the real product reference as source of truth.

Do not alter:

- product count
- proportions
- colors
- character face / printed artwork
- logos
- packaging
- accessories
- patterns / hardware
- distinctive physical details

If visual style conflicts with fidelity, simplify the scene instead of redesigning the product.

### De-text rule

Remove only overlay/seller/promo text and stickers. Do not erase or redraw logos or text physically printed on the real item/package unless a later explicit feature says so.

### Simplified → Traditional rule

Convert informational overlays/captions/tables. Preserve trademarks, brand logos, decorative artwork, and product-native printed design.

No OCR redesign is part of this package.

## Square behavior

`square_pad` is pure Sharp:

- no image API
- no crop
- no stretch
- no upscaling
- centered on cream / white / black square canvas

`square_ai` is only for cases where the background itself needs to be naturally extended.

## Ad creative architecture

The old `runComposeDetailForDraft` remains as the deterministic **資訊詳情圖** (spec/highlight card).

New `ad_creative` is separate:

```
selected product/reference images
→ GPT Image 2 creates text-free 4:5 visual
→ Nestory SVG/Sharp typography layer
→ real Traditional Chinese headline/subline
→ generated_detail asset
```

This avoids repeated image-model calls caused by misspelled Chinese.

## Station 2 information architecture

Tabs now include:

- 主圖
- 規格圖
- 詳情素材
- AI 產出

Raw `detail` images are evidence/reference material and do not belong in the Shopify media gallery.

`generated_detail` assets are the publishable generated creatives. The UI tells the operator to delete unwanted versions before publish.

Shopify description image embedding now prefers `generated_detail` over raw `detail` when both exist.

## No-migration integration

No new DB column is required for MVP.

For an existing main/variant image edited by an advanced Skill:

- Skill output is stored in `generated_file_url` and immediately previewed via `processed_file_url`.
- `process_intent` is set to `keep` for compatibility.
- a flat draft `image_flags["image_skill_source:<imageId>"]` marker tells downstream Sharp to use the Skill output instead of the original source.

This prevents send-images from silently overwriting a good Skill result with the original image.

If the operator later manually chooses a legacy mark, that is an explicit override and the Skill source marker is cleared. Choosing 保留原圖 returns the preview source to the actual original.

## Cost policy

Cost controls in MVP:

1. no auto-planner call;
2. reuse existing image description;
3. deterministic Sharp before AI;
4. low-quality draft is default;
5. exactly one generated output per click;
6. multiple references are optional and cost-warning is visible;
7. human review replaces automatic Vision/fidelity QA by default.

Automatic image QA is intentionally **not** run after every image because that would add another model call. It can be added later as an opt-in check for high-risk/final assets.

## Important limitations still remaining

These are intentionally not hidden:

1. **No true mask/local-region detector yet.** De-text / Traditional conversion use high-fidelity reference edit with stricter prompts but do not yet programmatically generate a mask.
2. **No automatic fidelity QA call.** Human review is the low-cost default.
3. **No formal V1/V2/V3 history table for edited main images.** Re-running a main-image Skill overwrites the current generated source for that row. Ad creatives are separate rows, so multiple versions can coexist and unwanted ones must be deleted.
4. **Review reject still does not automatically call the image model.** Iteration is currently done by reopening Image Skill Studio, editing the optional instruction, and generating one new version. A direct Review → revision loop is a later package.
5. Exact live visual quality cannot be proven by source/build tests. It needs owner Preview testing with real product images and an authorized OpenAI key.

## Validation

Dedicated no-network contract:

```
pnpm run verify:image-skill
```

Also included in `verify:all`.

The branch inherited an unrelated pre-existing failing verifier from its base:

```
scripts/verify-copy-c1-chaonest-sales-tone.mjs
AssertionError: Boss hierarchy wrapper disappeared
```

This failure existed on the branch base before Image Skill work. Do not modify the copy/tone line as part of this image package.

Vercel Preview builds are used to prove Next.js/TypeScript compilation independently of that inherited verifier.

## Files

Core:

- `src/lib/images/imageSkills.ts`
- `src/lib/images/squarePad.ts`
- `src/lib/images/adCreative.ts`
- `src/lib/providers/openai-image-provider.ts`
- `src/app/api/images/skill-process/route.ts`

UI:

- `src/components/listing/ImageSkillStudio.tsx`
- `src/components/listing/Station2ImagePanel.tsx`
- `src/lib/images/station2ImageTabs.ts`
- `src/app/image-skill-studio.css`

Pipeline/publish guards:

- `src/lib/images/runSharpBatch.ts`
- `src/lib/shopify/payload.ts`
- `src/lib/contentGenerator/descriptionEmbed.ts`

Verification:

- `scripts/verify-image-skill-low-api.mjs`
