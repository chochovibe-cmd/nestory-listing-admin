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
  throw new Error("D3.3 verifier: new presentation layer must not add !important");
}

requireText(layout, 'import "./d33-mobile-uiux.css";', "D3.3 stylesheet import");
if (layout.indexOf('import "./d33-mobile-uiux.css";') < layout.indexOf('import "./d32-corrective.css";')) {
  throw new Error("D3.3 verifier: stylesheet must load after D3.2");
}

requireText(css, ".stage-filter-row > .rc-header-select-all--desktop", "mobile select-all control row");
requireText(css, ".rc-selection-guide-row .rc-header-select-all--mobile", "old mobile select-all suppression");
requireText(css, "grid-template-columns: repeat(3, minmax(0, 1fr));", "equal three-control geometry");
requireText(css, ".result-card .rc-sale-badge,", "sale/variant shared chip geometry");
requireText(css, ".result-card .rc-variant-count", "variant chip geometry");
requireText(css, "overflow-x: auto;", "horizontal touch scroll");
requireText(css, ".variant-box .vh-dim-values", "dimension value rail");
requireText(css, ".variant-box .vgrid-block", "variant row viewport");
requireText(css, ".variant-box .variant-del::before", "mobile delete x affordance");
requireText(css, 'content: "×";', "mobile delete x glyph");
requireText(css, ".variant-box .vdrag--mobile", "mobile drag fallback selector");
requireText(css, "display: none;", "touch drag is not falsely exposed");

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
requireText(variant, "draggable={!isNarrow}", "desktop-only native drag contract");
requireText(variant, "onClick={() => moveRow(index, -1)}", "reliable mobile up reorder");
requireText(variant, "onClick={() => moveRow(index, 1)}", "reliable mobile down reorder");
requireText(variant, "🗑", "underlying delete button kept presentation-only");
requireText(variant, "applyCostToAllVariants", "apply-cost behavior remains present");

console.log("D3.3 mobile UIUX source contract passed");
