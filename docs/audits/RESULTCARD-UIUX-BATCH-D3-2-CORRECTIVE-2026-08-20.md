# ResultCard UIUX Batch D3.2 Corrective — 2026-08-20

## Scope

Corrective presentation-only pass on PR #8 after owner/Commander runtime review of D3.
No Shopify, Showmore, Supabase, auth, pricing/storage meaning, archive semantics,
ResultCard business semantics, long-press timing, swipe threshold/math, or Variant
data/persistence semantics changed.

## Corrective approach

- Kept D3's existing handlers and controlled Variant builder state.
- Added a final, narrow `d32-corrective.css` layer after the D3 stylesheet instead
  of rewriting ResultCard or Variant data/event code.
- Restored the D2 mobile card grid containment by re-applying `display: contents`
  to the header wrappers that D3's late flex rules had overridden.
- Explicitly placed sale-status and variant-count metadata so they no longer
  compete with tags/warnings, while keeping the existing compact price row.
- Standardized selected batch action controls to the same 40px height/weight.
- Kept select-all as a theme-accented toggle. On mobile it precedes a persistent
  helper hint; the old dismissible hint is visually suppressed, so no close
  control is exposed and prior localStorage dismissal cannot remove guidance.
- Simplified mobile Variant presentation without changing Variant meaning:
  dimension/character panels expand in-flow on mobile, direct actions remain
  wired to their existing handlers, and the builder/result hierarchy is flatter.
- Tightened mobile Variant result cards to one restrained boundary per row and
  de-emphasized the drag handle while retaining up/down, duplicate and delete
  controls.

## Changed files

- `src/app/d32-corrective.css`
- `src/app/layout.tsx`
- `docs/audits/RESULTCARD-UIUX-BATCH-D3-2-CORRECTIVE-2026-08-20.md`

## Verification contract

Final authority remains the existing PR #8 gates:

- `git diff --check`
- `pnpm run verify:all`
- `pnpm run typecheck`
- `pnpm run build`
- existing ResultCard mobile/gesture/layout/D2/D3 and Variant containment verifiers
- GitHub CI and Vercel Preview after the single corrective push
