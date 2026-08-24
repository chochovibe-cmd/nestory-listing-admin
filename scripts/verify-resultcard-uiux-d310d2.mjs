import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const render = fs.readFileSync("src/components/listing/VariantEditorRender.tsx", "utf8");
const tableCss = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
const d310cCss = fs.readFileSync("src/app/d310c-mobile-variant-dialog.css", "utf8");
const d310dCss = fs.readFileSync("src/app/d310d-mobile-variant-dialog.css", "utf8");
const css = fs.readFileSync("src/app/d310d1-mobile-character-picker.css", "utf8");
const bridge = fs.readFileSync("src/components/listing/VariantCharacterViewportBridge.tsx", "utf8");

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

// A. VisualViewport is measurement-only: height + resize, no offsetTop/top feedback loop and no scroll listener.
assert.match(bridge, /window\.visualViewport/);
assert.match(bridge, /const visualHeight = Math\.max\(0, Math\.round\(viewport\.height\)\);/);
assert.doesNotMatch(bridge, /offsetTop/);
assert.match(bridge, /viewport\.addEventListener\("resize", syncVisualViewport\)/);
assert.match(bridge, /viewport\.removeEventListener\("resize", syncVisualViewport\)/);
assert.doesNotMatch(bridge, /viewport\.(?:add|remove)EventListener\("scroll"/);
assert.doesNotMatch(bridge, /--ve-visual-top/);
assert.doesNotMatch(bridge, /activeBackdrop\.style\.(?:top|bottom|height)\s*=/);
assert.match(bridge, /activeBackdrop\.style\.setProperty\("--ve-visual-height"/);
assert.match(bridge, /activeBackdrop\.style\.setProperty\("--ve-char-list-max"/);
assert.match(bridge, /removeProperty\("--ve-visual-height"\)/);
assert.match(bridge, /removeProperty\("--ve-char-list-max"\)/);

// B. Backdrop remains the fixed/inset shared shell; Character runtime only toggles explicit keyboard state.
assert.match(d310cCss, /\.variant-editor-modal-backdrop\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;/);
const normalBackdrop = ruleBody(css, '.variant-editor-modal-backdrop[data-modal-kind="character"]');
assert.match(normalBackdrop, /place-items:\s*center;/);
assert.doesNotMatch(normalBackdrop, /\btop\s*:|\bright\s*:|\bbottom\s*:|\bleft\s*:|\bheight\s*:/);
assert.match(bridge, /activeBackdrop\.dataset\.keyboardOpen = "false"/);
assert.match(bridge, /activeBackdrop\.dataset\.keyboardOpen = keyboardOpen \? "true" : "false"/);
assert.match(bridge, /activeBackdrop\.removeAttribute\("data-keyboard-open"\)/);

// C. Keyboard-open state has a meaningful threshold and a compact, measured-height layout.
assert.match(bridge, /const KEYBOARD_THRESHOLD_PX = 120;/);
assert.match(bridge, /window\.innerHeight - visualHeight/);
assert.match(bridge, /keyboardInset >= KEYBOARD_THRESHOLD_PX/);
assert.match(bridge, /KEYBOARD_LIST_MIN_PX = 96/);
assert.match(bridge, /KEYBOARD_LIST_MAX_PX = 132/);
assert.match(bridge, /keyboardOpen[\s\S]*Math\.max\(KEYBOARD_LIST_MIN_PX, Math\.min\(KEYBOARD_LIST_MAX_PX, Math\.round\(visualHeight \* 0\.22\)\)\)[\s\S]*:\s*192/);
const keyboardBackdrop = ruleBody(css, '.variant-editor-modal-backdrop[data-modal-kind="character"][data-keyboard-open="true"]');
assert.match(keyboardBackdrop, /place-items:\s*start center;/);
assert.match(keyboardBackdrop, /padding-top:\s*max\(12px, env\(safe-area-inset-top\)\);/);
assert.match(keyboardBackdrop, /padding-bottom:\s*max\(8px, env\(safe-area-inset-bottom\)\);/);
assert.doesNotMatch(keyboardBackdrop, /(^|\n)\s*(?:top|bottom|height)\s*:/);
assert.match(css, /data-keyboard-open="true"[\s\S]*\.variant-editor-modal\[data-modal-kind="character"\][\s\S]*max-height:\s*calc\(var\(--ve-visual-height, 100dvh\) - 20px\);[\s\S]*overflow-y:\s*auto;/);
assert.match(css, /data-keyboard-open="true"[\s\S]*\.v-char-list--modal\s*\{[\s\S]*max-height:\s*var\(--ve-char-list-max, 112px\);/);

// D. Focus stabilization is internal-dialog-only and one-shot; it never invokes browser scrollIntoView.
assert.doesNotMatch(bridge, /scrollIntoView/);
assert.match(bridge, /focusStabilizationPending = true/);
assert.match(bridge, /window\.requestAnimationFrame/);
assert.match(bridge, /dialog\.scrollTop = 0/);
assert.match(bridge, /focusStabilizationPending = false/);
assert.doesNotMatch(bridge, /window\.scroll|document\.documentElement\.scroll|document\.body\.scroll/);

// E. D3.10D.1 normal geometry and all other modal/table/gesture freezes remain intact.
const characterModal = ruleBody(css, '.variant-editor-modal[data-modal-kind="character"]');
assert.match(characterModal, /width:\s*min\(calc\(100vw - 40px\), 360px\);/);
assert.match(characterModal, /height:\s*auto;/);
const normalList = ruleBody(css, '.variant-editor-modal[data-modal-kind="character"] .v-char-list--modal');
assert.match(normalList, /max-height:\s*var\(--ve-char-list-max, 192px\);/);
const checkbox = ruleBody(css, '.variant-editor-modal[data-modal-kind="character"] .v-char-list--modal input[type="checkbox"]');
assert.match(checkbox, /width:\s*20px;/);
assert.match(checkbox, /height:\s*20px;/);
assert.match(checkbox, /min-width:\s*20px;/);
assert.match(checkbox, /min-height:\s*20px;/);
assert.match(d310dCss, /\.variant-editor-modal\[data-modal-kind="batch-cost"\]\s*\{[\s\S]*width:\s*min\(calc\(100vw - 32px\), 380px\);[\s\S]*max-height:\s*min\(70dvh, 560px\);/);
const compactRule = d310dCss.match(/\.variant-editor-modal:is\([\s\S]*?\)\s*\{[\s\S]*?width:\s*min\(calc\(100vw - 40px\), 360px\);[\s\S]*?max-height:\s*calc\(100dvh - 40px\);[\s\S]*?\}/)?.[0] ?? "";
for (const kind of ["add-dimension", "add-value", "edit-option", "edit-price", "add-variant"]) {
  assert.ok(compactRule.includes(`[data-modal-kind="${kind}"]`), `D3.10D compact freeze missing ${kind}`);
}
assert.match(main, /const ROW_LONG_PRESS_MS = 500;/);
assert.match(main, /const TOUCH_DRAG_PX = 8;/);
const toolbarStart = main.indexOf('className="vh-mobile-primary-actions"');
const builderStart = main.indexOf('className="vh-builder"', toolbarStart);
assert.match(main.slice(toolbarStart, builderStart), /長按多選規格以批次覆蓋價格/);
assert.match(render, /className="v-mobile-table-scroll"/);
assert.ok(tableCss.includes("--vm-cost-w: 116px;"));
assert.ok(tableCss.includes("--vm-inventory-w: 160px;"));

console.log("D3.10D.2 Character keyboard position stability contract passed");
