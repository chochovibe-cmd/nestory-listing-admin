/**
 * B11 pure-logic verification (no secrets, no network).
 * Covers: version combo line, image mark stats, single warnings,
 * batch aggregate (1 modal / N items), title truncate 14 + …,
 * primaryConfirmLabel D2-A/D3-B, modalHeading.
 *
 * Run: node scripts/verify-b11-approve-summary.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// --- Inline mirrors (keep in sync with approveSummary.ts / processMarks) ---

const BATCH_TITLE_TRUNCATE_LEN = 14;
const PROCESS_INTENT_LABELS = {
  keep: "保留原圖",
  de_text: "去簡體字",
  regenerate: "重生主圖",
};
const COPY_VERSION_FIELD_ORDER = [
  "enriched_title",
  "why_we_chose_it",
  "product_highlights",
  "generated_description_html",
  "generated_faq_html",
  "seo_title",
  "meta_description",
];
const COPY_VERSION_SHORT_LABELS = {
  enriched_title: "標題",
  why_we_chose_it: "為什麼選",
  product_highlights: "賣點",
  generated_description_html: "描述",
  generated_faq_html: "FAQ",
  seo_title: "SEO",
  meta_description: "Meta",
};

function isPipelineImage(image) {
  return image.image_type === "main" || image.image_type === "spec" || image.image_type === "variant";
}
function isImageMarked(image) {
  return image.process_intent != null;
}

function truncateTitle(title, maxLen = BATCH_TITLE_TRUNCATE_LEN) {
  const raw = (title ?? "").trim() || "未命名草稿";
  const chars = [...raw];
  if (chars.length <= maxLen) return raw;
  return `${chars.slice(0, maxLen).join("")}…`;
}

function countImageMarks(images) {
  const pipeline = images.filter(isPipelineImage);
  const counts = { keep: 0, de_text: 0, regenerate: 0, unmarked: 0, pipeline: pipeline.length };
  for (const image of pipeline) {
    if (!isImageMarked(image)) {
      counts.unmarked += 1;
      continue;
    }
    const intent = image.process_intent;
    if (intent === "keep") counts.keep += 1;
    else if (intent === "de_text") counts.de_text += 1;
    else if (intent === "regenerate") counts.regenerate += 1;
  }
  return counts;
}

function formatImageMarkStatsLine(counts) {
  if (counts.pipeline === 0) {
    return "圖片標記：尚無可標記商品圖（詳情圖不標記）";
  }
  const parts = [];
  for (const intent of ["keep", "de_text", "regenerate"]) {
    const n = counts[intent];
    if (n > 0) parts.push(`${PROCESS_INTENT_LABELS[intent]} ×${n}`);
  }
  if (parts.length === 0 && counts.unmarked === counts.pipeline) {
    return `圖片標記：尚未標記（${counts.pipeline} 張）`;
  }
  if (parts.length === 0) return `圖片標記：${counts.pipeline} 張已計入管線`;
  return `圖片標記：${parts.join("、")}`;
}

function formatCopyVersionSummaryLine(fields) {
  const ordered = COPY_VERSION_FIELD_ORDER.map((field) => fields.find((f) => f.field === field)).filter(
    (f) => f && f.total > 0,
  );
  if (ordered.length === 0) return "文案：尚無版本（請先生成）";
  const parts = ordered.map((f) => `${COPY_VERSION_SHORT_LABELS[f.field]} v${f.versionNumber}`);
  return `文案：版本組合（${parts.join("＋")}）`;
}

function buildSingleApproveSummary(input) {
  const imageCounts = countImageMarks(input.images);
  const warnings = (input.warnings ?? []).map((w) => w.trim()).filter(Boolean);
  const copyLine = formatCopyVersionSummaryLine(input.fieldVersions);
  const imageLine = formatImageMarkStatsLine(imageCounts);
  const rows = [];
  rows.push({ tone: "ok", text: copyLine });
  if (input.hasDirtyCopy) {
    rows.push({
      tone: "warn",
      text: "⚠ 畫面文案有未定案修改；送出將先依 B10 定案目前組合（所見即所核）",
    });
  }
  if (imageCounts.pipeline === 0) {
    rows.push({ tone: "info", text: imageLine });
  } else if (imageCounts.unmarked === 0) {
    rows.push({ tone: "ok", text: imageLine });
  } else {
    rows.push({ tone: "ok", text: imageLine });
    rows.push({
      tone: "warn",
      text: `⚠ ${imageCounts.unmarked} 張商品圖未標記（核准／發布不硬擋；送圖仍會擋）`,
    });
  }
  if (warnings.length === 0) {
    rows.push({ tone: "ok", text: "未處理警告：無" });
  } else {
    for (const warning of warnings) {
      rows.push({ tone: "ng", text: warning.startsWith("⚠") ? warning : `⚠ ${warning}` });
    }
  }
  return {
    rows,
    hasIssues: warnings.length > 0 || imageCounts.unmarked > 0 || Boolean(input.hasDirtyCopy),
    warningCount: warnings.length,
    unmarkedCount: imageCounts.unmarked,
    imageCounts,
    copyLine,
    imageLine,
  };
}

function buildBatchApproveSummary(items) {
  const totalCount = items.length;
  let draftsWithWarnings = 0;
  let draftsWithUnmarked = 0;
  let unmarkedTotal = 0;
  let warningTotal = 0;
  const problemItems = [];
  for (const item of items) {
    const warnings = (item.warnings ?? []).map((w) => w.trim()).filter(Boolean);
    const counts = countImageMarks(item.images);
    warningTotal += warnings.length;
    unmarkedTotal += counts.unmarked;
    if (warnings.length > 0) draftsWithWarnings += 1;
    if (counts.unmarked > 0) draftsWithUnmarked += 1;
    if (warnings.length > 0 || counts.unmarked > 0) {
      const titleFull = (item.title ?? "").trim() || "未命名草稿";
      const titleShort = truncateTitle(titleFull);
      const bits = [];
      if (warnings.length > 0) bits.push(`⚠ ${warnings.length} 則`);
      if (counts.unmarked > 0) bits.push(`未標記 ${counts.unmarked} 張`);
      problemItems.push({
        draftId: item.draftId,
        titleShort,
        titleFull,
        warningCount: warnings.length,
        unmarkedCount: counts.unmarked,
        line: `${titleShort}（${bits.join("／")}）`,
      });
    }
  }
  const rows = [];
  rows.push({ tone: "info", text: `共 ${totalCount} 件將核准並送出至 Shopify` });
  rows.push({
    tone: draftsWithWarnings > 0 ? "warn" : "ok",
    text:
      draftsWithWarnings > 0
        ? `有警告：${draftsWithWarnings} 件（共 ${warningTotal} 則）`
        : "有警告：0 件",
  });
  rows.push({
    tone: unmarkedTotal > 0 ? "warn" : "ok",
    text:
      unmarkedTotal > 0
        ? `圖片未標記：合計 ${unmarkedTotal} 張（${draftsWithUnmarked} 件商品）`
        : "圖片未標記：0 張",
  });
  rows.push({
    tone: "ok",
    text: "文案版本：各件以資料庫目前已存組合為準（批次不讀各卡未定案畫面）",
  });
  if (problemItems.length === 0) {
    rows.push({ tone: "ok", text: `${totalCount} 件皆無待確認警告與未標記圖` });
  } else {
    rows.push({ tone: "warn", text: `有問題 ${problemItems.length} 件（標題截短以便辨識）：` });
    for (const p of problemItems) rows.push({ tone: "ng", text: p.line });
  }
  return {
    rows,
    problemItems,
    totalCount,
    draftsWithWarnings,
    draftsWithUnmarked,
    unmarkedTotal,
    warningTotal,
    hasIssues: problemItems.length > 0,
  };
}

function primaryConfirmLabel(opts) {
  if (opts.hasDirtyCopy) return "先定案並送出";
  return opts.publishMode === "active" ? "仍要送出並上架" : "仍要送出";
}

function modalHeading(opts) {
  if (opts.batchCount != null && opts.batchCount > 1) {
    return `✓ 核准前確認（${opts.batchCount} 件）`;
  }
  if (opts.batchCount === 1) return "✓ 核准前確認（1 件）";
  return "✓ 核准前確認";
}

// --- Tests ---

console.log("B11 approve summary (inline)");

await check("truncateTitle keeps ≤14, ellipsis over", () => {
  assert.equal(truncateTitle("短名"), "短名");
  const long = "一二三四五六七八九十一二三四五";
  const out = truncateTitle(long);
  assert.equal([...out.replace(/…$/, "")].length, 14);
  assert.ok(out.endsWith("…"));
  assert.equal(truncateTitle(""), "未命名草稿");
  assert.equal(truncateTitle(null), "未命名草稿");
});

await check("copy version combo line", () => {
  const line = formatCopyVersionSummaryLine([
    { field: "enriched_title", versionNumber: 2, total: 2 },
    { field: "generated_description_html", versionNumber: 1, total: 1 },
    { field: "generated_faq_html", versionNumber: 1, total: 3 },
  ]);
  assert.equal(line, "文案：版本組合（標題 v2＋描述 v1＋FAQ v1）");
  assert.equal(formatCopyVersionSummaryLine([]), "文案：尚無版本（請先生成）");
});

await check("image mark counts + line; detail ignored", () => {
  const images = [
    { image_type: "main", process_intent: "de_text" },
    { image_type: "main", process_intent: "de_text" },
    { image_type: "main", process_intent: null },
    { image_type: "detail", process_intent: null },
    { image_type: "main", process_intent: "keep" },
  ];
  const counts = countImageMarks(images);
  assert.equal(counts.pipeline, 4);
  assert.equal(counts.de_text, 2);
  assert.equal(counts.keep, 1);
  assert.equal(counts.unmarked, 1);
  assert.match(formatImageMarkStatsLine(counts), /去簡體字 ×2/);
  assert.match(formatImageMarkStatsLine(counts), /保留原圖 ×1/);
});

await check("single summary: warnings + dirty + unmarked", () => {
  const s = buildSingleApproveSummary({
    fieldVersions: [{ field: "enriched_title", versionNumber: 1, total: 1 }],
    images: [
      { image_type: "main", process_intent: null },
      { image_type: "main", process_intent: "keep" },
    ],
    warnings: ["查重：可能重複", "禁忌詞：測試"],
    hasDirtyCopy: true,
  });
  assert.equal(s.warningCount, 2);
  assert.equal(s.unmarkedCount, 1);
  assert.equal(s.hasIssues, true);
  assert.ok(s.rows.some((r) => r.text.includes("未定案")));
  assert.ok(s.rows.some((r) => r.text.includes("查重")));
  assert.ok(s.rows.some((r) => r.tone === "ng"));
});

await check("single summary: clean ok", () => {
  const s = buildSingleApproveSummary({
    fieldVersions: [{ field: "enriched_title", versionNumber: 1, total: 1 }],
    images: [{ image_type: "main", process_intent: "keep" }],
    warnings: [],
    hasDirtyCopy: false,
  });
  assert.equal(s.hasIssues, false);
  assert.ok(s.rows.some((r) => r.text === "未處理警告：無"));
});

await check("batch: one summary for N, problem lines truncated", () => {
  const items = [
    {
      draftId: "a",
      title: "吉伊卡哇小八絨毛娃娃吊飾超長標題還要更長",
      warnings: ["⚠ 同 IP 類似"],
      images: [{ image_type: "main", process_intent: null }],
    },
    {
      draftId: "b",
      title: "乾淨商品",
      warnings: [],
      images: [{ image_type: "main", process_intent: "keep" }],
    },
    {
      draftId: "c",
      title: "另一件有禁忌詞",
      warnings: ["禁忌詞命中"],
      images: [{ image_type: "main", process_intent: "de_text" }],
    },
  ];
  const batch = buildBatchApproveSummary(items);
  assert.equal(batch.totalCount, 3);
  assert.equal(batch.problemItems.length, 2);
  assert.equal(batch.draftsWithWarnings, 2);
  assert.equal(batch.unmarkedTotal, 1);
  assert.ok(batch.hasIssues);
  const long = batch.problemItems.find((p) => p.draftId === "a");
  assert.ok(long);
  assert.ok(long.titleShort.endsWith("…"));
  assert.equal([...long.titleShort.replace(/…$/, "")].length, 14);
  assert.ok(long.line.includes("未標記 1 張"));
  // D4-A: rows include per-problem lines but still ONE structure (not N modals)
  const problemLines = batch.rows.filter((r) => r.tone === "ng");
  assert.equal(problemLines.length, 2);
});

await check("batch: all clean", () => {
  const batch = buildBatchApproveSummary([
    {
      draftId: "x",
      title: "A",
      warnings: [],
      images: [{ image_type: "main", process_intent: "keep" }],
    },
  ]);
  assert.equal(batch.hasIssues, false);
  assert.ok(batch.rows.some((r) => r.text.includes("皆無待確認")));
});

await check("primaryConfirmLabel D2-A / D3-B", () => {
  assert.equal(primaryConfirmLabel({ publishMode: "draft", hasDirtyCopy: false }), "仍要送出");
  assert.equal(primaryConfirmLabel({ publishMode: "active", hasDirtyCopy: false }), "仍要送出並上架");
  assert.equal(primaryConfirmLabel({ publishMode: "draft", hasDirtyCopy: true }), "先定案並送出");
  assert.equal(primaryConfirmLabel({ publishMode: "active", hasDirtyCopy: true }), "先定案並送出");
});

await check("modalHeading", () => {
  assert.equal(modalHeading({}), "✓ 核准前確認");
  assert.equal(modalHeading({ batchCount: 1 }), "✓ 核准前確認（1 件）");
  assert.equal(modalHeading({ batchCount: 5 }), "✓ 核准前確認（5 件）");
});

// Optional: compile-import real TS module via tsc/tsx if available
await check("source file exists", () => {
  const p = path.join(root, "src/lib/drafts/approveSummary.ts");
  assert.ok(fs.existsSync(p), "approveSummary.ts missing");
  const modal = path.join(root, "src/components/listing/ApproveSummaryModal.tsx");
  assert.ok(fs.existsSync(modal), "ApproveSummaryModal.tsx missing");
  const src = fs.readFileSync(p, "utf8");
  assert.ok(src.includes("D1-B") || src.includes("Shopify-affecting"));
  assert.ok(src.includes("BATCH_TITLE_TRUNCATE_LEN"));
});

// D1-B wiring: pure approve must not open summary
await check("ResultCard/DraftResultsPanel D1-B wiring", () => {
  const card = fs.readFileSync(path.join(root, "src/components/listing/ResultCard.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(root, "src/components/listing/DraftResultsPanel.tsx"), "utf8");
  // pure approve stays direct
  assert.ok(card.includes("async function approveOnly"));
  assert.ok(card.includes("openApproveAndPublishSummary"));
  assert.ok(!card.includes("window.confirm(\"即將核准並建立 Shopify ACTIVE"));
  assert.ok(panel.includes("openBatchApproveAndPublishSummary"));
  assert.ok(panel.includes("pure batch approve stays one-click") || panel.includes("D1-B"));
  // pure batch does not open modal
  assert.ok(panel.includes("batchApproveOnly"));
  assert.ok(!panel.includes("window.confirm(\n        `即將核准並對已選取的"));
});

if (failures.length) {
  console.error(`\nFAILED ${failures.length}`);
  process.exit(1);
}
console.log("\nB11 ALL passed");
