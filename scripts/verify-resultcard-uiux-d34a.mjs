import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`D3.4A verifier: missing ${label}`);
  }
}

function forbidText(text, needle, label) {
  if (text.includes(needle)) {
    throw new Error(`D3.4A verifier: forbidden ${label}`);
  }
}

const d32 = read("src/app/d32-corrective.css");
const css = read("src/app/d33-mobile-uiux.css");
const panel = read("src/components/listing/DraftResultsPanel.tsx");
const variant = read("src/components/listing/VariantEditor.tsx");
const resultCard = read("src/components/listing/ResultCard.tsx");

if (css.includes("!important")) {
  throw new Error("D3.4A verifier: no new !important allowed");
}

// A/B — integrated select-all: one control surface, text inside the switch track.
requireText(panel, 'className="rc-toggle-track rc-toggle-track--labeled"', "integrated select-all switch track");
requireText(panel, 'className="rc-toggle-copy">全選</b>', "select-all text inside switch body");
requireText(panel, "onChange={toggleAll}", "select-all selection semantics");
requireText(css, ".stage-filter-row > .rc-header-select-all--desktop", "select-all mobile row selector");
const selectCssStart = css.indexOf(".stage-filter-row > .rc-header-select-all--desktop {");
const selectCssEnd = css.indexOf("}", selectCssStart);
const selectCss = css.slice(selectCssStart, selectCssEnd + 1);
requireText(selectCss, "border: 0;", "no outer select-all box border");
requireText(selectCss, "background: transparent;", "no outer select-all card background");
requireText(css, ".rc-toggle-track--labeled", "switch body owns visual control");

// C/D/E — helper is real DOM, dismissible, and dismissal only changes hint state/storage.
requireText(panel, "長按多選；左滑可核准、重生或移出佇列", "real DOM helper copy");
requireText(panel, 'className="rc-gesture-hint-dismiss"', "helper dismiss control");
requireText(panel, "onClick={dismissGestureHint}", "helper dismiss handler wiring");
requireText(panel, "window.localStorage.setItem(RC_GESTURE_HINT_KEY, \"1\")", "helper localStorage dismissal");
forbidText(d32, ".rc-selection-guide-row::after", "generated helper pseudo-content");
const dismissStart = panel.indexOf("function dismissGestureHint()");
const dismissEnd = panel.indexOf("// B12", dismissStart);
const dismissBody = panel.slice(dismissStart, dismissEnd);
if (!dismissBody.includes("setShowGestureHint(false)")) {
  throw new Error("D3.4A verifier: dismiss handler must close only the helper hint");
}
for (const forbidden of ["batchArchive", "archiveOne", "removeRow", "delete"]) {
  if (dismissBody.includes(forbidden)) {
    throw new Error(`D3.4A verifier: hint dismiss must not invoke ${forbidden}`);
  }
}

// F/G — Tag-editor density, compact chips, wrapping values.
requireText(variant, 'className="v-dim-chip vh-dim-type"', "dimension heading hook");
requireText(variant, 'className="v-axis-val"', "dimension value chips");
requireText(variant, 'className="v-axis-add-chip"', "dashed add-value chip hook");
requireText(css, "flex-flow: row wrap;", "dimension values wrap");
requireText(css, ".variant-box .v-axis-add-chip", "compact add-value presentation");
requireText(css, "border: 1px dashed var(--border-soft);", "dashed add affordance");

// H/I/J — mobile add value/dimension use portal sheets, not inline expanding panels.
requireText(variant, "const [axisValueModal, setAxisValueModal]", "add-value modal state");
requireText(variant, "function openAxisValueEditor", "add-value modal handler");
requireText(variant, 'className="v-mobile-sheet v-mobile-sheet--axis-value"', "add-value bottom sheet");
requireText(variant, "function openDimensionModal", "add-dimension modal handler");
requireText(variant, 'className="v-mobile-sheet v-mobile-sheet--dimension"', "add-dimension bottom sheet");
requireText(variant, "createPortal(", "portal-backed mobile sheets");
requireText(variant, 'className="vh-add-dim-ghost vh-add-dim-ghost--mobile"', "mobile add-dimension trigger at builder top");
if (css.includes(".vh-add-dim-wrap .v-pop-dim.vh-inline-pop")) {
  throw new Error("D3.4A verifier: D3.3 mobile inline add-dimension CSS must be removed");
}

