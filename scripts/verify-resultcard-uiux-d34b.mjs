import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/app/d33-mobile-uiux.css", "utf8");
const correctiveCss = fs.readFileSync("src/app/d34b-iphone-corrective.css", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const resultCard = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");
const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const variant = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8") + "\n" + fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");

assert.doesNotMatch(css, /!important/);
assert.doesNotMatch(correctiveCss, /!important/);

// Corrective stylesheet must load after the historical D3.4B/D3.3 presentation layer.
const d33ImportPos = layout.indexOf('import "./d33-mobile-uiux.css";');
const iphoneCorrectiveImportPos = layout.indexOf('import "./d34b-iphone-corrective.css";');
assert.ok(d33ImportPos >= 0 && iphoneCorrectiveImportPos > d33ImportPos);

// A — D3.6 supersedes D3.5 mobile presentation only. The semantic checkbox and
// indeterminate contract stay intact; desktop remains native while mobile reuses
// the historical track as the final two-segment control.
assert.match(panel, /type="checkbox"[\s\S]*aria-label="全選目前列表"/);
assert.match(panel, /el\.indeterminate\s*=\s*someSelected/);
assert.match(correctiveCss, /@media \(min-width:\s*960px\)[\s\S]*?\.rc-header-select-all \.rc-toggle-track\s*\{[\s\S]*?display:\s*none;/);
assert.match(correctiveCss, /@media \(min-width:\s*960px\)[\s\S]*?input\[type="checkbox"\][\s\S]*?position:\s*static;[\s\S]*?opacity:\s*1;[\s\S]*?accent-color:\s*var\(--accent\)/);
assert.match(correctiveCss, /@media \(max-width:\s*959px\)[\s\S]*?input\[type="checkbox"\][\s\S]*?position:\s*absolute;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?opacity:\s*0;/);
assert.match(correctiveCss, /@media \(max-width:\s*959px\)[\s\S]*?\.rc-toggle-track\s*\{[\s\S]*?display:\s*block;[\s\S]*?height:\s*38px;/);
assert.match(correctiveCss, /input:indeterminate \+ \.rc-toggle-track > span\s*\{[\s\S]*?left:\s*calc\(50% \+ var\(--sp-1\)\);[\s\S]*?background:\s*var\(--surface2\);/);

// B — D3.7 supersedes the dismissible notification-card hint with persistent JSX copy.
assert.match(panel, /className="rc-gesture-hint-mark">△<\/span>[\s\S]*className="rc-gesture-hint-text">長按可多選，進行批次核准／送審；右滑開啟核准／重生等快速操作，左滑移出佇列。<\/span>/);
assert.doesNotMatch(panel, /RC_GESTURE_HINT_KEY|showGestureHint|dismissGestureHint|rc-gesture-hint-dismiss/);
assert.doesNotMatch(css, /rc-gesture-hint-dismiss|rc-gesture-hint > span::before|向左滑可核准／重送|向右滑可移除/);
assert.match(css, /@media \(min-width:\s*960px\)[\s\S]*\.rc-gesture-hint\s*\{[\s\S]*display:\s*none;/);
assert.match(css, /\.rc-selection-guide-row \.rc-gesture-hint\s*\{[\s\S]*align-items:\s*flex-start;[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;[\s\S]*color:\s*var\(--accent\);/);

// D3.3 owner contract — sale status stays immediately before a positive variant-count chip.
const salePos = resultCard.indexOf('className="rc-sale-badge"');
const variantCountPos = resultCard.indexOf('className="schip rc-variant-count"');
assert.ok(salePos >= 0 && variantCountPos > salePos);
assert.match(resultCard, /variantCount\s*>\s*0\s*\?\s*\([\s\S]*className="schip rc-variant-count"[\s\S]*個規格/);
assert.match(correctiveCss, /\.result-card \.rc-variant-count\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*visibility:\s*visible;[\s\S]*opacity:\s*1;/);
assert.match(correctiveCss, /\.result-card > \.rc-header \.rc-variant-count\s*\{[\s\S]*grid-column:\s*3;[\s\S]*grid-row:\s*2;/);

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

// E/H — long-press selection + batch override still use existing pricing logic.
// D3.5 only relocates the mobile batch entry into the primary action toolbar.
assert.match(variant, /ROW_LONG_PRESS_MS = 500/);
assert.match(variant, /toggleMobileRowSelection/);
assert.match(variant, /vh-mobile-primary-actions[\s\S]*批次手動覆蓋價格/);
assert.match(variant, /calculatePrice\(cost,/);
assert.match(variant, /costIsInherited:\s*false/);
assert.match(variant, /recalculateUnlockedVariantPrices\(next,/);

// Desktop D/E result-row path stays separate and retains native desktop drag/input layout.
assert.match(variant, /\) : isNarrow \? \([\s\S]*v-mobile-results[\s\S]*\) : \([\s\S]*vgrid-hdr/);
assert.match(variant, /className="vdrag"[\s\S]*draggable/);

// F iPhone corrective — mobile price peers align on typographic baselines.
assert.match(correctiveCss, /@media \(max-width:\s*959px\)[\s\S]*\.result-card > \.rc-header \.rc-price-mini\s*\{[\s\S]*align-items:\s*baseline;/);
assert.match(correctiveCss, /rc-price-mini-label,[\s\S]*rc-price-mini-profit\s*\{[\s\S]*align-self:\s*baseline;/);
assert.match(correctiveCss, /rc-price-mini-value\s*\{[\s\S]*line-height:\s*1\.05;/);
assert.doesNotMatch(correctiveCss, /align-items:\s*flex-end/);

console.log("D3.4B ResultCard/Variant source contract passed with D3.7 mobile gesture supersession");
