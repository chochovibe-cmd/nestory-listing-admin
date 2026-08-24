import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const tableCss = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
const d310dCss = fs.readFileSync("src/app/d310d-mobile-variant-dialog.css", "utf8");
const characterCss = fs.readFileSync("src/app/d310d1-mobile-character-picker.css", "utf8");
const bridge = fs.readFileSync("src/components/listing/VariantCharacterViewportBridge.tsx", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

// A. iOS focus-zoom prevention: every mobile Variant modal editable field uses 16px value text.
const editableRule = d310dCss.match(
  /\.variant-editor-modal \.variant-editor-modal-field > input:not\(\[type="checkbox"\]\),[\s\S]*?\.variant-editor-modal \.variant-editor-modal-field > select\s*\{([\s\S]*?)\}/
)?.[1] ?? "";
assert.match(editableRule, /font-size:\s*16px;/);
assert.match(editableRule, /line-height:\s*normal;/);
const geometryRule = d310dCss.match(
  /\.variant-editor-modal-field > input,[\s\S]*?\.variant-editor-modal-field > select\s*\{([\s\S]*?)\}/
)?.[1] ?? "";
assert.match(geometryRule, /height:\s*44px;/);
assert.match(geometryRule, /min-height:\s*44px;/);
assert.match(geometryRule, /max-height:\s*44px;/);
assert.match(d310dCss, /input:not\(\[type="checkbox"\]\)/, "generic mobile input rule must exclude checkboxes");
assert.match(characterCss, /\.variant-editor-modal\[data-modal-kind="character"\] \.v-char-search\s*\{[\s\S]*font-size:\s*16px;/);

// B. Checkbox geometry remains the dedicated D3.10D.1 20x20 contract.
const checkbox = ruleBody(characterCss, '.variant-editor-modal[data-modal-kind="character"] .v-char-list--modal input[type="checkbox"]');
for (const token of [
  "width: 20px;",
  "height: 20px;",
  "min-width: 20px;",
  "min-height: 20px;",
  "max-width: 20px;",
  "max-height: 20px;",
  "padding: 0;",
  "margin: 0;"
]) assert.ok(checkbox.includes(token), `checkbox freeze missing ${token}`);

// C. Accessibility: do not disable user zoom to hide Safari focus zoom.
assert.doesNotMatch(layout, /maximumScale\s*:\s*1|maximum-scale\s*=\s*1/i);
assert.doesNotMatch(layout, /userScalable\s*:\s*false|user-scalable\s*=\s*no/i);

// D. No zoom/scroll hacks were introduced; Safari receives normal 16px editable controls.
assert.doesNotMatch(d310dCss + characterCss, /(^|[;{\s])zoom\s*:/i);
assert.doesNotMatch(d310dCss + characterCss, /transform\s*:\s*scale\(/i);
assert.doesNotMatch(bridge, /scrollIntoView|window\.scroll|document\.documentElement\.scroll|document\.body\.scroll/);
assert.doesNotMatch(bridge, /focusStabilization|requestAnimationFrame|cancelAnimationFrame|dialog\.scrollTop/);
assert.doesNotMatch(bridge, /offsetTop|--ve-visual-top/);

// E. Geometry and interaction freezes remain unchanged.
const characterModal = ruleBody(characterCss, '.variant-editor-modal[data-modal-kind="character"]');
assert.match(characterModal, /width:\s*min\(calc\(100vw - 40px\), 360px\);/);
assert.match(characterModal, /height:\s*auto;/);
const normalList = ruleBody(characterCss, '.variant-editor-modal[data-modal-kind="character"] .v-char-list--modal');
assert.match(normalList, /max-height:\s*var\(--ve-char-list-max, 192px\);/);
assert.match(d310dCss, /\.variant-editor-modal\[data-modal-kind="batch-cost"\]\s*\{[\s\S]*width:\s*min\(calc\(100vw - 32px\), 380px\);[\s\S]*max-height:\s*min\(70dvh, 560px\);/);
const compactRule = d310dCss.match(/\.variant-editor-modal:is\([\s\S]*?\)\s*\{[\s\S]*?width:\s*min\(calc\(100vw - 40px\), 360px\);[\s\S]*?max-height:\s*calc\(100dvh - 40px\);[\s\S]*?\}/)?.[0] ?? "";
for (const kind of ["add-dimension", "add-value", "edit-option", "edit-price", "add-variant"]) {
  assert.ok(compactRule.includes(`[data-modal-kind="${kind}"]`), `compact modal freeze missing ${kind}`);
}
assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
const toolbarStart = main.indexOf('className="vh-mobile-primary-actions"');
const builderStart = main.indexOf('className="vh-builder"', toolbarStart);
assert.match(main.slice(toolbarStart, builderStart), /長按多選規格以批次覆蓋價格/);
assert.match(render, /className="v-mobile-table-scroll"/);
assert.ok(tableCss.includes("--vm-cost-w: 116px;"));
assert.ok(tableCss.includes("--vm-inventory-w: 160px;"));

// Character keyboard safety remains height-only and cleanup-backed.
assert.match(bridge, /window\.visualViewport/);
assert.match(bridge, /viewport\.height/);
assert.match(bridge, /viewport\.addEventListener\("resize", syncVisualViewport\)/);
assert.match(bridge, /viewport\.removeEventListener\("resize", syncVisualViewport\)/);
assert.match(bridge, /removeProperty\("--ve-visual-height"\)/);
assert.match(bridge, /removeProperty\("--ve-char-list-max"\)/);
assert.match(bridge, /removeAttribute\("data-keyboard-open"\)/);

console.log("D3.10D.3 iOS Variant modal input zoom-prevention contract passed");