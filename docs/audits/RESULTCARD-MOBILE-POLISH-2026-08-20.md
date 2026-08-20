# ResultCard Mobile Polish — 2026-08-20

## Why this pass exists

The 2026-08-20 iPhone Preview confirmed the previous release-blocking width problem is fixed: ResultCard no longer protrudes past the visible phone frame.

The owner then requested a narrow presentation polish before final Release Candidate testing. This pass must not reopen broad UI/UX work and must not change unrelated behavior.

Owner rule for this pass:

> Change only the requested mobile ResultCard presentation. Do not change working upload, Variant, review, publish, database, role, gesture, or API behavior.

## Runtime-confirmed starting point

Confirmed good before this pass:

- mobile results pane/card no longer protrudes horizontally;
- ImageUploader mobile three-column layout is acceptable;
- mobile thumbnail delete `×` is top-right and usable;
- existing long-press / swipe / multi-select / card expand handlers still exist.

Therefore this pass does **not** touch ImageUploader, Variant, Supabase, Shopify, auth/roles, archive authorization, publish APIs, or database migrations.

## Requested ResultCard presentation changes

### 1. Top row hierarchy

Owner preference:

- product title remains the primary visual anchor;
- station label (for example `文案待審核`) and date should sit on the same top row after the title;
- sale-status badge (for example `海外現貨`) should move down to the summary row that previously carried station/date.

Implementation strategy:

- CSS-only mobile layout;
- `ResultCard.tsx` DOM and handlers remain unchanged;
- mobile wrappers use `display: contents` only for visual grid participation;
- title occupies the flexible first-row area;
- existing `.rc-head-meta` occupies the right side of the same row;
- existing sale-status badge is placed on the thumbnail summary row.

No status calculation or data source changes.

### 2. Remove visible mobile expand arrow

Owner explicitly does not want the large top-right expand button because normal card tap already expands the card.

Decision:

- hide `.rc-toggle` on mobile only;
- keep the existing `handleHeaderClick()` / `tryToggleExpand()` code unchanged;
- desktop behavior is untouched;
- long-press / swipe handlers are untouched.

Note: in multi-select mode, existing code still gives selection priority to card taps. This pass does not rewrite that interaction model.

### 3. Remove inline collapsed-card regenerate button

Owner does not want the extra `重生` button inside the collapsed price row.

Decision:

- hide `.rc-m-regen-slot` on mobile;
- keep regenerate logic and modal intact;
- keep swipe `重生` action intact;
- desktop quick actions remain untouched.

### 4. Simplify collapsed price

Owner wants the price information but not the large rounded box around it.

Decision:

- keep `priceMiniEl` and all price / compare-at / profit data;
- remove mobile border/background/box-shadow treatment;
- let price content render as a compact text row that can wrap safely.

No pricing calculation changes.

### 5. Simplify gesture hint

The previous boxed notice (`長按卡片可多選；左滑可快捷`) looked too heavy.

Decision:

- keep the existing text and dismiss behavior;
- remove box/background treatment;
- render it as small muted helper text.

No localStorage/dismiss logic changes.

### 6. Restyle swipe actions

Owner wants the swipe `核准` / `重生` controls to look less like tall full-height slabs.

Decision:

- keep the existing action buttons and handlers;
- center compact 52–64px action buttons inside the swipe rail;
- use rounded borders and theme tokens;
- do not change action width calculation, swipe threshold, API calls, disabled rules, or confirmation behavior.

## Explicit non-changes (C guard)

This pass must not change:

- `ResultCard.tsx` behavior code;
- `ImageUploader.tsx` or upload pipeline;
- mobile three-column uploader geometry;
- thumbnail delete/spec/spinner/retry/drag behavior;
- VariantEditor / variant persistence;
- long-press timing or swipe gesture math;
- multi-select behavior;
- review/approve/revision APIs;
- archive APIs;
- publish/export APIs;
- Shopify configuration;
- Supabase schema/data/RLS;
- roles/auth model;
- desktop ResultCard quick-action behavior.

## Files allowed in this pass

- `src/app/stabilization.css` — mobile presentation overrides only.
- `scripts/verify-mobile-layout-regression-restore.mjs` — lock the new owner-approved visual contract and preserved handlers.
- `docs/CURRENT_STATUS.md` — current handoff truth.
- this audit.

No other source file should change.

## Runtime gate before Release Candidate

On iPhone, verify:

1. no horizontal protrusion returns;
2. title + station/date read naturally on the top row;
3. `海外現貨` appears in the summary row rather than beside the title;
4. no visible top-right expand button in normal mobile use;
5. tapping the card still expands/collapses outside multi-select mode;
6. collapsed price is readable without a large border box;
7. no inline collapsed-card `重生` button;
8. left-swipe still exposes working approve/regenerate (or station-equivalent) actions;
9. swipe buttons are compact and visually cleaner;
10. long-press multi-select still works;
11. uploader three-column layout remains unchanged.

If these pass, stop ResultCard mobile visual work and proceed to final Release Candidate CI / production-config preflight.
