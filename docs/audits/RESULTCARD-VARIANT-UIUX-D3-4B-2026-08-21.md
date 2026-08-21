# ResultCard / Variant UIUX D3.4B — Owner Corrective Pass 2

Date: 2026-08-21
Repo: `chochovibe-cmd/nestory-listing-admin`
Branch: `agent/release-thumbnail-regression-fix`
PR: #8 (Draft / Open; do not merge)

## Commit boundary

- Start commit: `3b270b368ac5362e5cfc0048791942fd2f08798a`
- Start state: revert commit whose source/content matches D3.3 completion `1a2800fabeae375ca535f28dc02333ca23923451`
- End commit: **this D3.4B single final commit**. Because the package has a strict `ONE FINAL COMMIT` rule, a commit cannot embed its own SHA before that SHA exists; the canonical end SHA is PR #8 HEAD after the one fast-forward push and is reported by Commander handoff / GitHub.

D3.4A / D3.4A.1 (`8fea52cd…`, `f20ef237…`) were owner-rejected and reverted by `3b270b3…`; their implementation was not used as the design baseline for D3.4B.

## Scope boundary

- C — dimension/spec-value definition editor: **mobile + desktop**.
- D/E — variant result rows and variant batch actions: **mobile only**. Desktop variant result rows retain the pre-D3.4B render path and layout.
- F — ResultCard collapsed price-row bottom alignment: **mobile + desktop**.
- No Shopify / Showmore / Supabase schema / auth / login / archive semantics / publish workflow / pricing-formula changes.

## A–F completion status

### A. Select-all control — complete

- Mobile control order remains `[全選] [只看我的] [排序]` with the existing compact 38px geometry.
- The select-all wrapper no longer owns an outer card/frame.
- The visible `全選` copy is rendered inside the toggle track itself; selection input/semantics are unchanged.
- This explicitly supersedes D3.3's owner-rejected outer-frame treatment.

### B. Gesture hint + close X — complete

- Hint now communicates: long-press enters multi-select; left swipe exposes approve/resend; right-swipe wording identifies remove per owner copy request.
- The existing real dismiss `X` is restored visually.
- Dismiss still only calls the existing hint visibility/localStorage path. No ResultCard action/data/API is touched.
- Note: this package did not alter ResultCard swipe mathematics or archive semantics; B is the requested hint-row presentation/copy change only.

### C. Dimension / spec-value definition editor — complete (mobile + desktop)

- Rebuilt the dimension-definition area around the existing ResultCard Tag visual vocabulary (`rc-tag`, `rc-tag-remove`, `rc-tag add`).
- Removed the frame-in-frame dimension/value presentation.
- `新增維度` opens one shared modal: common `尺寸` / `顏色` shortcuts or a custom name.
- Each dimension renders a small field-style title, wrap-capable value chips, direct chip `×`, and dashed `＋ 新增值` chip.
- `＋ 新增值` reveals an input only after activation through the shared modal; no large permanent value input remains.
- Multiple dimensions are separated by a divider instead of nested boxes.
- Mobile uses the same behavior as desktop, with the shared modal presented as a bottom sheet on narrow screens.

### D. Mobile variant result rows — complete in source; physical-device touch QA still required

Mobile uses a dedicated render path; desktop result rows are not restyled/restructured.

Final mobile source order:

1. six-dot drag handle
2. icon-only duplicate button
3. compact row-number badge
4. thumbnail
5. readonly full option name(s) + accent edit pencil
6. readonly sell/compare result + accent edit pencil
7. narrow cost input
8. `庫存視為無限` toggle + conditional quantity input
9. trash delete button at far right

Details:

