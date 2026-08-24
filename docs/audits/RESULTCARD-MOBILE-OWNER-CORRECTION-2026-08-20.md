# ResultCard Mobile Owner Correction — 2026-08-20

## Why this pass exists

The owner reviewed the 2026-08-20 iPhone Preview and clarified that the previous ResultCard polish misunderstood the intended information hierarchy. Width containment itself is now confirmed good and must not be reopened.

Hard rule for this pass:

> Fix only the requested ResultCard / results mobile presentation. Do not change unrelated upload, Variant, database, Shopify, review, publish, auth, role or gesture behavior.

## Runtime-confirmed starting point

Confirmed before this change:

- ResultCard no longer protrudes outside the mobile viewport;
- ImageUploader three-column mobile grid is acceptable;
- upload delete/spec/spinner/retry/drag behavior is working;
- card tap expand, long-press, left-swipe and multi-select handlers already exist;
- archive is intentionally a soft “remove from queue” operation with undo, not hard deletion.

Therefore this pass does not rewrite any API or persistence behavior.

## Owner-corrected card contract

### Row 1 — text hierarchy only

Visual order:

1. product title;
2. station label such as `文案待審核`;
3. date;
4. small top-right `×` soft-remove control.

The visible large expand arrow remains hidden on mobile. Normal card tap still expands/collapses through the existing `handleHeaderClick → tryToggleExpand` path.

### Summary block — image left, information right

- thumbnail stays on the left;
- right side starts with sale-status (`海外現貨` when present);
- IP / character / type / tone chips follow underneath;
- warning chips follow underneath;
- less-common metadata remains available without taking over the title row.

No tag/status calculation changes.

### Price row

The collapsed price section remains unboxed and uses one horizontal information line:

- 售價 + price;
- compare-at strike when present;
- profit + percentage when present.

Typography is reduced for secondary price data rather than stacking the whole block vertically.

### Card `×` semantics

The mobile top-right `×` reuses the existing `.rc-dismiss-btn` and existing `archiveOne()` function.

It means:

- **移出工作佇列 / soft archive**;
- existing busy-status safeguards still apply;
- existing undo toast / unarchive path remains;
- it is **not hard delete** and introduces no new endpoint.

### Long-press feedback

The owner reported that long-press works but has almost no tactile/visual feedback.

This pass changes presentation only:

- immediate subtle press scale/background while the finger is held;
- selected card gets a durable accent border/background after long-press succeeds.

Explicitly unchanged:

- `LONG_PRESS_MS = 500`;
- gesture movement threshold;
- left-swipe math;
- interactive-target guard;
- selectedIds behavior.

### Batch toolbar simplification

In copy-review, the `更多` menu contains exactly one action: `移出佇列`.

Decision:

- when `.batch-more-menu` has exactly one child, CSS promotes that action directly into the batch toolbar and hides the redundant `更多` summary;
- the existing `batchArchiveOrUnarchive("archive")` handler is reused.

In image-review the menu contains real additional actions (`生成詳情圖` on/off plus archive), so `更多` remains there. This prevents a UI simplification from accidentally removing useful functionality.

### Scope / sort controls

`只看我的` and `最新在上` become equal peer controls on mobile:

- two equal grid columns;
- same outer height (44px);
- no change to scope or sort state/persistence.

### Gesture hint

`長按卡片可多選；左滑可快捷` remains dismissible but uses the active theme accent so it is noticeable without becoming another large notice card.

### Swipe actions

Existing approve/regenerate (or station-equivalent) handlers remain. Presentation uses compact pill-like actions instead of tall slabs.

## Isolation strategy

To avoid growing an increasingly hard-to-reason-about override chain, this owner-corrected contract lives in a dedicated stylesheet:

- `src/app/resultcard-mobile-release.css`

`src/app/layout.tsx` imports it **after** `stabilization.css`.

This means:

- prior runtime-proven containment/uploader fixes remain untouched;
- this pass is easy to audit or remove independently;
- unrelated desktop/UI code is not restyled accidentally.

## Explicit C guard / non-changes

This pass must not modify:

- `ImageUploader.tsx` or upload pipeline;
- mobile uploader three-column geometry;
- thumbnail delete/spec/spinner/retry/drag behavior;
- VariantEditor / variant persistence;
- Supabase schema/data/RLS;
- Shopify publish code/config;
- review/approve/revision/publish APIs;
- archive endpoint semantics;
- roles/auth;
- long-press timing / swipe threshold / swipe math;
- desktop ResultCard quick actions.

## Runtime gate

Before final Release Candidate CI, verify on iPhone:

1. no horizontal protrusion returns;
2. top row reads title → station → date, with small `×` at right;
3. `×` removes from queue and undo still works;
4. image is left, `海外現貨` / tags / warnings are right;
5. collapsed price/compare/profit reads on one line and remains inside card;
6. long-press has visible press feedback and clearly enters selection mode;
7. copy-review multi-select shows `移出佇列` directly without a pointless one-item `更多`;
8. image-review still keeps its multi-action `更多` menu;
9. `只看我的` and sort controls are equal size;
10. gesture hint uses theme accent;
11. left-swipe actions still execute existing handlers;
12. uploader remains three columns.

If these pass, stop ResultCard presentation work and proceed to final CI + production/Shopify preflight.
