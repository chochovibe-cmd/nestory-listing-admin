# D3.3 Mobile UIUX Corrective — Select / Chips / Variant Mobile Redesign

Date: 2026-08-20
Branch: `agent/release-thumbnail-regression-fix`
PR: #8 `Mobile ResultCard R3 final owner layout`
Starting head: `d350cecf0e0ac157cf763251f6d36caa792878cc`

## Scope

Owner-directed corrective presentation pass only. No Shopify, Showmore, Supabase,
auth/login, archive/swipe, publish/review workflow, pricing formula, variant storage,
ImageUploader, database schema, or API business behavior changed.

Desktop scope is intentionally limited to the ResultCard variant-count chip beside
the existing sale-status chip. All other D3.3 presentation work is mobile-only.

## Result controls and batch actions

- Mobile station tabs remain the first row.
- The next control row reuses the existing select-all input before scope and sort:
  `全選 -> 只看我的 -> 排序` (or `全選 -> 排序` when scope is unavailable).
- Select-all, scope and sort use the same 38px control geometry. Selection is
  emphasized with the existing theme accent, not a larger control.
- Batch peers use the same 40px height, radius, padding and box sizing. Primary
  actions remain stronger by color/weight only.

## ResultCard chips

ResultCard source already renders sale status before variant count. D3.3 gives
`rc-sale-badge` and `rc-variant-count` one shared 22px chip geometry and places
them as adjacent peers on mobile. Desktop keeps its existing card layout while
using the same chip density.

## Mobile Variant builder

- Each dimension is one flat section: dimension title, then a single nowrap value
  rail with touch horizontal scrolling.
- Value rails contain their own overflow; the page container stays bounded.
- The existing add-value, remove-value and destructive confirmation handlers are
  untouched.
- `新增規格類型` keeps the existing handler but is presented as a 44px trigger
  with an in-flow expansion immediately underneath. No floating/absolute mobile
  popover is introduced.
- `套用成本` business behavior is untouched.

## Mobile Variant results

The existing DOM is row-card based. A shared horizontal viewport would require a
structural rewrite of VariantEditor and would exceed this corrective scope, so D3.3
uses the owner-approved fallback: **per-row horizontal scrolling**.

Normal variant rows are flattened into one compact horizontal editable row. Existing
dimension cells remain dynamic, so a one-dimension product does not receive empty
second/third dimension columns. Each row exposes the existing image, option, cost,
price/edit and stock controls along one horizontal axis. Secondary inherited-cost
and manual-price information stays compact instead of creating a tall card.

The image picker remains usable: while it is open, that row temporarily clips the
horizontal data strip and allows vertical picker overflow instead of letting the
whole page overflow.

## Reorder / copy / delete safety

- Mobile native drag is **not** claimed as touch-capable. Existing source explicitly
  disables HTML drag on narrow viewports, so D3.3 hides the decorative drag glyph
  and preserves the reliable `▲ / ▼` row reorder controls. Those controls reorder
  the whole row and existing code recomputes `sortOrder`; the visible CSS row number
  follows actual rendered order.
- Existing `duplicateRow(index)` already deep-copies the source row and inserts at
  `index + 1`; D3.3 only repositions its Copy control. Duplicate/validation safety
  remains governed by existing variant logic.
- Existing delete handler is untouched. Mobile presentation replaces the trash
  emoji visually with a compact `×` while retaining the same accessible button and
  underlying `removeRow(index)` behavior.

## Verification

- New source verifier: `scripts/verify-resultcard-uiux-d33.mjs`
- Added to `scripts/verify-all.mjs`.
- Final authority after the single push remains GitHub CI: `verify:all`, typecheck,
  build, Supabase Local Reconcile, plus Vercel Preview status.
