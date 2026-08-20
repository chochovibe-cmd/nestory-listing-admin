# ResultCard UIUX Batch D3.4A — Mobile Variant UI / Interaction Foundation

Date: 2026-08-21
Base: `1a2800fabeae375ca535f28dc02333ca23923451`
Branch: `agent/release-thumbnail-regression-fix`
PR: #8

## Scope

D3.4A changes mobile presentation and interaction only. It does not change pricing formulae, product-cost inheritance, price locking, inventory semantics, Shopify/Showmore payloads, Supabase schema, auth, APIs, or migrations.

## Result-list mobile controls

- Select-all keeps the existing checkbox/toggle selection semantics, but `全選` is now inside the visual switch body instead of living in an outer boxed control.
- Select-all, scope, and sort keep the same 38px density on the mobile control row.
- The gesture helper is real DOM again: `長按多選；左滑可核准、重生或移出佇列`.
- Its × calls only the existing `dismissGestureHint()` state/localStorage path.
- The D3.2 `::after` generated helper was removed.

## Mobile dimension builder

- Dimensions use a flat Tag-editor-like hierarchy: small dimension heading, wrapping compact value chips, and a dashed `＋` add chip.
- `＋ 新增維度` lives at the top of the builder and opens a portal-backed bottom sheet.
- The same bottom-sheet pattern is used to add a dimension value.
- Existing axis planning, destructive confirmation, duplicate protection, and row generation semantics remain the source of truth.
- Builder collapse still uses controlled `open` / `onToggle`, and only contains dimension/value controls. Variant results remain rendered outside `</details>`.

## Mobile Variant rows

- A variant is one compact horizontal row with per-row horizontal scrolling.
- Sequence is a real compact badge derived from rendered index.
- Option values are readonly in normal mobile state; the pencil opens a portal-backed edit sheet.
- Copy is an icon-only overlapping-squares control with `aria-label="複製規格"` and still calls `duplicateRow()`.
- Delete is an icon-only trash control and still calls `removeRow()`.
- Existing cost, price, inventory, image picker, and manual-price controls keep their current meaning.

## Touch reorder

Mobile reorder uses Pointer Events only from the six-dot handle:

- pointer capture is set on pointer down without immediately preventing scroll;
- activation threshold is 8px;
- horizontal-dominant motion cancels reorder and releases capture so the row can keep horizontal scrolling;
- vertical-dominant motion activates reorder;
- the whole row is translated during drag;
- `document.elementFromPoint()` resolves the row under the pointer;
- drop calls the existing row reorder helper, which rewrites `sortOrder` to rendered order;
- desktop keeps the existing HTML5 `draggable={!isNarrow}` behavior.

## ResultCard price baseline

The mobile `rc-price-mini` row now bottom-aligns its peers. The larger sale-price line-height is tightened so the extra height grows upward rather than extending the row downward.

## Verifiers

- D3.3 verifier retains still-valid D3.3 contracts, but drops the superseded mobile ▲/▼ fallback, hidden mobile drag, and delete-X assertions.
- New `verify-resultcard-uiux-d34a.mjs` asserts integrated select-all, real dismissible helper DOM, Tag-style builder hooks, modal add/edit flows, builder/results separation, Pointer Events reorder safety, sequence badge, readonly/pencil option flow, copy/trash icons, price baseline, and pricing/inventory non-expansion guards.
- D3.4A verifier is included in `scripts/verify-all.mjs`.
