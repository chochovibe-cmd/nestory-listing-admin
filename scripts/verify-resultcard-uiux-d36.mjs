import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/components/listing/DraftResultsPanel.tsx", "utf8");
const releaseCss = fs.readFileSync("src/app/resultcard-mobile-release.css", "utf8");
const d33Css = fs.readFileSync("src/app/d33-mobile-uiux.css", "utf8");
const finalCss = fs.readFileSync("src/app/d34b-iphone-corrective.css", "utf8");
const ownerCss = fs.readFileSync("src/app/d36-owner-ui-consistency.css", "utf8");
const failBridge = fs.readFileSync("src/components/listing/FailBatchRemoveBridge.tsx", "utf8");
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");

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

// Item B — owner batch toolbar contract.
// Copy = three equal peers in one row.
assert.doesNotMatch(releaseCss, /grid-template-columns:\s*\.82fr 1\.12fr 1\.16fr/);
assert.match(ownerCss, /\.rc-batch-strip--copy\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
assert.match(ownerCss, /\.rc-batch-strip--copy \.rc-batch-cancel\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2;/);
assert.match(ownerCss, /\.rc-batch-strip--copy \.batch-primary-action\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*2;/);
assert.match(ownerCss, /\.rc-batch-strip--copy \.batch-remove-action\s*\{[\s\S]*?grid-column:\s*3;[\s\S]*?grid-row:\s*2;/);

// Image = first row three equal thirds; second row two equal halves.
assert.match(ownerCss, /\.rc-batch-strip--image\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);/);
assert.match(ownerCss, /\.rc-batch-strip--image \.rc-batch-cancel\s*\{[\s\S]*?grid-column:\s*1 \/ 3;[\s\S]*?grid-row:\s*2;/);
assert.match(ownerCss, /\.rc-batch-strip--image \.batch-primary-action\s*\{[\s\S]*?grid-column:\s*3 \/ 5;[\s\S]*?grid-row:\s*2;/);
assert.match(ownerCss, /\.rc-batch-strip--image \.batch-remove-action:last-child\s*\{[\s\S]*?grid-column:\s*5 \/ 7;[\s\S]*?grid-row:\s*2;[\s\S]*?width:\s*100%;[\s\S]*?border-color:\s*color-mix\(in srgb, var\(--danger\) 36%, var\(--border\)\);[\s\S]*?background:\s*color-mix\(in srgb, var\(--danger\) 6%, var\(--surface\)\);[\s\S]*?color:\s*color-mix\(in srgb, var\(--danger\) 72%, var\(--text\)\);/);
assert.match(ownerCss, /\.rc-batch-strip--image \.rc-batch-actions > \.batch-detail-action:nth-child\(2\)\s*\{[\s\S]*?grid-column:\s*1 \/ 4;[\s\S]*?grid-row:\s*3;/);
assert.match(ownerCss, /\.rc-batch-strip--image \.rc-batch-actions > \.batch-detail-action:nth-child\(3\)\s*\{[\s\S]*?grid-column:\s*4 \/ 7;[\s\S]*?grid-row:\s*3;/);

// Ready and fail use two equal peers. Every station shares the same 44px geometry.
assert.match(ownerCss, /\.rc-batch-strip--ready,[\s\S]*?\.rc-batch-strip--fail\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
assert.match(ownerCss, /\.rc-batch-strip--fail \.rc-batch-cancel\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2;/);
assert.match(ownerCss, /\.rc-batch-strip--fail \.batch-remove-action\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*2;/);
assert.match(ownerCss, /\.rc-batch-strip--copy \.rc-batch-cancel\.nb-btn,[\s\S]*?\.rc-batch-strip--fail \.rc-batch-actions > \.nb-btn\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-height:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?padding:\s*0 var\(--sp-2\);[\s\S]*?border-radius:\s*var\(--radius-s\);[\s\S]*?font-size:\s*11px;[\s\S]*?font-weight:\s*800;[\s\S]*?line-height:\s*1;/);

// Existing station business handlers remain unchanged.
assert.match(panel, /className="rc-batch-cancel"[\s\S]*?onClick=\{clearSelection\}/);
assert.match(panel, /className="batch-primary-action"[\s\S]*?onClick=\{\(\) => void batchApproveOnly\(\)\}/);
assert.match(panel, /className="batch-primary-action"[\s\S]*?onClick=\{\(\) => void batchStationReview\(\)\}/);
assert.match(panel, /className="batch-detail-action"[\s\S]*?onClick=\{\(\) => void batchSetGenerateDetail\(true\)\}/);
assert.match(panel, /className="batch-detail-action"[\s\S]*?onClick=\{\(\) => void batchSetGenerateDetail\(false\)\}/);
assert.match(panel, /className="batch-remove-action"[\s\S]*?onClick=\{\(\) => void batchArchiveOrUnarchive\("archive"\)\}/);
assert.match(panel, /className="batch-primary-action"[\s\S]*?onClick=\{\(\) => openStation3Modal\(\)\}/);

// Fail filter gets only the already-existing soft-archive capability; no new
// regeneration handler or endpoint is introduced by this owner corrective.
assert.match(layout, /import \{ FailBatchRemoveBridge \} from "@\/components\/listing\/FailBatchRemoveBridge";/);
assert.match(layout, /<FailBatchRemoveBridge \/>/);
assert.match(failBridge, /KNOWN_STATION_CLASSES[\s\S]*?rc-batch-strip--copy[\s\S]*?rc-batch-strip--image[\s\S]*?rc-batch-strip--ready/);
assert.match(failBridge, /classList\.add\("rc-batch-strip--fail"\)/);
assert.match(failBridge, /\.result-card\.is-checked\[id\^="draft-card-"\]/);
assert.match(failBridge, /fetch\("\/api\/drafts\/batch\/archive"[\s\S]*?action:\s*"archive"/);
assert.match(failBridge, /className="batch-remove-action"/);
assert.match(failBridge, />\s*移出佇列\s*<\/Button>/);
assert.doesNotMatch(failBridge, /function\s+batchRegenerate|\/api\/drafts\/batch\/regenerate|onClick=\{[^}]*regenerateSelected/);

console.log("D3.6 owner mobile batch layout: copy 3, image 3+2, ready/fail 2 passed");
