import assert from "node:assert/strict";
import fs from "node:fs";

const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const stabilization = fs.readFileSync("src/app/stabilization.css", "utf8");
const releaseCss = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");
const card = fs.readFileSync("src/components/listing/ResultCard.tsx", "utf8");

const globalsImport = layout.indexOf('import "./globals.css"');
const stabilizationImport = layout.indexOf('import "./stabilization.css"');
const releaseImport = layout.indexOf('import "./resultcard-mobile-release.css"');
assert.ok(globalsImport >= 0, "globals.css import missing");
assert.ok(stabilizationImport > globalsImport, "stabilization.css must load after globals.css");
assert.ok(
  releaseImport > stabilizationImport,
  "owner-corrected ResultCard release CSS must load after stabilization.css"
);

// Historical P0-3 repair remains documented in stabilization.css, but the owner
// explicitly superseded the visible mobile arrow on 2026-08-20. Normal-mode
// card tap is now the preferred expand path.
assert.match(stabilization, /\.rc-quick-row > \.rc-toggle[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/);
assert.match(
  releaseCss,
  /\.result-card > \.rc-header > \.rc-quick-row > \.rc-toggle\s*\{\s*display:\s*none;/
);

// Existing behavior stays in ResultCard: normal header tap expands/collapses;
// long-press synthetic click is swallowed; multi-select tap toggles selection.
assert.match(card, /function handleHeaderClick\(\)/);
assert.match(card, /if \(longPressTriggeredRef\.current\)/);
assert.match(card, /if \(isNarrow && selectMode && onToggle\)/);
assert.match(card, /tryToggleExpand\(\);/);
assert.match(card, /function tryToggleExpand\(\)/);

// The old rc-toggle node/keyboard handler stays in source for desktop/history and
// is not deleted as collateral; mobile presentation simply hides it after owner review.
assert.match(card, /className="rc-toggle"/);
assert.match(card, /event\.stopPropagation\(\);\s*tryToggleExpand\(\);/);

// New top-right mobile X reuses the existing soft archive path, not hard delete.
assert.match(card, /className="rc-dismiss-btn"/);
assert.match(card, /void archiveOne\(\);/);
assert.match(releaseCss, /> \.rc-quick-row > \.rc-dismiss-btn[\s\S]*display:\s*inline-flex;/);

console.log("Mobile ResultCard owner-superseded expand/tap contract checks passed");
