import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const tableCss = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
const d310cCss = fs.readFileSync("src/app/d310c-mobile-variant-dialog.css", "utf8");
const css = fs.readFileSync("src/app/d310d-mobile-variant-dialog.css", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");

function count(source, token) {
  return source.split(token).length - 1;
}

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

const kinds = [
  "add-dimension",
  "add-value",
  "edit-option",
  "edit-price",
  "add-variant",
  "batch-cost",
  "character"
];
const compactKinds = ["add-dimension", "add-value", "edit-option", "edit-price", "add-variant"];

// A. One shared portal shell remains, but D3.10D exposes kind-aware sizing hooks.
for (const kind of kinds) {
  assert.ok(render.includes(`{ kind: "${kind}"`), `missing editor modal kind ${kind}`);
}
assert.equal(count(render, 'className="variant-editor-modal-backdrop"'), 1);
assert.equal(count(render, 'className="variant-editor-modal"'), 1);
assert.match(render, /className="variant-editor-modal"[\s\S]{0,140}key=\{editorModal\.kind\}[\s\S]{0,140}data-modal-kind=\{editorModal\.kind\}/);

const d310cImport = layout.indexOf('import "./d310c-mobile-variant-dialog.css";');
const d310dImport = layout.indexOf('import "./d310d-mobile-variant-dialog.css";');
assert.ok(d310cImport >= 0 && d310dImport > d310cImport, "D3.10D must load after D3.10C");
assert.match(css, /@media \(max-width:\s*959px\)/);
assert.doesNotMatch(css, /@media \(min-width:/);
assert.doesNotMatch(css, /!important/);

const compactRule = css.match(/\.variant-editor-modal:is\([\s\S]*?\)\s*\{[\s\S]*?width:\s*min\(calc\(100vw - 40px\), 360px\);[\s\S]*?max-height:\s*calc\(100dvh - 40px\);[\s\S]*?\}/)?.[0] ?? "";
for (const kind of compactKinds) {
  assert.ok(compactRule.includes(`[data-modal-kind="${kind}"]`), `compact sizing missing ${kind}`);
}
assert.match(css, /\.variant-editor-modal\[data-modal-kind="batch-cost"\]\s*\{[\s\S]*width:\s*min\(calc\(100vw - 32px\), 380px\);[\s\S]*max-height:\s*min\(70dvh, 560px\);/);
assert.match(css, /\.variant-editor-modal\[data-modal-kind="character"\]\s*\{[\s\S]*width:\s*min\(calc\(100vw - 32px\), 380px\);[\s\S]*max-height:\s*min\(72dvh, 580px\);/);
const modalBody = ruleBody(css, ".variant-editor-modal");
assert.match(modalBody, /display:\s*block;/);
assert.match(modalBody, /height:\s*auto;/);
assert.doesNotMatch(modalBody, /min-height:/);
assert.match(modalBody, /overflow-y:\s*auto;/);

// B. Kind changes remount the dialog, so no previous scrollTop survives.
assert.match(render, /key=\{editorModal\.kind\}/);
assert.match(render, /data-modal-kind=\{editorModal\.kind\}/);

// C. Mobile density: inputs and paired actions share a 44px geometry.
const fieldControlBody = css.match(/\.variant-editor-modal-field > input,[\s\S]*?\.variant-editor-modal-field > select\s*\{([\s\S]*?)\}/)?.[1] ?? "";
assert.match(fieldControlBody, /height:\s*44px;/);
assert.match(fieldControlBody, /min-height:\s*44px;/);
assert.match(fieldControlBody, /max-height:\s*44px;/);
assert.match(fieldControlBody, /padding-inline:\s*var\(--sp-3\);/);
assert.match(css, /\.variant-editor-modal-title\s*\{[\s\S]*font-size:\s*16px;[\s\S]*font-weight:\s*900;[\s\S]*line-height:\s*1\.25;/);
assert.match(css, /\.variant-editor-modal > \.variant-editor-modal-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
const actionBody = ruleBody(css, ".variant-editor-modal-actions > button");
assert.match(actionBody, /height:\s*44px;/);
assert.match(actionBody, /min-height:\s*44px;/);
assert.match(actionBody, /border-radius:\s*var\(--radius-s\);/);
assert.match(css, /\.variant-editor-modal-actions > button:first-child\s*\{[\s\S]*border-color:\s*var\(--border\);[\s\S]*background:\s*var\(--surface2\);/);
assert.match(css, /\.variant-editor-modal-actions > button:last-child\s*\{[\s\S]*background:\s*var\(--accent\);/);
assert.match(css, /\.variant-editor-modal > \.variant-editor-modal-note\s*\{[\s\S]*font-size:\s*12px;[\s\S]*line-height:\s*1\.45;/);
assert.match(css, /\.variant-editor-modal\[data-modal-kind="batch-cost"\] \.variant-batch-preview\s*\{[\s\S]*padding:\s*var\(--sp-2\) var\(--sp-3\);[\s\S]*font-size:\s*12px;/);

// D. Character results own the scroll region; 0/1 results no longer reserve a tall box.
const characterListBody = ruleBody(css, '.variant-editor-modal[data-modal-kind="character"] .v-char-list--modal');
assert.match(characterListBody, /height:\s*auto;/);
assert.match(characterListBody, /max-height:\s*min\(32dvh, 280px\);/);
assert.match(characterListBody, /overflow-y:\s*auto;/);
assert.doesNotMatch(characterListBody, /min-height:/);
assert.match(render, /filteredChars\.length === 0[\s\S]*className="variant-editor-character-empty"[\s\S]*沒有符合的角色/);
assert.match(css, /\.variant-editor-character-empty\s*\{[\s\S]*min-height:\s*48px;[\s\S]*font-size:\s*12px;/);

// E. Keyboard/short viewport stays centered and uses dynamic viewport sizing.
const backdropBody = ruleBody(css, ".variant-editor-modal-backdrop");
assert.match(backdropBody, /place-items:\s*center;/);
assert.match(backdropBody, /overscroll-behavior:\s*none;/);
assert.match(backdropBody, /touch-action:\s*pan-y;/);
assert.doesNotMatch(backdropBody, /touch-action:\s*none|bottom:\s*0/);
assert.match(css, /100dvh/);
assert.match(css, /@media \(max-width:\s*959px\) and \(max-height:\s*650px\)[\s\S]*max-height:\s*calc\(100dvh - 16px\);/);
assert.doesNotMatch(css, /place-items:\s*end center|border-radius:\s*var\(--radius-l\) var\(--radius-l\) 0 0/);

// F. D3.10A/B/C freezes: toolbar copy, shared table, split widths and gestures stay intact.
const toolbarStart = main.indexOf('className="vh-mobile-primary-actions"');
const builderStart = main.indexOf('className="vh-builder"', toolbarStart);
assert.ok(toolbarStart >= 0 && builderStart > toolbarStart);
const toolbar = main.slice(toolbarStart, builderStart);
assert.match(toolbar, /長按多選規格以批次覆蓋價格/);
assert.doesNotMatch(toolbar, /批次手動覆蓋價格/);
assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
const mobileResultsStart = render.indexOf('className="v-mobile-results"');
const desktopStart = render.indexOf('className="vgrid-hdr"', mobileResultsStart);
assert.ok(mobileResultsStart >= 0 && desktopStart > mobileResultsStart);
const mobileResults = render.slice(mobileResultsStart, desktopStart);
assert.equal(count(mobileResults, 'className="v-mobile-table-scroll"'), 1);
assert.ok(tableCss.includes("--vm-cost-w: 116px;"));
assert.ok(tableCss.includes("--vm-inventory-w: 160px;"));
assert.match(tableCss, /\.v-mobile-table-scroll\s*\{[\s\S]*overflow-x:\s*auto;/);

// D3.10C still owns the toolbar shell; only its one-size dialog geometry is superseded.
assert.match(d310cCss, /\.variant-box \.vh-mobile-primary-actions/);

console.log("D3.10D mobile Variant dialog sizing + keyboard-fit contract passed");