# Mobile Release Layout — 2026-08-20

## Goal

Move the app toward actual production use without reopening broad UI/UX redesign. The owner wants two runtime-proven mobile problems resolved before the final Release Candidate:

1. ImageUploader thumbnails are now geometrically correct but too small for comfortable phone review.
2. The Results view / ResultCard still paints beyond the visible phone frame and is a release blocker.

This pass changes presentation only. It does not change upload, review, variant, publish, Supabase, Shopify, or role logic.

## Runtime evidence

Owner supplied fresh iPhone screenshots from the latest Preview.

### ImageUploader

Confirmed good from the prior repair:

- horizontal P10/P09 strip is gone;
- thumbnails are square and wrap;
- mobile delete `×` is now large and on the top-right;
- upload/spec UI is usable.

New preference / release requirement:

- four small thumbnails per visual row are too small on phone;
- mobile should show **three equal thumbnail columns per row**.

Decision:

- desktop keeps recovered B17 64/96 geometry;
- phone/tablet (`<=959px`) uses an explicit 3-column CSS grid;
- main and secondary image boxes are equal-size squares on mobile; existing main/spec badges communicate role instead of size;
- delete, spec mark, spinner, retry, paste, drag/reorder, soft-remove and dual-size upload remain.

## Results / ResultCard diagnosis

Earlier attempts focused on ResultCard row3 and nowrap children. Fresh review of the runtime screenshot shows a broader signal: not only the card, but also the stage filter / sort area can be clipped on the right.

Therefore the mobile **results pane itself** must be the first width boundary. If an intrinsic-width child can enlarge the pane, fixing individual card children will keep producing regressions.

### Release-safe layout strategy

At `<=959px`:

- `.workbench`, `.workbench-panes`, active results pane, results panel/body/list, swipe wrapper, card and card header are all explicitly `width:100%`, `min-width:0`, `max-width:100%`;
- results-pane horizontal paint is clipped at the pane boundary;
- stage pills keep their intended internal horizontal scrolling instead of widening the pane;
- ResultCard keeps the existing title / thumb+chips / action-price structure;
- all chip/meta groups are shrinkable and width-bounded;
- long failure text can break instead of creating min-content width;
- wider mobile may keep regen + price side by side;
- phone widths (`<=639px`) stack regen/price and allow price/profit/tone text to wrap.

This is not a historical revert. ResultCard has accumulated features for too long to assume an old visual commit is canonical. The release contract is now: **all existing actions remain, but no content may widen the phone results pane beyond the visible frame.**

## Preserved behavior

Must remain unchanged:

- explicit expand button;
- header tap behavior;
- long-press multi-select;
- swipe actions;
- regenerate;
- price content;
- stage/status/tag data;
- ImageUploader spinner/retry/paste/drag/spec/delete pipeline;
- Variant behavior;
- archive/publish APIs.

No `ResultCard.tsx` or `ImageUploader.tsx` behavior code is changed in this pass.

## Files in this pass

- `src/app/stabilization.css`
  - 3-column mobile uploader;
  - mobile results-pane containment;
  - responsive ResultCard constraints.
- `scripts/verify-mobile-layout-regression-restore.mjs`
  - locks three-column mobile uploader, results-pane width boundary, internal stage-pill scroll, phone wrapping and preservation of later UX.
- `docs/CURRENT_STATUS.md`
  - records current release state and next gate.
- this audit.

## Runtime gate

The next Preview must pass on iPhone before any merge / production deploy:

1. uploader shows exactly three comfortable square thumbnails per row;
2. delete `×` remains top-right and easy to tap;
3. spec badge remains usable and does not collide with `×`;
4. stage filters / scope / sort stay within the phone frame (stage pills may scroll internally);
5. ResultCard border is fully visible inside the phone frame;
6. title/chips/status/tone/price/profit never protrude past the card;
7. regen, expand, long-press, swipe, multi-select still work.

If these pass, stop mobile layout work and proceed to the final Release Candidate CI gate.