// K — builder collapse ends before variant results; rows are never inside details.
const builderStart = variant.indexOf('className="vh-builder"');
const builderClose = variant.indexOf("</details>", builderStart);
const resultsStart = variant.indexOf('className="vh-results-heading"');
if (!(builderStart >= 0 && builderClose > builderStart && resultsStart > builderClose)) {
  throw new Error("D3.4A verifier: builder collapse must not contain Variant results");
}
requireText(variant, "open={builderOpen}", "controlled builder open state");
requireText(variant, "onToggle={(event) => setBuilderOpen(event.currentTarget.open)}", "stable manual builder toggle");

// L/M/N/O — no arrows; six-dot handle + true Pointer Events with threshold/direction protection.
forbidText(variant, "▲", "mobile up-arrow reorder");
forbidText(variant, "▼", "mobile down-arrow reorder");
forbidText(variant, "v-row-move", "mobile arrow reorder controls");
requireText(variant, 'className="vdrag-dots"', "six-dot drag handle");
const circleCount = (variant.match(/<circle /g) ?? []).length;
if (circleCount < 6) throw new Error("D3.4A verifier: six-dot handle must render six dots");
requireText(variant, "ROW_DRAG_ACTIVATION_PX = 8", "8px drag activation threshold");
requireText(variant, "onPointerDown", "pointer down wiring");
requireText(variant, "onPointerMove", "pointer move wiring");
requireText(variant, "onPointerUp", "pointer up wiring");
requireText(variant, "setPointerCapture(event.pointerId)", "pointer capture");
requireText(variant, "releasePointerCapture", "pointer capture release");
requireText(variant, "if (absX > absY)", "horizontal gesture protection");
requireText(variant, "document.elementFromPoint", "pointer-based drop target lookup");
requireText(variant, 'closest<HTMLElement>("[data-variant-row-key]")', "drop target row contract");
requireText(variant, "return next.map((r, i) => ({ ...r, sortOrder: i }));", "sortOrder recompute after reorder");
requireText(css, "touch-action: pan-x;", "horizontal scroll protection on drag handle");

// P — sequence badge is real DOM and derives from rendered index.
requireText(variant, 'className="v-sequence-badge"', "sequence badge");
requireText(variant, "{index + 1}", "render-order sequence value");

// Q/R — normal mobile option display is readonly; pencil opens edit sheet.
requireText(variant, 'className="v-option-readonly"', "readonly option presentation");
requireText(variant, 'className="v-option-value"', "readonly option value");
requireText(variant, 'className="v-option-edit"', "pencil edit affordance");
requireText(variant, "function openOptionEditor", "pencil edit handler");
requireText(variant, 'className="v-mobile-sheet v-mobile-sheet--option-edit"', "option edit bottom sheet");
requireText(css, "color: var(--accent);", "theme-token pencil accent");

// S/T — icon-only copy + trash preserve existing handlers.
requireText(variant, 'aria-label="複製規格"', "copy aria-label");
requireText(variant, 'className="v-icon-copy"', "overlapping-squares copy icon");
requireText(variant, "onClick={() => duplicateRow(index)}", "existing duplicateRow handler");
requireText(variant, 'aria-label="刪除規格"', "trash aria-label");
requireText(variant, 'className="v-icon-trash"', "trash icon");
requireText(variant, "onClick={() => removeRow(index)}", "existing removeRow handler");
forbidText(css, ".variant-del::before", "CSS-generated delete X");

// U — ResultCard mobile price row aligns on its bottom edge; large value grows upward.
requireText(resultCard, 'className="rc-price-mini-value"', "ResultCard sale value source hook");
requireText(css, ".result-card > .rc-header .rc-price-mini {\n    align-items: end;", "price-row bottom alignment");
requireText(css, ".result-card > .rc-header .rc-price-mini-value {\n    line-height: 1;", "large sale value line-height tuning");

// V/W — D3.4A must not invent pricing formulas or inventory semantics.
forbidText(variant, "calculatePrice(", "new pricing formula call");
requireText(variant, "next = recalculateUnlockedVariantPrices(next, {", "existing unlocked-price recalculation");
requireText(variant, "return syncInheritedVariantCosts(rows, opts.productCost, {", "existing reprice inheritance path");
requireText(variant, 'onChange={(e) => updateRow(index, { qty: e.target.value })}', "existing quantity write semantics");
requireText(variant, 'placeholder="庫存空白=無上限"', "existing unlimited-inventory representation");
forbidText(variant, "inventory_policy", "new inventory policy semantics in editor");

console.log("D3.4A mobile Variant UI / interaction source contract passed");
