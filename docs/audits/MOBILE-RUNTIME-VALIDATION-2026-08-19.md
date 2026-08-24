# Mobile Runtime Validation — 2026-08-19

## Why this exists

This is the runtime follow-up to `UIUX-COLLATERAL-REGRESSION-AUDIT-2026-08-19.md` and `MOBILE-REGRESSION-RESTORE-2026-08-19.md`.

The prior source/history audit intentionally changed only evidence-backed collateral. The owner then tested the actual Vercel Preview on iPhone and supplied screenshots. Those screenshots are now higher-confidence evidence than historical intent for the two remaining mobile presentation problems below.

## Runtime result: ImageUploader

Confirmed good:

- wrapped thumbnail strip is restored;
- secondary thumbnails are back to 64×64;
- main thumbnail is back to 96×96;
- the layout no longer behaves like the P10/P09 oversized horizontal strip.

New runtime evidence:

- the input delete `×` is still visually too small on iPhone;
- the owner wants the delete affordance at the top-right on mobile;
- desktop behavior should not be changed;
- the spec badge still needs to remain available.

### Runtime repair

Mobile only (`<=959px`):

- input delete moves to top-right;
- visual/touch box becomes 32×32 instead of inheriting the old 18×18 control;
- spec badge shifts inward so it does not collide with the enlarged delete control.

No upload pipeline, paste, retry, spinner, reorder, soft-remove, or spec-marking logic changes.

## Runtime result: ResultCard

The previous row-3-only repair was insufficient. iPhone Preview still showed right-side clipping/protrusion.

The runtime screenshot shows more than one intrinsic-width source in the same card:

- long tone/detection chips can stay nowrap;
- price / compare-at / profit strings can stay nowrap;
- row3 contains regenerate + price content;
- the workbench intentionally clips horizontal bleed.

Therefore there is no reliable historical single layout to "restore". The owner explicitly approved treating ResultCard as a normal responsive-layout problem, while preserving its later functionality.

### Runtime repair policy

Keep all behavior:

- regenerate;
- explicit expand;
- long-press multi-select;
- swipe actions;
- selection behavior;
- existing status/tag content.

Change mobile presentation only:

- card/header/chip groups are hard-bounded to `100%` with `min-width:0`;
- long chips ellipsize instead of painting outside the card;
- wider mobile/tablet keeps regen + price in a shrink-safe two-column row;
- phone widths (`<=520px`) may stack regen and price vertically;
- phone price / compare / profit strings may wrap instead of forcing overflow.

This intentionally supersedes the earlier assumption that P04's exact row3 visual composition had to remain unchanged on all phone widths. The behavior is preserved; the phone presentation is allowed to adapt to the available width.

## Files changed

- `src/app/stabilization.css`
  - mobile-only delete affordance + responsive ResultCard containment.
- `scripts/verify-mobile-layout-regression-restore.mjs`
  - locks runtime-confirmed thumbnail geometry, mobile delete placement/size, bounded chips, phone stacking/wrapping, and preservation of later interactions.
- `docs/CURRENT_STATUS.md`
  - records the runtime findings and release gate.

No `ImageUploader.tsx` or `ResultCard.tsx` behavior code is changed. No Supabase production schema/data, Shopify configuration, Vercel production target, merge, or production deploy is changed.

## Next runtime gate

Generate one new Preview from this single commit and verify on iPhone:

1. delete `×` is top-right, easy to see/tap, and does not obscure the spec badge;
2. upload thumbnails remain 64/96 wrap;
3. ResultCard border and every chip stay inside the visible card;
4. price / compare-at / profit remain fully readable without horizontal protrusion;
5. regen, expand, long-press, swipe and multi-select still work.

If this Preview passes, stop changing mobile layout and move to the final Release Candidate / CI gate.

## Changelog note

This change is fully recorded in this audit and `docs/CURRENT_STATUS.md`. The long append-only `docs/CHANGELOG.md` is not rewritten through a connector operation unless a safe append path is available; do not truncate or replace it merely to add this entry.
