import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");

assert.match(css, /grid-template-columns:\s*92px minmax\(0, 1fr\) max-content max-content;/);
assert.match(css, /\.rc-title[\s\S]*grid-column:\s*1 \/ 3;[\s\S]*align-self:\s*end;/);
assert.match(css, /\.rc-station-chip[\s\S]*grid-column:\s*3;[\s\S]*align-self:\s*end;/);
assert.match(css, /\.rc-time-ago[\s\S]*grid-column:\s*4;[\s\S]*align-self:\s*end;/);
assert.match(css, /\.rc-dismiss-btn[\s\S]*position:\s*absolute !important;[\s\S]*top:\s*-14px;/);
assert.match(css, /\.rc-thumb[\s\S]*width:\s*92px;[\s\S]*height:\s*92px;/);
assert.match(css, /@media \(max-width:\s*520px\)[\s\S]*\.rc-thumb[\s\S]*width:\s*84px;[\s\S]*height:\s*84px;/);
assert.match(css, /\.rc-price-mini[\s\S]*flex-wrap:\s*nowrap;/);
assert.match(css, /\.results-scope-label,[\s\S]*height:\s*38px;/);
assert.match(css, /\.ir-scope-select,[\s\S]*height:\s*38px;/);
assert.match(css, /\.rc-panel-header[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
assert.match(css, /\.rc-header-seq-btn[\s\S]*height:\s*34px;/);
assert.match(css, /\.rc-batch-strip[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
assert.match(css, /details\.batch-more:has\(> \.batch-more-menu > :only-child\)[\s\S]*display:\s*block !important;/);
assert.match(css, /details\.batch-more:has\(> \.batch-more-menu > :only-child\) > summary[\s\S]*display:\s*none !important;/);
assert.match(css, /\.rc-gesture-hint[\s\S]*border-left:\s*4px solid var\(--accent\);/);

console.log("Mobile ResultCard owner-refinement checks passed");
// trigger only; R3 workflow replaces this verifier before the final commit.
