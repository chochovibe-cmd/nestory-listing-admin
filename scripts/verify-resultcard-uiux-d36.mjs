import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const releaseCss = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");
const d33Css = fs.readFileSync("src/app/d33-mobile-uiux.css", "utf8");
const finalCss = fs.readFileSync("src/app/d34b-iphone-corrective.css", "utf8");
const ownerCss = fs.readFileSync("src/app/d36-owner-ui-consistency.css", "utf8");

assert.doesNotMatch(releaseCss, /!important/);
assert.doesNotMatch(finalCss, /!important/);
assert.doesNotMatch(ownerCss, /!important/);

// Item A — reuse the existing semantic checkbox contract. No duplicate state or
// interaction path is introduced for the D3.6 segmented mobile presentation.
assert.match(panel, /checked=\{allSelected\}/);
assert.match(panel, /onChange=\{toggleAll\}/);
assert.match(panel, /el\.indeterminate\s*=\s*someSelected/);
assert.match(panel, /aria-label="全選目前列表"/);
assert.match(panel, /className="rc-toggle-track" aria-hidden><span \/><\/span>/);

// Desktop >=960 stays on the D3.5 native checkbox presentation.
assert.match(finalCss, /@media \(min-width:\s*960px\)[\s\S]*?\.rc-header-select-all \.rc-toggle-track\s*\{[\s\S]*?display:\s*none;/);
assert.match(finalCss, /@media \(min-width:\s*960px\)[\s\S]*?\.rc-header-select-all > input\[type="checkbox"\]\s*\{[\s\S]*?position:\s*static;[\s\S]*?inline-size:\s*18px;[\s\S]*?opacity:\s*1;[\s\S]*?accent-color:\s*var\(--accent\)/);

// Mobile <=959 keeps the existing three-column filter hierarchy at a shared 38px height.
assert.match(d33Css, /@media \(max-width:\s*959px\)[\s\S]*?\.stage-filter-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
assert.match(finalCss, /@media \(max-width:\s*959px\)[\s\S]*?\.stage-filter-row > \.rc-header-select-all--desktop\s*\{[\s\S]*?min-height:\s*38px;[\s\S]*?height:\s*38px;/);
assert.match(d33Css, /\.results-scope-label,[\s\S]*?\.results-sort-label\s*\{[\s\S]*?min-height:\s*38px;[\s\S]*?height:\s*38px;/);

// Native checkbox visual is hidden only on mobile; the track is the full segmented control.
assert.match(finalCss, /@media \(max-width:\s*959px\)[\s\S]*?input\[type="checkbox"\]\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inline-size:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?opacity:\s*0;/);
assert.match(finalCss, /\.stage-filter-row > \.rc-header-select-all--desktop \.rc-toggle-track\s*\{[\s\S]*?display:\s*block;[\s\S]*?height:\s*38px;[\s\S]*?border:\s*1px solid var\(--border\);[\s\S]*?border-radius:\s*var\(--radius-s\);[\s\S]*?background:\s*var\(--surface\);/);
assert.match(finalCss, /\.rc-toggle-track::before\s*\{[\s\S]*?content:\s*"全選";[\s\S]*?width:\s*50%;/);
assert.match(finalCss, /\.rc-toggle-track::after\s*\{\s*content:\s*none;/);

// OFF = neutral segment on the empty right half.
assert.match(finalCss, /\.rc-toggle-track > span\s*\{[\s\S]*?right:\s*var\(--sp-1\);[\s\S]*?left:\s*calc\(50% \+ var\(--sp-1\)\);[\s\S]*?background:\s*var\(--surface2\);[\s\S]*?transform:\s*none;/);

// ON = accent segment on the left, under the “全選” label.
assert.match(finalCss, /input:checked \+ \.rc-toggle-track::before\s*\{[\s\S]*?color:\s*var\(--accent-fg\);/);
assert.match(finalCss, /input:checked \+ \.rc-toggle-track > span\s*\{[\s\S]*?left:\s*var\(--sp-1\);[\s\S]*?right:\s*calc\(50% \+ var\(--sp-1\)\);[\s\S]*?background:\s*var\(--accent\);/);

// INDETERMINATE is visually distinct but must not masquerade as all-selected.
assert.match(finalCss, /input:indeterminate \+ \.rc-toggle-track\s*\{[\s\S]*?border-color:\s*color-mix\(in srgb, var\(--accent\) 58%, var\(--border\)\);[\s\S]*?background:\s*var\(--surface\);/);
assert.match(finalCss, /input:indeterminate \+ \.rc-toggle-track > span\s*\{[\s\S]*?left:\s*calc\(50% \+ var\(--sp-1\)\);[\s\S]*?right:\s*var\(--sp-1\);[\s\S]*?background:\s*var\(--surface2\);/);

// Item B — final owner layer uses one shared button geometry while preserving
// station-specific equal-column layouts: copy = 3 peers, image/ready = 2 columns.
assert.doesNotMatch(releaseCss, /grid-template-columns:\s*\.82fr 1\.12fr 1\.16fr/);
assert.match(releaseCss, /\.rc-batch-strip--copy\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);\s*\}/);
assert.match(finalCss, /\.rc-batch-strip--copy\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
assert.match(ownerCss, /\.rc-batch-strip--copy\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?align-items:\s*stretch;/);
assert.match(ownerCss, /\.rc-batch-strip--image,[\s\S]*?\.rc-batch-strip--ready\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?align-items:\s*stretch;/);
assert.match(ownerCss, /\.rc-batch-strip--copy \.batch-remove-action,[\s\S]*?\.rc-batch-strip--image \.batch-remove-action:last-child\s*\{[\s\S]*?grid-column:\s*auto;/);
assert.match(ownerCss, /\.rc-batch-strip--copy \.rc-batch-count,[\s\S]*?\.rc-batch-strip--ready \.rc-batch-count\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/);
assert.match(ownerCss, /\.rc-batch-strip--copy \.rc-batch-actions,[\s\S]*?\.rc-batch-strip--ready \.rc-batch-actions\s*\{[\s\S]*?display:\s*contents;/);
assert.match(ownerCss, /\.rc-batch-strip--copy \.rc-batch-cancel\.nb-btn,[\s\S]*?\.rc-batch-strip--copy \.rc-batch-actions > \.nb-btn,[\s\S]*?\.rc-batch-strip--image \.rc-batch-cancel\.nb-btn,[\s\S]*?\.rc-batch-strip--image \.rc-batch-actions > \.nb-btn,[\s\S]*?\.rc-batch-strip--ready \.rc-batch-cancel\.nb-btn,[\s\S]*?\.rc-batch-strip--ready \.rc-batch-actions > \.nb-btn\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*none;[\s\S]*?min-height:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*0 var\(--sp-2\);[\s\S]*?border-width:\s*1px;[\s\S]*?border-style:\s*solid;[\s\S]*?border-radius:\s*var\(--radius-s\);[\s\S]*?box-sizing:\s*border-box;[\s\S]*?align-self:\s*stretch;[\s\S]*?font-size:\s*11px;[\s\S]*?font-weight:\s*800;[\s\S]*?line-height:\s*1;[\s\S]*?white-space:\s*nowrap;/);

// Existing business actions stay wired to their established handlers.
assert.match(panel, /className="rc-batch-cancel"[\s\S]*?onClick=\{clearSelection\}/);
assert.match(panel, /className="batch-primary-action"[\s\S]*?onClick=\{\(\) => void batchApproveOnly\(\)\}/);
assert.match(panel, /className="batch-primary-action"[\s\S]*?onClick=\{\(\) => void batchStationReview\(\)\}/);
assert.match(panel, /className="batch-detail-action"[\s\S]*?onClick=\{\(\) => void batchSetGenerateDetail\(true\)\}/);
assert.match(panel, /className="batch-detail-action"[\s\S]*?onClick=\{\(\) => void batchSetGenerateDetail\(false\)\}/);
assert.match(panel, /className="batch-remove-action"[\s\S]*?onClick=\{\(\) => void batchArchiveOrUnarchive\("archive"\)\}/);
assert.match(panel, /className="batch-primary-action"[\s\S]*?onClick=\{\(\) => openStation3Modal\(\)\}/);

console.log("D3.6 mobile selection controls and station-specific equal batch geometry passed");
