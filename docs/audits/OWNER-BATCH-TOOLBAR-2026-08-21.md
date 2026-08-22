# Owner batch-toolbar alignment — 2026-08-21

Owner runtime QA finalizes the mobile multi-select action hierarchy for the current PR #8 corrective branch.

- Copy review: one row — `取消 | 批次核准 | 移出佇列`, three equal widths.
- Image review: row 1 — `取消 | 批次標圖通過 | 移出佇列`, three equal widths; row 2 — `開啟詳情圖 | 關閉詳情圖`, two equal widths across the full toolbar.
- Ready: existing two-action toolbar keeps equal geometry.
- Fail filter: expose `取消 | 移出佇列` on mobile multi-select. The remove action reuses the existing `/api/drafts/batch/archive` soft-archive contract and undo window; no new batch-regenerate handler is introduced.
- Shared mobile button geometry: 44px height, `var(--radius-s)`, common padding/font rhythm; semantic colors stay on existing button classes.

Scope guard: no long-press timing, swipe math, station routing, copy/image review handlers, Shopify, Supabase schema, auth/roles, Variant, pricing, or image-pipeline changes.
