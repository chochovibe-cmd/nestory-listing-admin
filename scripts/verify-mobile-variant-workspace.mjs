import assert from "node:assert/strict";
import fs from "node:fs";

// Regression guard: on mobile the Workspace input form wraps each step body in
// `.form-acc-body` (a CSS grid). An implicit `auto` grid track grows to the
// max-content width of the variant table (nowrap rows), so the 款式規格 section
// became wider than the viewport and was clipped by `.form-acc-step{overflow:hidden}`.
// The track must be `minmax(0, 1fr)` so `.v-mobile-table-scroll` owns the scrolling.
const css = fs.readFileSync("src/app/globals.css", "utf8");

const mediaStart = css.indexOf("/* B17: mobile form accordion");
assert.ok(mediaStart >= 0, "B17 mobile accordion block missing");
const mediaEnd = css.indexOf("/* B17: collapsible advanced sections", mediaStart);
assert.ok(mediaEnd > mediaStart, "B17 accordion block end marker missing");
const block = css.slice(mediaStart, mediaEnd);

assert.match(block, /@media \(max-width:\s*959px\)/);
assert.match(
  block,
  /\.form-acc-step\.open \.form-acc-body\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  "open .form-acc-body grid must use a minmax(0,1fr) column track"
);
assert.match(
  block,
  /\.form-acc-step\.open \.form-acc-body\s*>\s*\*\s*\{[^}]*min-width:\s*0;/,
  "direct children of .form-acc-body need min-width:0"
);
assert.doesNotMatch(block, /!important/, "no !important in the accordion block");

// The shared mobile table must keep owning horizontal scroll.
const d39b = fs.readFileSync("src/app/d39b-mobile-variant-table.css", "utf8");
assert.match(d39b, /\.v-mobile-table-scroll\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow-x:\s*auto;/);
assert.doesNotMatch(d39b, /!important/);

// No new !important in globals.css (historical patches only).
const importantCount = (css.match(/!important/g) ?? []).length;
const IMPORTANT_BASELINE = 12;
assert.ok(importantCount <= IMPORTANT_BASELINE, `globals.css !important count grew to ${importantCount}`);

console.log("verify-mobile-variant-workspace: ok");
