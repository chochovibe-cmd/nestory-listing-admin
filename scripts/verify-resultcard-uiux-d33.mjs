import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`D3.3 verifier: missing ${label}`);
  }
}

const css = read("src/app/d33-mobile-uiux.css");
const layout = read("src/app/layout.tsx");
const resultCard = read("src/components/listing/ResultCard.tsx");
const panel = read("src/components/listing/DraftResultsPanel.tsx");
const variant = read("src/components/listing/VariantEditor.tsx");

if (css.includes("!important")) {
  throw new Error("D3.3 verifier: presentation layer must not add !important");
}

requireText(layout, 'import "./d33-mobile-uiux.css";', "D3.3 stylesheet import");
if (layout.indexOf('import "./d33-mobile-uiux.css";') < layout.indexOf('import "./d32-corrective.css";')) {
  throw new Error("D3.3 verifier: stylesheet must load after D3.2");
}

requireText(css, ".stage-filter-row > .rc-header-select-all--desktop", "mobile select-all control row");
requireText(css, "grid-template-columns: repeat(3, minmax(0, 1fr));", "three-control geometry");
requireText(css, ".result-card .rc-sale-badge,", "sale/variant shared chip geometry");
requireText(css, ".result-card .rc-variant-count", "variant chip geometry");
requireText(css, "overflow-x: auto;", "horizontal row touch scroll");
requireText(css, ".variant-box .vh-dim-values", "dimension presentation hook");
requireText(css, ".variant-box .vgrid-block", "variant row viewport");

const salePos = resultCard.indexOf('className="rc-sale-badge"');
const variantPos = resultCard.indexOf('className="schip rc-variant-count"');
if (salePos < 0 || variantPos < 0 || salePos >= variantPos) {
  throw new Error("D3.3 verifier: ResultCard source order must remain sale status -> variant count");
}

const selectAllPos = panel.indexOf("rc-header-select-all rc-header-select-all--desktop");
const tabsPos = panel.indexOf("<StageFilterPills");
const controlsPos = panel.indexOf('className="stage-filter-end"');
if (selectAllPos < 0 || tabsPos < 0 || controlsPos < 0 || !(selectAllPos < tabsPos && tabsPos < controlsPos)) {
  throw new Error("D3.3 verifier: select-all/tabs/control source anchors changed unexpectedly");
}

requireText(variant, "...rows.slice(0, index + 1),", "copy inserts after source row");
requireText(variant, "draggable={!isNarrow}", "desktop-only native HTML drag contract");
requireText(variant, "applyCostToAllVariants", "apply-cost behavior remains present");

// D3.4A intentionally supersedes D3.3 mobile ▲/▼ fallback, hidden mobile drag,
// and delete-X presentation. Those contracts are asserted by the D3.4A verifier.
console.log("D3.3 mobile UIUX source contract passed (D3.4A supersedes mobile reorder/delete affordances)");
