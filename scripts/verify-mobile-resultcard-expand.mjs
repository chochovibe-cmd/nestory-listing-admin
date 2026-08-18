import assert from "node:assert/strict";
import fs from "node:fs";

const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const css = fs.readFileSync("src/app/stabilization.css", "utf8");
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");

const globalsImport = layout.indexOf('import "./globals.css"');
const stabilizationImport = layout.indexOf('import "./stabilization.css"');
assert.ok(globalsImport >= 0, "globals.css import missing");
assert.ok(
  stabilizationImport > globalsImport,
  "stabilization.css must load after globals.css so the scoped regression override wins"
);

assert.match(css, /@media \(max-width: 959px\)/);
assert.match(
  css,
  /\.result-card > \.rc-header > \.rc-quick-row\s*\{\s*display:\s*contents;/
);
assert.match(css, /\.rc-quick-row > \.rc-quick,[\s\S]*\.rc-dismiss-btn[\s\S]*display:\s*none;/);
assert.match(css, /\.rc-quick-row > \.rc-toggle[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/);
assert.match(css, /\.rc-title-row[\s\S]*padding-right:\s*48px;/);

// Existing ResultCard behavior is intentionally reused: toggle stops header click
// and calls tryToggleExpand; selectMode header tap otherwise only toggles selection.
assert.match(card, /className="rc-toggle"/);
assert.match(card, /event\.stopPropagation\(\);\s*tryToggleExpand\(\);/);
assert.match(card, /isNarrow && selectMode && onToggle/);

console.log("Mobile ResultCard expand-affordance checks passed");
