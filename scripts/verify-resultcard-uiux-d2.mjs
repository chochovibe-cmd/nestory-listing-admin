import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");
const variants = fs.readFileSync("src/components/listing/VariantEditor.tsx", "utf8");
const login = fs.readFileSync("src/app/login/page.tsx", "utf8");
const css = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");

assert.match(panel, /stage-filter-row[\s\S]*rc-selection-guide-row[\s\S]*rc-batch-strip/);
assert.match(panel, /results-sort-label[\s\S]*rc-header-select-all--desktop/);
assert.match(css, /@media \(max-width:\s*959px\)[\s\S]*\.rc-dismiss-btn\s*\{\s*display:\s*none;/s);
assert.match(card, /className="rc-card-summary-row"[\s\S]*formatMarkSummaryLine\(markSummary\)/);
assert.match(card, /const variantCount = useMemo/);
assert.match(card, /<span className="schip rc-variant-count">\{variantCount\} 個規格<\/span>/);
assert.match(card, /collectSellPricesForCard[\s\S]*formatPriceRangeLabel/);
assert.doesNotMatch(variants, />重新展開</);
assert.match(variants, /expandArmed \? \([\s\S]*確認更新款式/);
assert.match(variants, /軸值變更後會自動更新款式列/);
assert.doesNotMatch(login, /mock-safe 骨架模式|潮巢 商品上架助手/);
assert.match(login, /<h1 className="login-brand-title">團隊登入<\/h1>/);

console.log("ResultCard UIUX D2 source checks passed");