- Dimension values auto-expand rows during ordinary safe axis changes. Only the pre-existing destructive-change confirmation remains when hand-entered rows would be discarded; no normal “expand results” helper row is required.
- Touch reorder uses Pointer Events (`setPointerCapture` → pointer move → `elementFromPoint` row targeting → pointer up reorder) rather than exposing a fake HTML5 mobile drag handle. After reorder, `sortOrder` is normalized to `0..n-1`, so visible badges remain `1..n`.
- Physical iPhone verification cannot be performed in the source-only Work runtime; GitHub/Vercel checks are the final remote gate and owner iPhone QA remains the runtime authority.
- Option names are readonly in the normal row and allow wrapping; edit is modal-only. Renaming a defined axis value updates the dimension chip and every row using that same axis value.
- Sell/compare are readonly, accent-emphasized and placed before cost. Pencil editing uses the existing `priceLocked` semantics.
- Cost width is narrowed for compact numeric entry.
- `已手動覆蓋` is shown when the row's actual positive cost differs from positive product-level cost. This intentionally does not depend only on `costIsInherited`, because that flag is UI-only and is not persisted.
- New-row inventory remains unlimited by default (blank quantity); disabling unlimited reveals numeric quantity.
- Duplicate still deep-copies the row and inserts directly after the source row. Existing duplicate protection is not bypassed; an exact duplicate must be changed before save.
- **D3.3's mobile `×` presentation is explicitly reverted back to the underlying trash icon `🗑`.**

### E. Mobile variant batch actions — complete

- `批次手動覆蓋價格` and `＋ 新增 Variant` are fixed peers in one mobile row, outside the dimension builder's collapse state.
- Both open modal interactions rather than expanding an in-flow block.
- Long-press (500ms) on a non-interactive part of a mobile variant row starts selection; once selection exists, tapping other non-interactive row areas toggles selection.
- Batch cost modal accepts one cost and displays live readonly sell/compare values from the existing `calculatePrice` formula.
- Confirm applies cost only to selected rows. For every selected row, the new cost **overwrites the previous cost regardless of whether it was blank, inherited from product cost, or already manually filled**; unselected rows are untouched. Selected rows are marked non-inherited in form state and then passed through existing `recalculateUnlockedVariantPrices`. That existing helper recalculates sell price and compare-at price for unlocked rows with the current pricing formula, while `priceLocked` rows are returned unchanged so their already-manually-locked sell/compare values remain exactly as before. No pricing formula, schema, or persistence contract is changed.
- Desktop retains the pre-existing blank-only `套用成本` behavior.

### F. ResultCard price-row alignment — complete (mobile + desktop)

- Price label, large sell value, compare-at and profit peers align to the same bottom edge.
- Larger price text grows upward via bottom alignment / line-height treatment instead of increasing the row below its baseline.
- No price data or formula changes.

## H. Existing cost / override investigation

### H-27a — Does a new variant inherit product cost?

**Yes.** `addRow()` creates `emptyVariantRow(..., productCost)` and then runs the existing inherited-cost synchronization. New rows therefore receive a positive product-level cost when available; otherwise cost remains blank.

### H-27b — What did the old `套用成本` action actually do?

It calls `applyProductCostToBlankRows`. The helper only fills blank / non-positive variant costs from the product cost, never overwrites an already-positive row cost, and then recalculates unlocked prices with the existing formula.

### H-27c — Is there already a per-variant cost override field?

There is already a per-row persisted actual cost (`cny_price` / row `cost`) and a form-only `costIsInherited` marker. `costIsInherited` is explicitly UI-only and is not persisted as a dedicated database override column. Manual cost edits already set it false in the form and recalculate unlocked prices.

### H final decision

**Full D3.4B batch-override implementation was safe without schema/formula rewrites.** The existing model is close to the owner description: rows carry their own cost, new rows inherit product cost, and manual cost edits already detach from inheritance in form state. D3.4B adds the requested selected-row batch layer and derives the visible override chip from actual row cost vs product cost, so no new persistent override flag is required.

Pricing formula code (`rate`, cost multiplier, margin multiplier, compare-at multiplier, min-price / beautification) was not modified.

## Verifier updates

- D3 / D3.3 source-contract verifiers were updated only where D3.4B explicitly supersedes their stale assertions (in-flow dimension add, mobile ▲/▼ fallback, mobile `×` delete glyph).
- Added `scripts/verify-resultcard-uiux-d34b.mjs` and wired it into `scripts/verify-all.mjs`.
- D3.4B verifier checks select-all integration, hint X/copy, Tag-chip editor, modal flows, Pointer Events drag, copy-next insertion, readonly option/price ordering, unlimited inventory toggle, trash icon, batch override helper usage, desktop/mobile render separation, and cross-platform ResultCard price alignment.

