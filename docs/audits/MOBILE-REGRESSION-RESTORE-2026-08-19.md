# Mobile Regression Restore — 2026-08-19

## Why this exists

User reported that mobile UI was previously correct, then later UI/UX optimization passes changed proportions and introduced clipping. The goal is **not** to revert whole features. Restore only proven bad geometry while preserving later intentional UX.

Full forensics: `docs/audits/UIUX-COLLATERAL-REGRESSION-AUDIT-2026-08-19.md`.

## ImageUploader

- B17 `4304866` is the last intentional pre-P10 sizing pass: secondary thumbnails 64×64, main thumbnail 96×96, wrapped.
- P10 `ed342ce` changed the input uploader to nowrap horizontal scrolling with 96×96 secondary / 120×120 main thumbnails while adding spec-corner / Station② work.
- P08 `159721e` was a later 72/96 repair, not the original geometry anchor.
- P09 `8c7db19` intentionally restored the P10 geometry.
- Current owner direction explicitly supersedes only that oversized/nowrap geometry: restore wrap + 64/96.

### Controls explicitly NOT reverted

Forensic review found that input spec top-right + delete × top-left were recorded P10/P09 design decisions, not proven accidental collateral. They remain unchanged unless runtime preview later proves they are broken.

Also preserve uploader spinner, upload-failure retry, paste upload, drag/reorder, soft-remove fade, dual-size upload and the existing upload pipeline.

## ResultCard

B4-P04 `47a96c` is an explicit intended feature, not something to wholesale revert. Its mobile contract is still:

1. title
2. thumbnail + chips
3. regenerate + price

The bug is narrower than the feature:

- the parent first column is 64px because row 2 uses a 64px thumbnail;
- row 3 reused that same first column for the regenerate button;
- the regenerate button has a minimum width of 72px;
- price text is nowrap, and P07 intentionally clips horizontal bleed.

That combination lets the row-3 button intrude into price space and makes the collision appear as right-side clipping on narrow cards.

### Repair

Preserve P04's three-row semantics, but decouple row 3 from the thumbnail track:

- parent row 3 becomes `"row3 row3"`;
- `.rc-m-row3` owns an inner grid: `max-content minmax(0, 1fr)`;
- regenerate stays on the left;
- price stays on the right.

Do **not** restore the old B2-P09 card and do **not** split regenerate/price into separate visual rows.

## Preserve later UX

Do not revert or remove:

- optimistic upload spinner / `uploadSpin` animation;
- upload failure state and retry;
- thumbnail delete control and soft-remove animation;
- drag-and-drop upload and thumbnail reorder feedback;
- per-thumbnail spec marking / later spec badge behavior;
- dual-size image upload pipeline;
- ResultCard long-press multi-select;
- ResultCard swipe actions;
- gesture hint;
- explicit mobile expand affordance;
- P04 mobile regenerate action;
- P07 workbench containment;
- P1-2 Variant picker containment fix.

## Files

- `src/app/stabilization.css`
  - post-load geometry overrides only.
- `scripts/verify-mobile-layout-regression-restore.mjs`
  - locks both sides of the contract: only proven B geometry may change; intentional A/later UX must remain.
- `scripts/verify-all.mjs`
  - runs the regression verifier.
- `docs/audits/UIUX-COLLATERAL-REGRESSION-AUDIT-2026-08-19.md`
  - full A-vs-B forensic matrix and explicit no-change decisions.

No product data, Supabase production schema, Shopify settings, Vercel settings, merge, or production deploy is changed by this repair branch.

## Runtime gate

Source history and CSS constraints are now audited, but final visual truth still requires one mobile Preview after Vercel Hobby deployment quota recovers. Until then, do not claim the visual regression is runtime-verified.
