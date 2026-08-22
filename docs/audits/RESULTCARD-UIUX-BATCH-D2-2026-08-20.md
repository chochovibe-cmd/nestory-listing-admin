# ResultCard UIUX Batch D2 — 2026-08-20

## Scope

Presentation-only continuation of PR #8. No Shopify, Showmore, Supabase,
auth/role flow, API business logic, archive semantics, long-press timing,
swipe math, or Variant storage meaning changed.

## Implemented

- Mobile controls now read as tabs → scope/sort → select-all → selected batch
  actions. The gesture hint is independent from select-all.
- Desktop select-all sits beside sort, with a restrained checkbox focus style;
  scope/sort and sequential-review controls use compact peer sizing.
- Mobile card X is hidden. The existing left-swipe actions and underlying soft
  archive/undo implementation are unchanged.
- Image mark statistics have their own card summary row below the thumbnail
  summary, rather than sharing the chip cluster.
- Cards show the number of filled variant rows. Price display continues to use
  the existing front-end price collector: one price when equal, min ～ max when
  variant prices differ.
- Revision/status chips share the same compact mobile height and padding.
- Variant dimension/value areas have larger targets, clearer grouping, a named
  More control, and separated variant-row cards for long lists.
- Normal axis edits auto-expand. The old always-visible `重新展開` button was
  removed; an explicit button appears only for the existing destructive
  confirmation case where hand-entered rows would be lost.
- Login keeps the global top bar plus a single login form card; duplicate brand
  and mock-environment explanatory content were removed without changing auth.

## Verification

- `git diff --check`
- ResultCard owner/mobile/gesture/expand regression source verifiers
- `pnpm run verify:all`, `pnpm run typecheck`, and `pnpm run build` are required;
  this Work checkout could not install dependencies because registry access was
  unavailable. GitHub CI is the final remote authority.

