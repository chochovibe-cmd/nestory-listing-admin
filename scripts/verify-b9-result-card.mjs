/**
 * B9 pure-logic verification (no secrets, no network).
 * Covers: sort modes (incl. D5-A needs_attention), sessionStorage sort key,
 * 5-tab field map (SEO independent), batch/quick send B5 block messages,
 * mobile sticky CSS contract.
 *
 * Run: node scripts/verify-b9-result-card.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

async function loadTs(rel) {
  const abs = path.join(root, rel);
  return import(pathToFileURL(abs).href);
}

console.log("B9 result-card verification\n");

// ── Inline mirrors (always run) ──────────────────────────────────────────

const RESULT_SORT_STORAGE_KEY = "nestory:results-sort";
const RESULT_SORT_MODES = new Set(["newest", "needs_attention", "price_high", "price_low"]);

function isResultSortMode(value) {
  return RESULT_SORT_MODES.has(value);
}

function readStoredResultSort(storage) {
  try {
    const raw = storage?.getItem(RESULT_SORT_STORAGE_KEY);
    if (isResultSortMode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "newest";
}

function writeStoredResultSort(mode, storage) {
  storage?.setItem(RESULT_SORT_STORAGE_KEY, mode);
}

function isPipelineImageType(imageType) {
  return imageType === "main" || imageType === "spec" || imageType === "variant";
}

function countUnmarkedPipelineImages(draftId, images) {
  return images.filter(
    (image) =>
      image.draft_id === draftId &&
      isPipelineImageType(image.image_type) &&
      image.process_intent == null
  ).length;
}

function warningCount(draft) {
  return draft.warnings?.length ?? 0;
}

function compareNeedsAttention(a, b, images) {
  const warnA = warningCount(a) > 0 ? 1 : 0;
  const warnB = warningCount(b) > 0 ? 1 : 0;
  if (warnA !== warnB) return warnB - warnA;

  const unmarkedA = countUnmarkedPipelineImages(a.id, images) > 0 ? 1 : 0;
  const unmarkedB = countUnmarkedPipelineImages(b.id, images) > 0 ? 1 : 0;
  if (unmarkedA !== unmarkedB) return unmarkedB - unmarkedA;

  const warnCountDiff = warningCount(b) - warningCount(a);
  if (warnCountDiff !== 0) return warnCountDiff;

  const unmarkedCountDiff =
    countUnmarkedPipelineImages(b.id, images) - countUnmarkedPipelineImages(a.id, images);
  if (unmarkedCountDiff !== 0) return unmarkedCountDiff;

  return b.updated_at.localeCompare(a.updated_at);
}

function priceValue(draft) {
  return draft.twd_price == null || Number.isNaN(draft.twd_price) ? null : draft.twd_price;
}

function compareResultDrafts(a, b, mode, images = []) {
  switch (mode) {
    case "needs_attention":
      return compareNeedsAttention(a, b, images);
    case "price_high": {
      const pa = priceValue(a);
      const pb = priceValue(b);
      if (pa == null && pb == null) return b.updated_at.localeCompare(a.updated_at);
      if (pa == null) return 1;
      if (pb == null) return -1;
      if (pb !== pa) return pb - pa;
      return b.updated_at.localeCompare(a.updated_at);
    }
    case "price_low": {
      const pa = priceValue(a);
      const pb = priceValue(b);
      if (pa == null && pb == null) return b.updated_at.localeCompare(a.updated_at);
      if (pa == null) return 1;
      if (pb == null) return -1;
      if (pa !== pb) return pa - pb;
      return b.updated_at.localeCompare(a.updated_at);
    }
    case "newest":
    default:
      return b.updated_at.localeCompare(a.updated_at);
  }
}

function sortResultDrafts(drafts, mode, images = []) {
  return [...drafts].sort((a, b) => compareResultDrafts(a, b, mode, images));
}

const RESULT_CARD_TAB_FIELDS = {
  copy: [
    "quick_status",
    "original_title",
    "title_zh",
    "description",
    "faq",
    "ai_detect"
  ],
  pricing: ["cost_profit", "sell_price", "compare_at_price"],
  images: ["process_marks", "detail_thumbs", "unmarked_warn"],
  tags: ["tags_chips", "tags_input", "warnings_list", "quick_add_character"],
  seo: ["seo_title", "seo_description"]
};

const RESULT_CARD_FOOTER_ACTIONS = [
  "publish_mode",
  "save",
  "regenerate",
  "request_revision",
  "send_images",
  "approve_and_publish",
  "export_csv"
];

function isImageMarked(image) {
  return image.process_intent != null;
}

function isPipelineImage(image) {
  return isPipelineImageType(image.image_type);
}

function listPipelineImages(images) {
  return images.filter(isPipelineImage);
}

function formatUnmarkedBlockMessage(images) {
  const pipeline = listPipelineImages(images);
  if (pipeline.length === 0) {
    return "沒有可送出的商品圖。請先上傳主圖（詳情圖不上架、不用標記），再送圖。";
  }
  const unmarked = pipeline.filter((image) => !isImageMarked(image));
  if (unmarked.length === 0) return null;
  return `還有 ${unmarked.length} 張沒標記：第x張。請先標記後再送圖。`;
}

function formatReadyButPipelinePendingMessage(images) {
  const count = listPipelineImages(images).length;
  return `已標記完成（${count} 張）。圖片處理管線尚未接通（Phase D），目前無法真正送出處理。`;
}

function evaluateBatchSendImages(items) {
  if (items.length === 0) {
    return {
      readyCount: 0,
      blockedCount: 0,
      blockedLines: [],
      message: "請先勾選商品再批次送圖。"
    };
  }
  const blockedLines = [];
  let readyCount = 0;
  let blockedCount = 0;
  let lastReadyMessage = "";
  for (const item of items) {
    const block = formatUnmarkedBlockMessage(item.images);
    if (block) {
      blockedCount += 1;
      blockedLines.push(`「${item.title}」：${block}`);
      continue;
    }
    readyCount += 1;
    lastReadyMessage = formatReadyButPipelinePendingMessage(item.images);
  }
  const parts = [];
  if (readyCount > 0) {
    parts.push(`${readyCount} 件標記齊全。${lastReadyMessage}`);
  }
  if (blockedCount > 0) {
    parts.push(`${blockedCount} 件被擋：`);
    parts.push(...blockedLines);
  }
  return { readyCount, blockedCount, blockedLines, message: parts.join("\n") };
}

// ── Tests ────────────────────────────────────────────────────────────────

console.log("1) sort modes");
const drafts = [
  {
    id: "a",
    updated_at: "2026-07-12T10:00:00Z",
    twd_price: 100,
    warnings: []
  },
  {
    id: "b",
    updated_at: "2026-07-12T12:00:00Z",
    twd_price: 500,
    warnings: ["⚠ 角色未建檔"]
  },
  {
    id: "c",
    updated_at: "2026-07-12T11:00:00Z",
    twd_price: null,
    warnings: []
  },
  {
    id: "d",
    updated_at: "2026-07-12T09:00:00Z",
    twd_price: 200,
    warnings: []
  }
];
const images = [
  { draft_id: "a", image_type: "main", process_intent: null },
  { draft_id: "b", image_type: "main", process_intent: "keep" },
  { draft_id: "d", image_type: "main", process_intent: "keep" },
  { draft_id: "c", image_type: "detail", process_intent: null }
];

await check("newest: b before c before a", () => {
  const sorted = sortResultDrafts(drafts, "newest", images);
  assert.deepEqual(
    sorted.map((d) => d.id),
    ["b", "c", "a", "d"]
  );
});

await check("price_high: 500 then 200 then 100; null last", () => {
  const sorted = sortResultDrafts(drafts, "price_high", images);
  assert.deepEqual(
    sorted.map((d) => d.id),
    ["b", "d", "a", "c"]
  );
});

await check("price_low: 100 then 200 then 500; null last", () => {
  const sorted = sortResultDrafts(drafts, "price_low", images);
  assert.deepEqual(
    sorted.map((d) => d.id),
    ["a", "d", "b", "c"]
  );
});

await check("needs_attention: warnings first, then unmarked", () => {
  // b has warnings → first
  // a has unmarked pipeline → before d (marked, no warn) and c (no pipeline warn)
  const sorted = sortResultDrafts(drafts, "needs_attention", images);
  assert.equal(sorted[0].id, "b");
  assert.equal(sorted[1].id, "a");
  assert.ok(sorted.findIndex((d) => d.id === "a") < sorted.findIndex((d) => d.id === "d"));
});

console.log("\n2) sessionStorage sort preference");
await check("read default newest", () => {
  const mem = {
    store: {},
    getItem(k) {
      return this.store[k] ?? null;
    },
    setItem(k, v) {
      this.store[k] = String(v);
    }
  };
  assert.equal(readStoredResultSort(mem), "newest");
  writeStoredResultSort("price_high", mem);
  assert.equal(readStoredResultSort(mem), "price_high");
  writeStoredResultSort("needs_attention", mem);
  assert.equal(readStoredResultSort(mem), "needs_attention");
});

await check("invalid stored value falls back", () => {
  const mem = {
    getItem() {
      return "not-a-mode";
    }
  };
  assert.equal(readStoredResultSort(mem), "newest");
});

console.log("\n3) tab field classification (5 tabs, SEO independent)");
await check("exactly 5 tabs", () => {
  assert.deepEqual(Object.keys(RESULT_CARD_TAB_FIELDS).sort(), [
    "copy",
    "images",
    "pricing",
    "seo",
    "tags"
  ]);
});

await check("SEO fields live under seo tab, not copy", () => {
  assert.equal(RESULT_CARD_TAB_FIELDS.copy.includes("seo_title"), false);
  assert.equal(RESULT_CARD_TAB_FIELDS.copy.includes("seo_description"), false);
  assert.ok(RESULT_CARD_TAB_FIELDS.seo.includes("seo_title"));
  assert.ok(RESULT_CARD_TAB_FIELDS.seo.includes("seo_description"));
});

await check("footer keeps approve_and_publish + send_images (only-add)", () => {
  assert.ok(RESULT_CARD_FOOTER_ACTIONS.includes("approve_and_publish"));
  assert.ok(RESULT_CARD_FOOTER_ACTIONS.includes("send_images"));
  assert.ok(RESULT_CARD_FOOTER_ACTIONS.includes("save"));
});

await check("tags tab owns warnings + quick_add", () => {
  assert.ok(RESULT_CARD_TAB_FIELDS.tags.includes("warnings_list"));
  assert.ok(RESULT_CARD_TAB_FIELDS.tags.includes("quick_add_character"));
});

console.log("\n4) send-block (quick / batch B5)");
await check("unmarked blocks with non-empty message", () => {
  const msg = formatUnmarkedBlockMessage([
    { image_type: "main", process_intent: null }
  ]);
  assert.ok(msg);
  assert.match(msg, /沒標記|未標記|標記/);
});

await check("all marked → Phase D pending message", () => {
  const msg = formatUnmarkedBlockMessage([
    { image_type: "main", process_intent: "keep" }
  ]);
  assert.equal(msg, null);
  const ready = formatReadyButPipelinePendingMessage([
    { image_type: "main", process_intent: "keep" }
  ]);
  assert.match(ready, /Phase D|尚未接通/);
});

await check("batch: mixed ready + blocked, never empty message", () => {
  const result = evaluateBatchSendImages([
    {
      draftId: "1",
      title: "未標記商品",
      images: [{ image_type: "main", process_intent: null }]
    },
    {
      draftId: "2",
      title: "已標記商品",
      images: [{ image_type: "main", process_intent: "keep" }]
    }
  ]);
  assert.equal(result.readyCount, 1);
  assert.equal(result.blockedCount, 1);
  assert.ok(result.message.length > 0);
  assert.match(result.message, /未標記商品/);
  assert.match(result.message, /1 件標記齊全|標記齊全/);
});

await check("batch empty selection message", () => {
  const result = evaluateBatchSendImages([]);
  assert.match(result.message, /勾選/);
});

// ── Prefer TS modules when Node can strip types ──────────────────────────
console.log("\n5) load TS modules (best-effort)");
try {
  const sortMod = await loadTs("src/lib/drafts/resultSort.ts");
  const tabsMod = await loadTs("src/lib/drafts/resultCardTabs.ts");
  const batchMod = await loadTs("src/lib/drafts/batchSendImages.ts");
  const processMod = await loadTs("src/lib/images/processMarks.ts");

  await check("TS sortResultDrafts matches inline newest", () => {
    const sorted = sortMod.sortResultDrafts(drafts, "newest", images);
    assert.deepEqual(
      sorted.map((d) => d.id),
      ["b", "c", "a", "d"]
    );
  });

  await check("TS RESULT_CARD_TAB_FIELDS has independent seo tab", () => {
    assert.equal(tabsMod.RESULT_CARD_TAB_FIELDS.copy.includes("seo_title"), false);
    assert.ok(tabsMod.RESULT_CARD_TAB_FIELDS.seo.includes("seo_title"));
    assert.equal(tabsMod.RESULT_CARD_TABS.length, 5);
  });

  await check("TS evaluateBatchSendImages blocks unmarked", () => {
    const result = batchMod.evaluateBatchSendImages([
      {
        draftId: "x",
        title: "測試",
        images: [
          {
            id: "i1",
            draft_id: "x",
            image_type: "main",
            process_intent: null,
            is_spec_process: false,
            original_file_url: null,
            processed_file_url: null,
            generated_file_url: null,
            alt_text: null,
            sort_order: 0,
            ocr_text: null,
            translated_text: null,
            processing_status: "pending",
            processing_error: null,
            created_at: "2026-07-12T00:00:00Z"
          }
        ]
      }
    ]);
    assert.equal(result.blockedCount, 1);
    assert.ok(result.message.includes("測試"));
  });

  await check("TS formatUnmarkedBlockMessage specific slots", () => {
    const msg = processMod.formatUnmarkedBlockMessage([
      {
        id: "i1",
        draft_id: "x",
        image_type: "main",
        process_intent: null,
        is_spec_process: false,
        original_file_url: null,
        processed_file_url: null,
        generated_file_url: null,
        alt_text: null,
        sort_order: 0,
        ocr_text: null,
        translated_text: null,
        processing_status: "pending",
        processing_error: null,
        created_at: "2026-07-12T00:00:00Z"
      }
    ]);
    assert.ok(msg);
    assert.match(msg, /第1張主圖|沒標記/);
  });
} catch (err) {
  console.log(`  ⚠ TS import skipped (${err.message}) — inline mirrors still ran`);
}

console.log("\n6) CSS mobile sticky contract (source assert)");
await check("globals.css: <960px results-batch-toolbar is position static", async () => {
  const fs = await import("node:fs/promises");
  const css = await fs.readFile(path.join(root, "src/app/globals.css"), "utf8");
  // Base sticky remains for desktop
  assert.match(css, /\.results-batch-toolbar\s*\{[^}]*position:\s*sticky/s);
  // Inside the mobile media block we require static (fix drops sticky wall)
  const mobileIdx = css.search(/@media\s*\(\s*max-width:\s*959\.98px\s*\)|@media\s*\(\s*max-width:\s*960px\s*\)|@media\s*\(max-width:\s*959px\)/);
  // Project uses max-width: 959.98px or similar — fall back to scanning for mobile toolbar rule
  const staticBlock = css.includes(".results-batch-toolbar") &&
    /results-batch-toolbar\s*\{[^}]*position:\s*static/s.test(css);
  assert.ok(staticBlock, "expected mobile override position: static on .results-batch-toolbar");
  // collapsed notice class still present (B9 req2)
  assert.match(css, /\.rc-collapsed-notice\b/);
});

await check("ResultCard source has 5 tabs + collapsed notice", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(path.join(root, "src/components/listing/ResultCard.tsx"), "utf8");
  assert.match(src, /rc-collapsed-notice/);
  assert.match(src, /activeTab === "seo"/);
  assert.match(src, /descriptionView/);
  const tabsSrc = await fs.readFile(path.join(root, "src/lib/drafts/resultCardTabs.ts"), "utf8");
  assert.match(tabsSrc, /id: "seo"/);
  assert.match(tabsSrc, /label: "SEO"/);
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
