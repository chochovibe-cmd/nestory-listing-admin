# ResultCard UIUX Batch D3 — 2026-08-20

## Scope

Presentation-only continuation of PR #8. No Shopify, Showmore, Supabase,
auth/role flow, API business logic, pricing/storage meaning, archive semantics,
or Variant data meaning changed.

## Implemented

- Result controls: desktop toggle-style select-all precedes station tabs; mobile
  select-all and gesture hint share one aligned group. Sort focus/glow styling
  is neutralized and image-review batch actions use equal control sizing.
- Cards: variant count follows the sale-status chip, image-review cards omit
  price, and all metadata/tag/warning clusters use bounded wrap and gap rules.
- Mobile remove: retained the existing single-direction left-swipe reveal and
  added the existing soft-archive action to every active station. Copy/image
  reveal three actions; ready reveal two. Hint now explicitly says left swipe
  reveals “移出佇列”.
- Specs: dimension creation is collapsible, the add-dimension popover is
  anchored to its trigger, More is removed, and apply-cost / create-by-character
  are direct actions. Mobile rows use a visible handle plus existing reorder
  controls and a flatter, tighter visual hierarchy.
- Login shell: a pathname-aware presentation wrapper suppresses AppSidebar and
  MobileTabbar only on /login; successful login continues to redirect into the
  normal shell. Auth flow is unchanged.

## Verification

- Added `scripts/verify-resultcard-uiux-d3.mjs` to `verify:all`.
- Required final authority: GitHub CI `verify:all`, typecheck and build.
