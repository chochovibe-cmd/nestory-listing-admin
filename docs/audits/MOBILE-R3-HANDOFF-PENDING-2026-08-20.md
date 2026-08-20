# Mobile ResultCard R3 — Pending Handoff (2026-08-20)

## Purpose

This file exists because the conversation is being restarted. It records the exact mobile ResultCard state so the next AI session does not mistake planned R3 work for completed code.

## Hard owner rule

> Do not change unrelated C while fixing requested A/B. Confirm scope first, then edit. Every change must be recorded.

Do not touch ImageUploader, Variant, Supabase, Shopify, auth/roles, publish/review APIs, swipe math, or long-press timing while finishing this mobile ResultCard pass unless a separate verified issue is found.

## Production / branch truth

- Production app baseline branch: `codex/nestory-v0.1-safety-skeleton`
- Production app baseline commit: `6ff020dd1d68152b6688c9695f8f96188b7862be`
- Current release branch: `agent/release-thumbnail-regression-fix`
- The 2026-08-20 mobile ResultCard/ImageUploader work is NOT merged to production.

## Confirmed completed mobile fixes

### ImageUploader
Owner runtime accepted the current direction:
- mobile uploader is 3 equal square columns;
- mobile delete X is larger and on the top-right;
- recovered wrap/thumbnail geometry is preserved;
- spinner, retry, paste, drag/reorder, soft-remove, dual-size upload and spec marking remain.

Do not reopen uploader work during ResultCard R3.

### Results containment
Owner runtime confirmed ResultCard/results no longer protrude horizontally outside the mobile viewport.
Do not reopen width containment unless a new regression is reproduced.

## Current visible ResultCard state before R3

Latest Preview before the unfinished R3 structural patch still has these owner-rejected details:
- station chip/date are visually pinned beside the title rather than naturally following the end of the title text;
- card X is inside the top-right content area rather than straddling the top border;
- price / compare-at / profit still do not read as one clean peer row strongly enough;
- batch copy-review still may expose a redundant `更多` layer instead of direct `移出佇列`;
- selected/batch toolbar hierarchy still needs owner-requested tightening.

## Latest owner-confirmed R3 requirements — NOT YET IMPLEMENTED

### 1. Scope/sort controls
- `只看我的` and `最新在上` must remain equal width.
- Use the shorter control height the owner preferred: ~38px, not the taller recent version.

### 2. Results header
- `生成結果（三站工作佇列）` and compact `逐件審核/逐件標圖` should share one header row where space permits.
- `逐件審核` button should be smaller/compact.
- `全選` remains available but compact.

### 3. ResultCard top flow
Required natural visual order:
1. product title text;
2. immediately after the title text, station chip (e.g. `文案待審核`);
3. immediately after station chip, date;
4. wrap naturally only when horizontal space runs out.

Important: station/date must NOT be positioned as a separate right-side column beside the title's first line.

### 4. Card X
- Reuse the existing `.rc-dismiss-btn` / `archiveOne()` soft archive path.
- Place the X so it visually straddles the card's top-right border line.
- It is soft remove from queue with existing undo/unarchive semantics, NOT hard delete.

### 5. Summary row
- image left;
- right side: `海外現貨` + IP/character/type/tone tags + warnings;
- image/right metadata should feel balanced;
- approximate mobile image anchor planned around 94px (88px on narrow <=420px), but runtime visual balance is the real acceptance criterion.

### 6. Price row
- sale price, compare-at strike, profit, and profit percentage should read as one horizontal peer row;
- no nested card/big border;
- do not show a collapsed-card `重生` button; regenerate remains in swipe action.

### 7. Long-press / selection
- keep `LONG_PRESS_MS = 500`;
- keep gesture threshold/swipe math untouched;
- visible press feedback and selected-card accent should remain.

### 8. Batch toolbar
When selected in copy-review:
- count stays visible;
- `取消`, `批次核准`, `移出佇列` should be direct peer actions in one compact row;
- do NOT hide the only remove action inside a one-item `更多` menu.

Image-review is different:
- its `更多` contains real extra functions (detail-image generation on/off + archive), so KEEP `更多` there.

### 9. Gesture hint / swipe
- keep the text hint `長按卡片可多選；左滑可快捷`;
- make it lightweight but theme-accent noticeable;
- swipe approve/regenerate actions may be visually polished, but existing handlers/thresholds must not change.

## Why the patch is still pending

The branch currently contains temporary workflow scaffolding:
- `.github/workflows/mobile-resultcard-r3.yml`
- `.github/workflows/mobile-resultcard-structural-patch-temp.yml`

These files describe a reviewed structural R3 patch but are NOT the finished product.

Critical evidence that R3 has not landed:
- `docs/audits/RESULTCARD-MOBILE-OWNER-CORRECTION-R3-2026-08-20.md` does not exist yet;
- therefore the structural patch that should create it has not completed.

Do not treat temporary workflow presence as completed implementation.

## Next session — exact recommended start

1. Read `AI_START_HERE.md`.
2. Read `docs/CURRENT_STATUS.md`.
3. Read this handoff file.
4. Inspect current HEAD and temporary workflow scaffolding before editing.
5. Implement R3 with the minimum necessary DOM/CSS changes:
   - likely `ResultCard.tsx` only for true title -> station -> date natural flow;
   - likely `DraftResultsPanel.tsx` only to expose direct copy-review `移出佇列` and compact header/batch classes;
   - `resultcard-mobile-release.css` for presentation.
6. Do NOT change business/API/gesture semantics.
7. Remove temporary patch workflows from the final clean branch once their purpose is finished; do not leave trigger scaffolding in production release history.
8. Update verifier + `CURRENT_STATUS` + CHANGELOG/audit.
9. Produce one Preview and validate on iPhone.
10. Only after owner accepts mobile UI: run final CI, then Shopify production preflight.

## Release health items already discovered (separate scope)

Do not mix these into the R3 mobile UI patch:
- Production Shopify live mode must be intentionally verified (`SHOPIFY_PUBLISH_MOCK=false` plus credentials; secret values are not readable through current connector).
- P0 Shopify risk: partial `productCreate` success followed by variant/price/inventory failure may allow a later retry to create a duplicate product because idempotent resume/guard is not visibly implemented.
- Finite inventory should explicitly verify `SHOPIFY_LOCATION_ID` for multi-location shops.
- Repo lacks browser E2E (Playwright/Cypress); add later, not as a blocker to finishing R3.

## Final owner acceptance gate for R3

On iPhone verify:
- no horizontal overflow;
- shorter equal scope/sort boxes;
- compact results header + sequential review;
- title -> station -> date natural inline wrap;
- X straddles top-right border and soft-remove undo works;
- image/right metadata balanced;
- price/compare/profit genuinely read as one row;
- long-press feedback and selection obvious;
- copy-review directly shows `移出佇列`;
- image-review still keeps its real multi-action More menu;
- swipe/tap/long-press functions unchanged;
- uploader still 3 columns.
