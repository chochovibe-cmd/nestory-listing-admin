# ResultCard Mobile Owner Correction R3 — 2026-08-20

## Scope

This pass moves the reviewed R3 behavior out of temporary GitHub Actions and
into normal source code. It changes only mobile ResultCard/results
presentation plus the minimum DOM required for exact ordering and direct
copy-review archive access.

## Final hierarchy implemented

- `只看我的` / `最新在上`: equal width and 38px height.
- Card top flow: natural **title → station label → date** wrapping; station and
  date are no longer pinned beside the title's first line.
- Summary: image left, sale status + tags + warnings right; 94px mobile image
  anchor and 88px on narrow screens (`<=420px`).
- Price: sale, compare-at strike, profit and percentage share one visual row.
- Card `×`: existing `archiveOne()` control straddles the top border; soft
  archive and undo semantics are unchanged.
- Panel header: generation title and compact sequential-review action share
  row 1; select-all remains below.
- Copy-review selection: direct **取消 / 批次核准 / 移出佇列** peer actions.
- Image-review retains its real multi-action `更多` menu.

## Formal source

- `src/components/listing/ResultCard.tsx`: mobile-only inline station/date DOM
  using existing station and time formatters.
- `src/components/listing/DraftResultsPanel.tsx`: station-specific batch class
  and direct copy-review soft-remove button.
- `src/app/resultcard-mobile-release.css`: R3 mobile hierarchy and layout.
- `scripts/verify-mobile-resultcard-owner-refine.mjs` and
  `scripts/verify-mobile-layout-regression-restore.mjs`: R3 source contracts.

## Release cleanup

Removed the one-shot patch scaffolding after confirming all reviewed behavior
exists in formal source:

- `.github/workflows/mobile-resultcard-r3-pr-runner.yml`
- `.github/workflows/mobile-resultcard-r3.yml`
- `.github/workflows/mobile-resultcard-structural-patch-temp.yml`

## Explicit C guard

No changes to ImageUploader, Variant, Supabase, Shopify, auth/roles, API routes,
archive semantics, long-press timing, swipe threshold, swipe math, or desktop
quick actions.

## Manual QA still required

Validate on iPhone: short/long title wrapping, top-border X + undo, balanced
summary, single-line price, 38px controls, compact panel header, direct
three-button copy batch toolbar, image-review More, long-press/swipe/tap-expand
behavior, uploader three-column sanity, and Variant picker/zoom sanity.
