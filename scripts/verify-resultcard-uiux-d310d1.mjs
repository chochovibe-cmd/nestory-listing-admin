import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const tableCss = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
const d310dCss = fs.readFileSync("src/app/d310d-mobile-variant-dialog.css", "utf8");
const css = fs.readFileSync("src/app/d310d1-mobile-character-picker.css", "utf8");
const bridge = fs.readFileSync("src/components/listing/VariantCharacterViewportBridge.tsx", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

// A. Character checkbox explicitly escapes the global full-width form-input geometry.
const checkbox = ruleBody(css, '.variant-editor-modal[data-modal-kind="character"] .v-char-list--modal input[type="checkbox"]');
for (const token of [
  "width: 20px;",
  "height: 20px;",
  "min-width: 20px;",
  "min-height: 20px;",
  "max-width: 20px;",
  "max-height: 20px;",
  "padding: 0;",
  "margin: 0;",
  "flex: 0 0 20px;",
  "box-sizing: border-box;",
  "accent-color: var(--accent);"
]) assert.ok(checkbox.includes(token), `missing Character checkbox reset ${token}`);
assert.doesNotMatch(checkbox, /width:\s*100%/);
const row = ruleBody(css, '.variant-editor-modal[data-modal-kind="character"] .v-char-list--modal > label');
assert.match(row, /display:\s*grid;/);
assert.match(row, /grid-template-columns:\s*20px minmax\(0, 1fr\);/);
assert.match(row, /align-items:\s*center;/);
assert.match(row, /gap:\s*var\(--sp-2\);/);
assert.match(row, /min-height:\s*44px;/);
const text = ruleBody(css, '.variant-editor-modal[data-modal-kind="character"] .v-char-list--modal > label > span');
assert.match(text, /min-width:\s*0;/);
assert.match(text, /font-size:\s*12px;/);
assert.match(text, /line-height:\s*1\.35;/);
assert.match(text, /overflow-wrap:\s*anywhere;/);

// B. Character alone is narrower and list height is capped to roughly four rows in normal state.
const characterModal = ruleBody(css, '.variant-editor-modal[data-modal-kind="character"]');
assert.match(characterModal, /width:\s*min\(calc\(100vw - 40px\), 360px\);/);
assert.match(characterModal, /height:\s*auto;/);
assert.doesNotMatch(characterModal, /min-height:/);
const list = ruleBody(css, '.variant-editor-modal[data-modal-kind="character"] .v-char-list--modal');
assert.match(list, /height:\s*auto;/);
assert.match(list, /max-height:\s*var\(--ve-char-list-max, 192px\);/);
assert.match(list, /overflow-y:\s*auto;/);
assert.doesNotMatch(list, /min-height:/);
assert.match(css, /\.variant-editor-character-empty\s*\{[\s\S]*min-height:\s*48px;[\s\S]*height:\s*auto;/);

// C. Mobile initial programmatic Character autofocus is suppressed; a real pointer focus remains allowed.
assert.match(bridge, /window\.matchMedia\("\(max-width: 959px\)"\)/);
assert.match(bridge, /document\.addEventListener\("pointerdown", onPointerDown, true\)/);
assert.match(bridge, /document\.addEventListener\("focusin", onFocusIn, true\)/);
assert.match(bridge, /performance\.now\(\) > allowSearchFocusUntil[\s\S]*event\.target\.blur\(\)/);
assert.match(render, /className="v-char-search"[\s\S]*autoFocus/);

// D. D3.10D.2 supersedes Character viewport positioning: VisualViewport is height measurement only.
assert.match(bridge, /window\.visualViewport/);
assert.match(bridge, /viewport\.height/);
assert.doesNotMatch(bridge, /viewport\.offsetTop/);
assert.match(bridge, /viewport\.addEventListener\("resize", syncVisualViewport\)/);
assert.match(bridge, /viewport\.removeEventListener\("resize", syncVisualViewport\)/);
assert.doesNotMatch(bridge, /viewport\.addEventListener\("scroll"|viewport\.removeEventListener\("scroll"/);
assert.match(bridge, /removeProperty\("--ve-visual-height"\)/);
assert.match(bridge, /removeProperty\("--ve-char-list-max"\)/);
assert.doesNotMatch(bridge, /--ve-visual-top/);
assert.match(bridge, /activeBackdrop\.dataset\.modalKind = "character"/);
assert.match(bridge, /activeBackdrop\.removeAttribute\("data-keyboard-open"\)/);
const characterBackdropRule = ruleBody(css, '.variant-editor-modal-backdrop[data-modal-kind="character"]');
assert.match(characterBackdropRule, /place-items:\s*center;/);
assert.doesNotMatch(characterBackdropRule, /\btop\s*:|\bbottom\s*:|\bheight\s*:/);
assert.doesNotMatch(bridge, /activeBackdrop\.style\.(?:top|bottom|height)\s*=/);
assert.match(bridge, /keyboardInsetFor/);
assert.match(bridge, /KEYBOARD_THRESHOLD_PX = 120/);

// E. Corrective isolation: D3.10D.1/D3.10D.2 selectors/source mention Character only; the other six D3.10D geometries stay untouched.
for (const kind of ["add-dimension", "add-value", "edit-option", "edit-price", "add-variant", "batch-cost"]) {
  assert.doesNotMatch(css, new RegExp(`data-modal-kind=["']${kind}["']`));
  assert.doesNotMatch(bridge, new RegExp(`data-modal-kind=[\\\\"']${kind}[\\\\"']`));
}
assert.match(d310dCss, /\.variant-editor-modal\[data-modal-kind="batch-cost"\]\s*\{[\s\S]*width:\s*min\(calc\(100vw - 32px\), 380px\);[\s\S]*max-height:\s*min\(70dvh, 560px\);/);
const compactRule = d310dCss.match(/\.variant-editor-modal:is\([\s\S]*?\)\s*\{[\s\S]*?width:\s*min\(calc\(100vw - 40px\), 360px\);[\s\S]*?max-height:\s*calc\(100dvh - 40px\);[\s\S]*?\}/)?.[0] ?? "";
for (const kind of ["add-dimension", "add-value", "edit-option", "edit-price", "add-variant"]) {
  assert.ok(compactRule.includes(`[data-modal-kind="${kind}"]`), `D3.10D compact freeze missing ${kind}`);
}

// Character blank-name presentation hygiene is applied at the DOM layer without changing DB/query semantics.
assert.match(bridge, /hideBlankCharacterRows/);
assert.match(bridge, /firstNode\?\.nodeType === Node\.TEXT_NODE/);
assert.match(bridge, /label\.hidden = name\.length === 0/);
assert.match(main, /\.from\("ip_characters"\)/);
assert.match(main, /appendCharacterRows\(dimensions, rows, names\)/);

// F. Frozen interaction/table/toolbar guards remain unchanged.
assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
const toolbarStart = main.indexOf('className="vh-mobile-primary-actions"');
const builderStart = main.indexOf('className="vh-builder"', toolbarStart);
const toolbar = main.slice(toolbarStart, builderStart);
assert.match(toolbar, /長按多選規格以批次覆蓋價格/);
assert.match(render, /className="v-mobile-table-scroll"/);
assert.ok(tableCss.includes("--vm-cost-w: 116px;"));
assert.ok(tableCss.includes("--vm-inventory-w: 160px;"));

const d310dImport = layout.indexOf('import "./d310d-mobile-variant-dialog.css";');
const d310d1Import = layout.indexOf('import "./d310d1-mobile-character-picker.css";');
assert.ok(d310dImport >= 0 && d310d1Import > d310dImport);
assert.match(layout, /VariantCharacterViewportBridge/);

console.log("D3.10D.1 mobile Character Picker geometry contract passed with D3.10D.2 height-only viewport supersession");
