# Pre-Shopify UI Final Audit — D3.5 — 2026-08-21

## Scope

Final ResultCard / Variant UI corrective polish before the separate controlled Shopify go-live package.
This package is presentation-only except for the minimum mobile Variant modal wiring needed to move an existing character picker into the existing portal modal system. No Shopify production write is performed here.

## Start guard

- Repo: `chochovibe-cmd/nestory-listing-admin`
- Branch: `agent/release-thumbnail-regression-fix`
- Existing PR: #8
- Required parent / verified remote HEAD: `3ef8ab0e942aaffba5b9ca0af39ac38897d42b25`
- Commit message: `fix: finalize pre-Shopify responsive UI polish`
- Final HEAD: the single D3.5 commit containing this audit. A commit cannot embed its own immutable SHA without changing that SHA; use PR #8 final head / Commander final report as the authority.

## Changed files

- `src/components/listing/VariantEditor.tsx`
- `src/components/listing/VariantEditorRender.tsx`
- `src/app/d34b-iphone-corrective.css`
- `scripts/verify-resultcard-uiux-d3.mjs`
- `scripts/verify-resultcard-uiux-d34b.mjs`
- `scripts/verify-resultcard-uiux-d35.mjs`
- `scripts/verify-all.mjs`
- `docs/CURRENT_STATUS.md`
- `docs/audits/PRE-SHOPIFY-UI-FINAL-2026-08-21.md`

No `ResultCard.tsx`, Shopify route/client, Supabase migration/schema, auth, pricing helper, API route, uploader, or production branch file is changed.

## Desktop corrections

### Select-all

- Existing semantic `<input type="checkbox">` remains the control.
- `toggleAll`, `checked`, `indeterminate`, and aria label are untouched.
- Final cascade hides the historical `rc-toggle-track` presentation and exposes the native checkbox + `全選` label.
- Desktop select-all is removed from the filter row's visual flow and positioned against the results panel header; when `rc-header-seq-btn` exists it sits immediately before the sequential review/marking action.
- Positioning is relative to `.results-panel`, not the filter row, so a temporary generation-progress card cannot move the review group.

### Filters / scope / sort

- At `>=960px`, StageFilterPills, scope, and sort use a single nowrap flex row.
- Scope/sort stay a compact end group.
- This is desktop-only; the accepted mobile control hierarchy remains separate.

### Login

- At `>=960px`, `.login-panel` uses a comfortable `max-width: 640px` with centered form proportions.
- Mobile keeps the compact existing form.
- `supabase.auth.signInWithPassword`, redirect/session/role behavior are unchanged.

## Mobile corrections

### Select-all

- The mobile toolbar keeps the current hierarchy but now visibly presents a real checkbox instead of switch/knob chrome.
- The legacy duplicate mobile select-all remains hidden exactly as before; the reused toolbar checkbox keeps the same selection semantics.

### Character picker modal

- The mobile `依角色建立` action opens `EditorModal { kind: "character" }` through the existing `createPortal`, `variant-editor-modal-backdrop`, and `variant-editor-modal` system.
- Search, loading, multi-select, selected state, `ip_characters` Supabase query, and `appendCharacterRows` are preserved.
- Desktop retains the existing inline role picker; desktop Variant IA is not redesigned.

### Action toolbar

Mobile primary actions are now one group outside the collapsible builder:

1. `＋新增維度`
2. `依角色建立`
3. `批次手動覆蓋價格`

The batch action remains disabled until Variant rows are selected and retains the selected count. The old mobile-only `＋ 新增 Variant` entry is removed from rendering only. `addRow` and the existing `add-variant` modal capability remain in source.

### Variant card polish

- Touch drag target remains 44px, but the visible glyph/chrome is smaller.
- Copy action becomes ghost/icon chrome while retaining its aria label and duplicate-next behavior.
- Row number badge shrinks to 22px.
- Readonly spec values are typography-only and clamp to at most two lines with normal Chinese breaking.
- Readonly price/compare-at presentation loses the input-like border/background.
- Editable cost remains a real numeric input at the established 88px width.
- Mobile-only grid establishes fixed scan order and alignment: spec → price → cost → inventory.
- Width is bounded to the card; 390/393/375px remain three-action layouts, while `<360px` can gracefully wrap the top action toolbar.
- Desktop Variant result path remains the existing `vgrid-hdr` / native draggable/input grid.

## Business logic hard guard

Untouched:

- Shopify publish / unpublish implementation and GraphQL payloads
- Shopify credentials, token lifecycle, store configuration
- Showmore CSV semantics
- Supabase schema / migration / RLS
- auth / role / session semantics
- archive semantics and Station routing
- draft status semantics
- pricing formula / multipliers / minimums
- price lock semantics
- inherited cost semantics
- Variant storage format
- API routes
- ResultCard swipe math
- ResultCard / Variant long-press timing
- touch reorder threshold (`TOUCH_DRAG_PX=8`) and row long press (`ROW_LONG_PRESS_MS=500`)
- image storage / finalize

Batch cost still uses the existing `recalculateUnlockedVariantPrices`; selected locked rows preserve existing manual-price behavior through the existing helpers.

## Verifier corrective

- D3.4B verifier no longer requires switch/knob presentation or the removed mobile `＋新增 Variant` peer action.
- D3 verifier now recognizes the D3.5 checkbox supersession instead of enforcing the historical switch track.
- New `scripts/verify-resultcard-uiux-d35.mjs` verifies:
  - native checkbox presentation + indeterminate semantics
  - desktop filter/scope/sort row
  - desktop select-all review-group placement contract
  - responsive desktop login width
  - mobile character portal modal
  - mobile three-action toolbar
  - absence of the mobile-only `＋新增 Variant` render entry while core add capability remains
  - touch/pricing guards
  - compact/de-framed mobile Variant geometry
  - desktop Variant result path freeze
- `scripts/verify-all.mjs` includes D3.5.

## Verification / runtime authority

The ChatGPT Work execution environment for this task does not have a usable local repository checkout / dependency runtime, so local `git diff --check`, direct Node verifier execution, `pnpm run typecheck`, and `pnpm run build` must not be reported as locally executed when they were not. The final GitHub Actions run for the exact final HEAD is the remote authority for `verify:all → typecheck → build`.

GitHub CI and Vercel Preview are post-push properties and therefore cannot be truthfully embedded as final results inside the same immutable one-commit audit. Their exact run/deployment conclusions are reported by Commander final report against the final HEAD.

## Stop point

D3.5 freezes ResultCard / Variant UI. Do not create, publish, unpublish, or mutate Shopify products from this package. Do not change Shopify tokens or store configuration. Wait for the separate Commander-controlled Shopify go-live instruction.
