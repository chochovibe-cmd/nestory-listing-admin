import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/app/d33-mobile-uiux.css", "utf8");
const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const variant = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8") + "\n" + fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");

assert.doesNotMatch(css, /!important/);

// A — select-all copy is visibly inside the actual toggle track; no outer frame.
assert.match(css, /rc-header-select-all--desktop[\s\S]*border:\s*0;[\s\S]*rc-toggle-track[\s\S]*content:\s*"全選";/s);
assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);

// B — the existing dismiss handler remains data-free; D3.4B restores the real X node.
assert.match(panel, /function dismissGestureHint\(\)[\s\S]*setShowGestureHint\(false\)/);
assert.match(panel, /className="rc-gesture-hint-dismiss"/);
assert.match(css, /向左滑可核准／重送；向右滑可移除/);
assert.match(css, /rc-gesture-hint-dismiss[\s\S]*display:\s*inline-grid/);

// C — Tag-page chip vocabulary + modal-only add dimension/value flow.
assert.match(variant, /className="rc-tag vh-axis-tag"/);
assert.match(variant, /className="rc-tag add vh-add-value-chip"/);
assert.match(variant, /openEditorModal\(\{ kind: "add-dimension" \}\)/);
assert.match(variant, /openEditorModal\(\{ kind: "add-value", dimIndex: i \}\)/);
assert.match(variant, /variant-editor-modal-backdrop/);
assert.doesNotMatch(variant, /vh-dim-add-input/);

// D — mobile rows: real Pointer Events drag, copy-next, badge, readonly labels,
// price before cost, unlimited toggle, and trash at far-right source order.
assert.match(variant, /vdrag vdrag--touch/);
assert.match(variant, /onPointerDown=.*onTouchDragPointerDown/);
assert.match(variant, /onPointerMove=\{onTouchDragPointerMove\}/);
assert.match(variant, /onPointerUp=\{finishTouchDrag\}/);
assert.match(variant, /data-variant-row-index=\{index\}/);
assert.match(variant, /\.\.\.rows\.slice\(0, index \+ 1\),[\s\S]*copy,[\s\S]*\.\.\.rows\.slice\(index \+ 1\)/);
assert.match(variant, /v-row-dup--icon[\s\S]*v-copy-icon/);
assert.match(variant, /v-row-badge/);
assert.match(variant, /v-mobile-option-value[\s\S]*v-mobile-edit-icon/);
assert.match(css, /v-mobile-option-value[\s\S]*white-space:\s*normal;[\s\S]*text-overflow:\s*clip;/);
const mobileRowStart = variant.indexOf('className="v-mobile-row-core"');
const pricePos = variant.indexOf('className="v-mobile-price-result"', mobileRowStart);
const costPos = variant.indexOf('className="v-mobile-cost"', mobileRowStart);
const inventoryPos = variant.indexOf('className="v-mobile-inventory"', mobileRowStart);
const trashPos = variant.indexOf('className="variant-del variant-del--trash"', mobileRowStart);
assert.ok(mobileRowStart >= 0 && pricePos > mobileRowStart && costPos > pricePos && inventoryPos > costPos && trashPos > inventoryPos);
assert.match(variant, /checked=\{!row\.qty\.trim\(\)\}/);
assert.match(variant, /庫存視為無限/);
assert.match(css, /variant-del--trash::before\s*\{[\s\S]*content:\s*none;/);
assert.doesNotMatch(css, /content:\s*"×";/);

// E/H — long-press selection + modal batch override uses the existing pricing helper.
assert.match(variant, /ROW_LONG_PRESS_MS = 500/);
assert.match(variant, /toggleMobileRowSelection/);
assert.match(variant, /批次手動覆蓋價格/);
assert.match(variant, /calculatePrice\(cost,/);
assert.match(variant, /costIsInherited:\s*false/);
assert.match(variant, /recalculateUnlockedVariantPrices\(next,/);
assert.match(variant, /vh-mobile-batch-actions[\s\S]*批次手動覆蓋價格[\s\S]*新增 Variant/);

// Desktop D/E result-row path stays separate and retains native desktop drag/input layout.
assert.match(variant, /\) : isNarrow \? \([\s\S]*v-mobile-results[\s\S]*\) : \([\s\S]*vgrid-hdr/);
assert.match(variant, /className="vdrag"[\s\S]*draggable/);

// F — bottom alignment is intentionally global (outside the mobile media block).
const mediaPos = css.indexOf("@media (max-width: 959px)");
const priceAlignPos = css.indexOf(".result-card .rc-price-mini,");
assert.ok(priceAlignPos >= 0 && mediaPos > priceAlignPos);
assert.match(css.slice(priceAlignPos, mediaPos), /align-items:\s*flex-end/);

console.log("D3.4B ResultCard/Variant UIUX source contract passed");
