# ResultCard UIUX Batch D1 — 2026-08-20

## Scope

Presentation-only follow-up on PR #8. No API, Shopify, Showmore, Supabase,
auth/role, Variant semantics, archive semantics, long-press timing, or swipe
math changed.

## Implemented

- Mobile/desktop selection hierarchy: select-all guide row, batch row beneath.
- Copy batch: equal-height Cancel / Approve / Remove actions.
- Image-review batch: direct pass, detail-image on/off, and remove actions;
  the More disclosure was removed without removing its operations.
- Mobile title flow: primary station, secondary revision status, then date.
- Mobile price peers use a baseline-aligned grid.
- Desktop card: title row first; image left and supporting information/actions
  vertically centred on the second row.
- Archive X remains the existing soft-remove action and is fully visible at the
  upper right on both viewports.
- Visible expand triangle removed; card tap still calls the existing expand
  path. Long-press and swipe constants/handlers are unchanged.

## Verification

- `git diff --check` — pass.
- ResultCard owner/D1, expand, gesture, and mobile regression source verifiers — pass.
- `node scripts/verify-all.mjs` — all checks through CAP1 passed; CAP2 could not
  start because this checkout has no installed `linkedom` dependency.
- `pnpm run verify:all`, typecheck, and build require dependency installation;
  the Work runtime cannot reach the package registry. Final authority is GitHub CI.