## Validation state before final push

Work/container had no usable repository checkout/dependency install path, so dependency-backed `pnpm typecheck` / `pnpm build` could not be truthfully completed locally. The generated TypeScript was parsed with the available TypeScript compiler; the only local diagnostics were expected unresolved module imports caused by the absent project dependency tree. Generated files pass whitespace checks (`git diff --no-index --check`) and verifier `.mjs` files pass `node --check`.

Per package instructions, GitHub CI after the one final push is the dependency-based final authority. If CI fails, stop and report; no second corrective push is permitted.

## Desktop D3.5 observations — suggestions only, no code changes

1. Desktop result rows could benefit from a more compact separation between option identity and editable commercial fields; current grid density makes thumbnail / option / cost / action hierarchy visually flat.
2. Sell/compare could later become a first-class readonly calculated block on desktop too, matching the mobile D3.4B emphasis while preserving desktop scanning density.
3. Desktop inventory could adopt the same explicit unlimited-vs-finite semantic control in a future package, but this D3.4B package intentionally leaves desktop result-row behavior unchanged.

## Transport-only mechanical file split

`VariantEditor.tsx` was mechanically split into **2 source files**: `VariantEditor.tsx` and `VariantEditorRender.tsx`. The reason is that this specific ChatGPT → GitHub connector execution path begins truncating a single tool-call string payload at roughly 32K characters. This is **not a GitHub Git Blob API limit** (GitHub documents blob support far above this size) and it is **not a design choice / architecture refactor**.

The split is intentionally render-only: all hooks, state, handlers, pricing calls, duplicate behavior, inventory behavior, long-press selection, Pointer Events touch-drag, and persistence-facing logic remain in `VariantEditor.tsx`. `VariantEditorRender.tsx` only contains ordinary render functions for the image picker, editor modal, zoom portal, and mobile/desktop results JSX; no new React component lifecycle boundary was introduced.

Mechanical-equivalence evidence before any commit/push:

- moved image-picker / modal / zoom / results JSX compares byte-for-byte after removing only the render-function wrapper and the added `ctx` argument on the local image-picker call;
- all non-render runtime logic remaining in `VariantEditor.tsx` compares byte-for-byte with the unsplit D3.4B candidate after excluding those four moved render regions and transport-only imports/context plumbing;
- both split TSX files parse with 0 TypeScript syntax diagnostics;
- D3.3 / D3.4B verifier adaptation is limited to aggregating `VariantEditor.tsx + VariantEditorRender.tsx` as the inspected source; assertion bodies/counts are not changed by the split.

## Known limitations / runtime follow-up

- No physical iPhone was attached to the Work runtime, so Pointer Events touch reorder requires owner runtime confirmation on the Vercel Preview even though the implementation is a real pointer-capture reorder path rather than a visual-only handle.
- B changes hint-row copy/presentation only; ResultCard swipe math/semantics were scope-guarded and not modified.
- The dedicated persistent concept is actual per-row cost; there is no database `cost_override=true` column. Override UI is therefore derived from row cost vs current product cost.

### Final-commit five-point owner guard

1. Mobile cost input is intentionally narrow: `88px` fixed width, approximately a five-digit numeric field plus padding.
2. Mobile duplicate is an overlapping double-square icon (`v-row-dup--icon` + `v-copy-icon`), not a text `複製` button; `duplicateRow` deep-copies the row and inserts it at `index + 1`. Existing downstream duplicate-combination validation remains authoritative.
3. The mobile gesture hint visibly renders: `長按卡片進入多選；向左滑可核准／重送，向右滑可移除。` The existing X only dismisses the hint row.
4. `批次手動覆蓋價格` and `＋ 新增 Variant` are fixed peers outside the collapsible dimension builder. Both open the shared modal/bottom-sheet path; neither expands an inline editor below the button.
5. Batch cost overwrite semantics are explicit: selected rows always receive the new cost whether prior cost was blank/inherited/manual; unselected rows are untouched. Existing `recalculateUnlockedVariantPrices` recalculates sell/compare for unlocked rows and returns `priceLocked` rows unchanged, preserving their manually locked sell/compare values.

## One-time force rewrite incident — accidental noop correction

