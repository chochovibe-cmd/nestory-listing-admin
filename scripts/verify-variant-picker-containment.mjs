import assert from "node:assert/strict";
import fs from "node:fs";

const globals = fs.readFileSync("src/app/globals.css", "utf8");
const stabilization = fs.readFileSync("src/app/stabilization.css", "utf8");

// P07 containment is intentional and must stay: this fix must not reopen the
// workbench column-overlap regression just to make Variant hover zoom visible.
assert.match(
  globals,
  /\.workspace-input-panel \.panel-body,[\s\S]*?overflow-x:\s*clip;/
);
assert.match(
  globals,
  /\.panel\.results-panel,[\s\S]*?\.panel\.workspace-input-panel[\s\S]*?overflow-x:\s*clip;/
);

// Geometry contract behind the local collision fix: 260px picker, 72px tiles,
// 8px gap, wrapping to three columns on desktop; hover preview is 160px wide.
assert.match(globals, /\.v-pop-pick\s*\{[\s\S]*?width:\s*260px;/);
assert.match(
  globals,
  /\.pick-grid\s*\{[^}]*display:\s*flex;[^}]*gap:\s*8px;[^}]*flex-wrap:\s*wrap;/
);
assert.match(globals, /\.pick-grid \.pk\s*\{[\s\S]*?width:\s*72px;/);
assert.match(
  globals,
  /\.pick-grid \.pk \.pk-zoom-preview\s*\{[\s\S]*?left:\s*50%;[\s\S]*?transform:\s*translateX\(-50%\);[\s\S]*?width:\s*160px;/
);

// P1-2: only desktop fine-pointer hover gets collision-aware edge alignment.
assert.match(
  stabilization,
  /@media \(min-width:\s*960px\) and \(hover:\s*hover\) and \(pointer:\s*fine\)/
);
assert.match(
  stabilization,
  /\.pk:nth-child\(3n \+ 1\) \.pk-zoom-preview\s*\{[\s\S]*?left:\s*0;[\s\S]*?right:\s*auto;[\s\S]*?transform:\s*none;/
);
assert.match(
  stabilization,
  /\.pk:nth-child\(3n\) \.pk-zoom-preview\s*\{[\s\S]*?left:\s*auto;[\s\S]*?right:\s*0;[\s\S]*?transform:\s*none;/
);

// Regression hotfixes must not add new specificity escape hatches.
assert.doesNotMatch(stabilization, /!important/);

console.log("Variant picker containment checks passed");
