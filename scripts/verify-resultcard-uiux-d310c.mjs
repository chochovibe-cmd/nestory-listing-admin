import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const tableCss = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
const css = fs.readFileSync("src/app/d310c-mobile-variant-dialog.css", "utf8");
const d310dCss = fs.readFileSync("src/app/d310d-mobile-variant-dialog.css", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const d39bVerifier = fs.readFileSync("scripts/verify-resultcard-uiux-d39b.mjs", "utf8");
const d310aVerifier = fs.readFileSync("scripts/verify-resultcard-uiux-d310a.mjs", "utf8");
const types = fs.readFileSync("src/lib/variants/types.ts", "utf8");
const pricing = fs.readFileSync("src/lib/variants/variantPricing.ts", "utf8");

function count(source, token) {
  return source.split(token).length - 1;
}

// A. Stale presentation assertions are closed against the D3.10B owner contract.
assert.ok(tableCss.includes("--vm-cost-w: 116px;"));
assert.ok(tableCss.includes("--vm-inventory-w: 160px;"));
assert.doesNotMatch(d39bVerifier, /--vm-cost-w:\s*112px;/);
assert.doesNotMatch(d310aVerifier, /--vm-cost-w:\s*112px;/);
assert.doesNotMatch(d39bVerifier, /--vm-inventory-w:\s*152px;/);
assert.doesNotMatch(d310aVerifier, /--vm-inventory-w:\s*152px;/);

// D3.10C remains the mobile toolbar + centered-dialog layer. D3.10D loads after
// it and supersedes only the historical one-size-fits-all dialog proportions.
const d39bImport = layout.indexOf('import "./d39b-mobile-variant-table.css";');
const d310cImport = layout.indexOf('import "./d310c-mobile-variant-dialog.css";');
const d310dImport = layout.indexOf('import "./d310d-mobile-variant-dialog.css";');
assert.ok(d39bImport >= 0 && d310cImport > d39bImport && d310dImport > d310cImport);
assert.match(css, /@media \(max-width:\s*959px\)/);
assert.doesNotMatch(css, /@media \(min-width:/);
assert.doesNotMatch(css, /!important/);
assert.match(d310dCss, /@media \(max-width:\s*959px\)/);

// B. Mobile toolbar: two equal first-row actions plus one full-width batch action.
const toolbarStart = main.indexOf('className="vh-mobile-primary-actions"');
const builderStart = main.indexOf('className="vh-builder"', toolbarStart);
assert.ok(toolbarStart >= 0 && builderStart > toolbarStart);
const toolbar = main.slice(toolbarStart, builderStart);
assert.match(toolbar, /className="vh-add-dim-ghost"[\s\S]*>＋新增維度<\/button>/);
assert.match(toolbar, /className="vh-toolbar-action"[\s\S]*>依角色建立<\/button>/);
assert.match(toolbar, /className="vh-mobile-batch-btn"[\s\S]*disabled=\{mobileSelected\.size === 0\}[\s\S]*>長按多選規格以批次覆蓋價格<\/button>/);
assert.doesNotMatch(toolbar, /批次手動覆蓋價格/);
assert.match(main, /\{isNarrow \? \([\s\S]*className="vh-mobile-primary-actions"[\s\S]*\) : null\}/);
assert.match(css, /\.variant-box \.vh-mobile-primary-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*gap:\s*var\(--sp-2\);[\s\S]*width:\s*100%;/);
assert.match(css, /\.variant-box \.vh-mobile-primary-actions > button\s*\{[\s\S]*height:\s*44px;[\s\S]*padding:\s*0 var\(--sp-3\);[\s\S]*border-width:\s*1px;[\s\S]*border-style:\s*solid;[\s\S]*border-radius:\s*var\(--radius-s\);/);
assert.match(css, /\.variant-box \.vh-mobile-primary-actions \.vh-add-dim-ghost\s*\{[\s\S]*border-style:\s*solid;/);
assert.match(css, /\.variant-box \.vh-mobile-primary-actions \.vh-mobile-batch-btn\s*\{[\s\S]*grid-column:\s*1 \/ -1;/);
assert.match(css, /\.variant-box \.vh-mobile-primary-actions \.vh-mobile-batch-btn:disabled\s*\{[\s\S]*opacity:\s*\.72;[\s\S]*color:\s*var\(--text-muted\);/);

// C. Every mobile Variant editor kind reuses one centered portal dialog shell.
for (const kind of [
  "add-dimension",
  "character",
  "add-value",
  "edit-option",
  "edit-price",
  "batch-cost",
  "add-variant"
]) {
  assert.ok(render.includes(`kind: "${kind}"`), `missing editor modal kind ${kind}`);
}
assert.equal(count(render, 'className="variant-editor-modal-backdrop"'), 1);
assert.equal(count(render, 'className="variant-editor-modal"'), 1);
assert.match(render, /createPortal\([\s\S]*className="variant-editor-modal-backdrop"[\s\S]*className="variant-editor-modal"[\s\S]*document\.body/);
assert.match(render, /data-modal-kind=\{editorModal\.kind\}/);
assert.match(css, /\.variant-editor-modal-backdrop\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;[\s\S]*display:\s*grid;[\s\S]*place-items:\s*center;[\s\S]*safe-area-inset-top[\s\S]*safe-area-inset-bottom/);
assert.match(css, /\.variant-editor-modal\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*border-radius:\s*var\(--radius-m\);/);
assert.match(css, /\.variant-editor-modal-title\s*\{[\s\S]*margin:\s*0 0 var\(--sp-4\);/);
assert.match(css, /\.variant-editor-modal > \.variant-editor-modal-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*margin-top:\s*var\(--sp-4\);/);
assert.match(css, /\.variant-editor-modal-actions > button\s*\{[\s\S]*height:\s*44px;[\s\S]*border-radius:\s*var\(--radius-s\);/);
assert.match(css, /\.variant-editor-modal-actions > button:last-child\s*\{[\s\S]*background:\s*var\(--accent\);[\s\S]*color:\s*var\(--accent-fg\);/);
assert.doesNotMatch(css, /place-items:\s*end center|bottom:\s*0|width:\s*100vw|border-radius:\s*var\(--radius-l\) var\(--radius-l\) 0 0/);
assert.doesNotMatch(d310dCss, /place-items:\s*end center|bottom:\s*0|border-radius:\s*var\(--radius-l\) var\(--radius-l\) 0 0/);

// D. Frozen interaction/shared-scroll/split-override guards remain intact.
assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
const mobileResultsStart = render.indexOf('className="v-mobile-results"');
const desktopStart = render.indexOf('className="vgrid-hdr"', mobileResultsStart);
assert.ok(mobileResultsStart >= 0 && desktopStart > mobileResultsStart);
const mobileResults = render.slice(mobileResultsStart, desktopStart);
assert.equal(count(mobileResults, 'className="v-mobile-table-scroll"'), 1);
assert.match(tableCss, /\.v-mobile-table-scroll\s*\{[\s\S]*overflow-x:\s*auto;/);
for (const token of [
  "costIsInherited: boolean;",
  "sellPriceLocked: boolean;",
  "compareAtLocked: boolean;"
]) assert.ok(types.includes(token), `split override guard missing ${token}`);
assert.match(pricing, /const keepSell = sellLocked\(row\);/);
assert.match(pricing, /const keepCompare = compareLocked\(row\);/);

console.log("D3.10C mobile Variant toolbar + centered dialog contract passed");