During the final branch-ref step on 2026-08-21, the execution agent mistakenly invoked the GitHub contents write path instead of the intended ref update. That accidental write created commit `ee6a96d3c61448ad3c226b397727cfa9dea8b360` with commit message `noop` and a single stray file, `__DO_NOT_USE__`. This was an operator/tool-routing mistake, not part of D3.4B product work and not an intentional history change.

Before any history rewrite, the branch and PR were checked for visible downstream dependence on `ee6a96d3c61448ad3c226b397727cfa9dea8b360`. PR #8 remained Draft/Open/unmerged, with no submitted reviews or review threads. GitHub Actions CI run #226 and Supabase Local Reconcile run #50 had already completed successfully for the accidental commit and produced no workflow artifacts. Vercel had produced a Ready preview/status for that accidental head. No GitHub-visible follow-up commit, human review, or artifact dependency was found. A collaborator's private/local `git fetch` cannot be observed from GitHub and therefore cannot be proven absent server-side.

The owner then explicitly authorized exactly one exception to the standing no-force-push rule: rewrite `agent/release-thumbnail-regression-fix` once to remove the accidental `ee6a96d…` history and restore the single validated D3.4B commit based directly on `3b270b368ac5362e5cfc0048791942fd2f08798a`. This exception exists only to correct the accidental noop commit described above. Once that one ref rewrite is completed, the repository rule **forbidding force pushes immediately resumes**; this incident does not authorize any second force push or later history rewrite.

Because Git commit objects are immutable, documenting this incident inside the committed audit necessarily changes the final D3.4B commit SHA from the earlier pre-incident candidate `4277fea8b7c5a3785d5dceea234cfbca25e2e341`. The product tree is otherwise unchanged except for this audit paragraph; the intended visible branch history remains exactly one D3.4B commit ahead of `3b270b368ac5362e5cfc0048791942fd2f08798a`.


### Second accidental write and ref-write isolation protocol

A second accidental write occurred at the same final ref-update step before any force push was actually executed. While preparing to move the branch from `ee6a96d3c61448ad3c226b397727cfa9dea8b360` to the amended D3.4B candidate, the execution agent again selected the GitHub contents update action instead of the ref-update action. This created commit `cbc4da29180b323a6af68b6cf6deab4f4999a7d5`, again with the empty stray file `__DO_NOT_USE__`. No `GitHub.update_ref` call had been sent, so the owner's one-time force-push exception was still unconsumed.

Because the same mistake happened twice at the same operation boundary, it was no longer treated as an isolated slip. The observed failure mode points to structural risk in the GPT-to-GitHub tool-selection/routing layer for this specific write step: read/discovery calls re-expose multiple GitHub write actions with similar placement, and the final action selection twice resolved to `update_file` rather than `update_ref`. The evidence does **not** indicate a GitHub Git Data API defect, a bad target SHA, or a branch-history problem. This is recorded as a tool-environment action-selection risk.

To prevent a third repetition, the owner and execution agent established a ref-write isolation protocol:

1. All amended-candidate creation (blob/tree/commit objects) must finish **before** entering the ref-write phase.
2. Immediately before the ref-write phase, no further tool-discovery/list-resources calls are allowed.
3. Pre-write checks are read-only only: PR head/state and commit comparison (`ahead 1 / behind 0 / total commits 1`), plus any necessary read-only file/blob verification.
4. The only permitted write action in the isolation phase is **exactly** `GitHub.update_ref`. Its argument shape must contain only repository, branch, target commit SHA, and `force: true`. Any appearance of file-write fields such as `path`, `content`, file `sha`, or commit `message` is an immediate abort condition.
5. Before the write is sent, the complete intended `GitHub.update_ref` call name and arguments must be printed for the owner and execution must stop. The write may proceed only after the owner explicitly replies with a human confirmation such as `確認，可以送出`.
6. This authorization is still a **single** force-ref exception only. After that one successful ref rewrite, the standing prohibition on force push immediately resumes. No second force push is authorized by this incident.

The second accidental commit and this isolation protocol require another audit-only amendment, so the final D3.4B commit SHA changes again while the other ten validated D3.4B file blobs remain byte-for-byte identical to the prior candidate.
