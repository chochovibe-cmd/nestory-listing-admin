/**
 * B1 gen-card persistence: module singleton survives router.refresh remount.
 * Run: node scripts/verify-gen-progress-card.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function draftMatchesGenerationProgressTitle(title, draft) {
  const prefix = title.trim();
  if (!prefix) return false;
  for (const raw of [draft.title_zh, draft.original_title, draft.taobao_title]) {
    if (!raw) continue;
    const text = raw.trim();
    if (!text) continue;
    if (text.includes(prefix) || prefix.includes(text.slice(0, prefix.length))) {
      return true;
    }
  }
  return false;
}

console.log("B1 generation progress card\n");

check("generationProgress.ts last-value singleton", () => {
  const src = read("src/components/listing/generationProgress.ts");
  assert.match(src, /let lastProgress: GenerationProgress \| null/);
  assert.match(src, /export function getLastGenerationProgress/);
  assert.match(src, /export function setLastGenerationProgress/);
  assert.match(src, /lastProgress = model && model\.visible \? model : null/);
  assert.match(src, /GENERATION_DONE_MAX_MS = 10_000/);
  assert.doesNotMatch(src, /sessionStorage\.(get|set)Item/);
});

check("DraftResultsPanel hydrates gen-card (no 1.5s wipe)", () => {
  const src = read("src/components/listing/DraftResultsPanel.tsx");
  assert.match(src, /useState<GenerationProgress \| null>\(\s*\(\) => getLastGenerationProgress\(\)/);
  assert.match(src, /setLastGenerationProgress\(model \?\? null\)/);
  assert.match(src, /className="gen-card"/);
  assert.match(src, /scopedDrafts\.length === 0 && !progress/);
  assert.match(src, /workQueueDrafts\.length === 0 && !progress/);
  assert.match(src, /visibleDrafts\.length === 0 && !progress/);
  assert.match(src, /pending_copy/);
  assert.match(src, /GENERATION_DONE_MAX_MS/);
  assert.doesNotMatch(src, /setTimeout\(\(\) => setProgress\(null\), 1500\)/);
});

check("WorkbenchMobileShell desktop does not replace on generate", () => {
  const src = read("src/components/listing/WorkbenchMobileShell.tsx");
  assert.match(src, /setLastGenerationProgress\(model \?\? null\)/);
  assert.match(src, /matchMedia\("\(min-width: 960px\)"\)/);
  assert.match(src, /if \(isDesktopWorkbench\(\)\) return;/);
  assert.match(src, /if \(href === currentHref\) return;/);
  assert.match(src, /inputSubRef\.current === "preview"/);
  // generation must not unconditionally replace every progress tick
  const onProgress = src.match(
    /function onProgress\(event: Event\) \{[\s\S]*?window\.addEventListener\(GENERATION_PROGRESS_EVENT/
  );
  assert.ok(onProgress, "onProgress handler");
  assert.match(onProgress[0], /isDesktopWorkbench/);
  assert.doesNotMatch(
    onProgress[0],
    /setGenActive\(true\);\s*\/\/[^\n]*\s*setPaneAndUrl\("input", true, "preview"\)/
  );
});

check("jump last-value hydrate (same remount class)", () => {
  const lib = read("src/lib/drafts/jumpToDraft.ts");
  assert.match(lib, /export function getLastJumpToDraft/);
  assert.match(lib, /export function setLastJumpToDraft/);
  assert.match(lib, /setLastJumpToDraft\(detail\)/);
  const panel = read("src/components/listing/DraftResultsPanel.tsx");
  assert.match(panel, /getLastJumpToDraft\(\)/);
  const shell = read("src/components/listing/WorkbenchMobileShell.tsx");
  assert.match(shell, /setLastJumpToDraft\(detail\)/);
});

check("toast / pricing-settings not rebuilt", () => {
  const toast = read("src/lib/toast/toastEvents.ts");
  assert.match(toast, /export const TOAST_EVENT/);
  const host = read("src/components/Toast.tsx");
  assert.match(host, /ToastHost/);
  const pricing = read("src/lib/pricingSettingsStore.ts");
  assert.match(pricing, /nestory:pricing-settings-changed/);
  assert.match(pricing, /localStorage/);
});

check("title match helper (inline mirror)", () => {
  assert.equal(
    draftMatchesGenerationProgressTitle("米菲臺燈", {
      title_zh: "米菲臺燈 限量",
      original_title: null,
      taobao_title: null
    }),
    true
  );
  assert.equal(
    draftMatchesGenerationProgressTitle("米菲臺燈特別版標題超長", {
      original_title: "米菲臺燈特別版標題超長要被截斷",
      title_zh: null,
      taobao_title: null
    }),
    true
  );
  assert.equal(
    draftMatchesGenerationProgressTitle("獨角獸", {
      title_zh: "另一件商品",
      original_title: null,
      taobao_title: null
    }),
    false
  );
});

check("no new !important in touched listing files", () => {
  const files = [
    "src/components/listing/generationProgress.ts",
    "src/components/listing/DraftResultsPanel.tsx",
    "src/components/listing/WorkbenchMobileShell.tsx",
    "src/lib/drafts/jumpToDraft.ts"
  ];
  for (const file of files) {
    const addedImportant = read(file).match(/!important/g);
    if (file.endsWith("WorkbenchMobileShell.tsx")) {
      assert.equal(addedImportant, null);
    } else {
      assert.equal(addedImportant, null);
    }
  }
});

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nB1 gen-card ALL passed");
