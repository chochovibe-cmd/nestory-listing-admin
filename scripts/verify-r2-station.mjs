/**
 * R2 pure-logic + wiring checks (no secrets, no network).
 * Mirrors stationRoute / warningTiers / processMarks / approveCopy.
 *
 * Run: node scripts/verify-r2-station.mjs
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

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// --- Inline mirrors ---

function isPipelineImage(image) {
  return image.image_type === "main" || image.image_type === "spec" || image.image_type === "variant";
}

function countImageMarkSummary(images) {
  const pipeline = images.filter(isPipelineImage);
  const marks = {
    keep: 0,
    to_trad: 0,
    de_text: 0,
    regenerate: 0,
    unmarked: 0,
    pipeline: pipeline.length,
    aiCount: 0
  };
  for (const img of pipeline) {
    const intent = img.process_intent;
    if (intent == null) marks.unmarked += 1;
    else if (intent === "keep") marks.keep += 1;
    else if (intent === "to_trad") {
      marks.to_trad += 1;
      marks.aiCount += 1;
    } else if (intent === "de_text") {
      marks.de_text += 1;
      marks.aiCount += 1;
    } else if (intent === "regenerate") {
      marks.regenerate += 1;
      marks.aiCount += 1;
    }
  }
  return marks;
}

function decideStation2Review(images) {
  const pipeline = images.filter(isPipelineImage);
  if (pipeline.length === 0) {
    return { action: "blocked", reason: "no images" };
  }
  const marks = countImageMarkSummary(images);
  if (marks.unmarked > 0) return { action: "blocked", reason: "unmarked" };
  const allKeep = marks.aiCount === 0;
  return { action: "send_images", allKeep, aiCount: marks.aiCount, marks };
}

const SUGGEST_PATTERNS = [/使用情境/, /推薦標籤/, /網搜/, /建議/];
const BLOCK_PATTERNS = [/尚未建立/, /必填/, /成本不齊/];

function gradeWarningText(raw) {
  const text = raw.replace(/^[⚠⛔🔍\s]+/, "").trim();
  for (const re of BLOCK_PATTERNS) if (re.test(text)) return "block";
  for (const re of SUGGEST_PATTERNS) if (re.test(text)) return "suggest";
  return "confirm";
}

console.log("R2 station checks\n");

check("files exist", () => {
  for (const f of [
    "src/lib/drafts/stationFilter.ts",
    "src/lib/drafts/stationRoute.ts",
    "src/lib/drafts/warningTiers.ts",
    "src/lib/drafts/approveCopy.ts",
    "src/components/listing/RegenCopyModal.tsx",
    "src/components/listing/LockedCopyPreview.tsx",
    "supabase/migrations/030_process_intent_to_trad.sql"
  ]) {
    assert.ok(exists(f), `missing ${f}`);
  }
});

check("030 adds to_trad check", () => {
  const sql = read("supabase/migrations/030_process_intent_to_trad.sql");
  assert.match(sql, /to_trad/);
  assert.match(sql, /product_images_process_intent_check/);
});

check("domain ImageProcessIntent includes to_trad", () => {
  assert.match(read("src/types/domain.ts"), /to_trad/);
});

check("processMarks labels R2", () => {
  const src = read("src/lib/images/processMarks.ts");
  assert.match(src, /to_trad:\s*"簡轉繁"/);
  assert.match(src, /de_text:\s*"去字"/);
  assert.match(src, /regenerate:\s*"重生"/);
});

check("approve applies default keep", () => {
  const single = read("src/app/api/drafts/[id]/approve/route.ts");
  const batch = read("src/app/api/drafts/batch/approve/route.ts");
  assert.match(single, /applyDefaultKeepMarks/);
  assert.match(batch, /applyDefaultKeepMarks/);
});

check("all-keep advances to ready", () => {
  const src = read("src/lib/images/sendImagesAutoChain.ts");
  assert.match(src, /advanceDraftToReadyStation/);
  assert.match(src, /pipeline_stage:\s*"ready"/);
});

check("review-confirm → ready", () => {
  assert.match(read("src/app/api/images/review-confirm/route.ts"), /pipeline_stage:\s*"ready"/);
});

check("to_trad honest skip in runAiProcess", () => {
  const src = read("src/lib/images/runAiProcess.ts");
  assert.match(src, /to_trad/);
  assert.match(src, /not implemented|尚未支援|誠實/);
});

check("nav 生圖工廠", () => {
  const nav = read("src/lib/nav.ts");
  assert.match(nav, /生圖工廠/);
  assert.doesNotMatch(nav, /label: "圖片審核"/);
});

check("station filter three stations", () => {
  const src = read("src/lib/drafts/stationFilter.ts");
  assert.match(src, /文案審核/);
  assert.match(src, /圖片審核/);
  assert.match(src, /完成待發布/);
});

check("inline: all keep decision", () => {
  const d = decideStation2Review([
    { image_type: "main", process_intent: "keep" },
    { image_type: "main", process_intent: "keep" }
  ]);
  assert.equal(d.action, "send_images");
  assert.equal(d.allKeep, true);
  assert.equal(d.aiCount, 0);
});

check("inline: AI count to_trad+de_text", () => {
  const d = decideStation2Review([
    { image_type: "main", process_intent: "keep" },
    { image_type: "main", process_intent: "to_trad" },
    { image_type: "main", process_intent: "de_text" }
  ]);
  assert.equal(d.aiCount, 2);
  assert.equal(d.allKeep, false);
});

check("inline: unmarked blocks", () => {
  const d = decideStation2Review([{ image_type: "main", process_intent: null }]);
  assert.equal(d.action, "blocked");
});

check("inline: warning tiers", () => {
  assert.equal(gradeWarningText("建議補強使用情境"), "suggest");
  assert.equal(gradeWarningText("角色尚未建立 V2 字典"), "block");
  assert.equal(gradeWarningText("售價請人工確認"), "confirm");
});

check("ResultCard station wiring", () => {
  const src = read("src/components/listing/ResultCard.tsx");
  assert.match(src, /stationReview/);
  assert.match(src, /RegenCopyModal/);
  assert.match(src, /hasBlockingWarnings/);
  assert.match(src, /tryToggleExpand/);
});

check("DraftResultsPanel station toolbar", () => {
  const src = read("src/components/listing/DraftResultsPanel.tsx");
  assert.match(src, /batchStationReview/);
  assert.match(src, /isCopyStation/);
  assert.match(src, /isReadyStation/);
  assert.match(src, /移出佇列/);
});

if (failures.length) {
  console.error(`\nFAILED ${failures.length}`);
  process.exit(1);
}
console.log("\nALL passed");
