/**
 * B14 pure-logic + static verification (no secrets, no network).
 * Covers: ready/blocked gate, regenerate count (4A), snapshot shape,
 * success message, migration 025 keys, API + UI wiring markers.
 *
 * Run: node scripts/verify-b14-image-batch.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// --- Inline mirrors (keep in sync with processMarks + createImageBatch) ---

function isPipelineImage(image) {
  return image.image_type === "main" || image.image_type === "spec" || image.image_type === "variant";
}

function sortPipelineImages(images) {
  return [...images].sort((a, b) => {
    const orderA = a.sort_order ?? 0;
    const orderB = b.sort_order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

function listPipelineImages(images) {
  return sortPipelineImages(images.filter(isPipelineImage));
}

function isImageMarked(image) {
  return image.process_intent != null;
}

function imageSlotLabel(image, position1Based) {
  let base;
  if (image.image_type === "variant") base = `第${position1Based}張款式圖`;
  else if (image.image_type === "main" && position1Based === 1) base = `第${position1Based}張主圖`;
  else base = `第${position1Based}張商品圖`;
  if (image.is_spec_process || image.image_type === "spec") return `${base}（規格圖）`;
  return base;
}

function formatUnmarkedBlockMessage(images) {
  const pipeline = listPipelineImages(images);
  if (pipeline.length === 0) {
    return "沒有可送出的商品圖。請先上傳主圖（詳情圖不上架、不用標記），再送圖。";
  }
  const unmarked = pipeline.filter((image) => !isImageMarked(image));
  if (unmarked.length === 0) return null;
  const labels = unmarked.map((image) => {
    const position = pipeline.findIndex((row) => row.id === image.id) + 1;
    return imageSlotLabel(image, position);
  });
  return `還有 ${unmarked.length} 張沒標記：${labels.join("、")}。請先為每張選「保留原圖／去簡體字／重生主圖」後再送圖。`;
}

function formatImageBatchCreatedMessage(readyCount) {
  return `已建立送圖批次（${readyCount} 件），處理管線 Phase D 接通後自動執行`;
}

function draftHasRegenerateMark(images) {
  return images.some((img) => isPipelineImage(img) && img.process_intent === "regenerate");
}

function buildDraftSnapshot(item) {
  const pipeline = listPipelineImages(item.images);
  return {
    draftId: item.draftId,
    title: item.title,
    images: pipeline.map((img) => ({
      imageId: img.id,
      imageType: img.image_type,
      processIntent: img.process_intent,
      isSpecProcess: Boolean(img.is_spec_process),
      sortOrder: img.sort_order ?? 0
    }))
  };
}

function evaluateCreateImageBatch(items) {
  if (items.length === 0) {
    return {
      ready: [],
      blocked: [],
      readyCount: 0,
      blockedCount: 0,
      regenerateItemCount: 0,
      snapshot: [],
      emptyMessage: "請先勾選商品再批次送圖。"
    };
  }
  const ready = [];
  const blocked = [];
  for (const item of items) {
    const reason = formatUnmarkedBlockMessage(item.images);
    if (reason) {
      blocked.push({ draftId: item.draftId, title: item.title, reason });
      continue;
    }
    ready.push(item);
  }
  const snapshot = ready.map(buildDraftSnapshot);
  const regenerateItemCount = ready.filter((item) => draftHasRegenerateMark(item.images)).length;
  let emptyMessage = null;
  if (ready.length === 0) {
    emptyMessage = [
      "0 件可建立送圖批次。",
      `${blocked.length} 件被擋：`,
      ...blocked.map((b) => `「${b.title}」：${b.reason}`)
    ].join("\n");
  }
  return {
    ready,
    blocked,
    readyCount: ready.length,
    blockedCount: blocked.length,
    regenerateItemCount,
    snapshot,
    emptyMessage
  };
}

function formatCreateImageBatchResponseMessage(evaluated) {
  if (evaluated.readyCount === 0) {
    return evaluated.emptyMessage ?? "無法建立送圖批次。";
  }
  const blockedLines = evaluated.blocked.map((b) => `「${b.title}」：${b.reason}`);
  if (blockedLines.length === 0) return formatImageBatchCreatedMessage(evaluated.readyCount);
  return [
    formatImageBatchCreatedMessage(evaluated.readyCount),
    `${blockedLines.length} 件被擋：`,
    ...blockedLines
  ].join("\n");
}

function img(partial) {
  return {
    id: partial.id,
    image_type: partial.image_type ?? "main",
    process_intent: partial.process_intent ?? null,
    is_spec_process: partial.is_spec_process ?? false,
    sort_order: partial.sort_order ?? 0,
    created_at: partial.created_at ?? "2026-07-12T00:00:00Z"
  };
}

console.log("\nB14 image batch verification\n");

await check("empty selection → no batch message", () => {
  const r = evaluateCreateImageBatch([]);
  assert.equal(r.readyCount, 0);
  assert.match(r.emptyMessage, /請先勾選/);
});

await check("all unmarked → no ready, blocked reasons", () => {
  const r = evaluateCreateImageBatch([
    {
      draftId: "d1",
      title: "商品甲",
      images: [img({ id: "i1", process_intent: null })]
    }
  ]);
  assert.equal(r.readyCount, 0);
  assert.equal(r.blockedCount, 1);
  assert.match(r.blocked[0].reason, /沒標記/);
  assert.match(formatCreateImageBatchResponseMessage(r), /0 件可建立/);
});

await check("detail-only images → blocked (no pipeline)", () => {
  const r = evaluateCreateImageBatch([
    {
      draftId: "d1",
      title: "只有詳情",
      images: [img({ id: "i1", image_type: "detail", process_intent: "keep" })]
    }
  ]);
  assert.equal(r.readyCount, 0);
  assert.match(r.blocked[0].reason, /沒有可送出的商品圖/);
});

await check("all marked → ready batch message (B14 copy)", () => {
  const r = evaluateCreateImageBatch([
    {
      draftId: "d1",
      title: "商品甲",
      images: [
        img({ id: "i1", process_intent: "keep" }),
        img({ id: "i2", image_type: "main", process_intent: "de_text", sort_order: 1 })
      ]
    },
    {
      draftId: "d2",
      title: "商品乙",
      images: [img({ id: "i3", process_intent: "regenerate" })]
    }
  ]);
  assert.equal(r.readyCount, 2);
  assert.equal(r.blockedCount, 0);
  assert.equal(
    formatCreateImageBatchResponseMessage(r),
    "已建立送圖批次（2 件），處理管線 Phase D 接通後自動執行"
  );
});

await check("4A regenerate_item_count = drafts with ≥1 regenerate", () => {
  const r = evaluateCreateImageBatch([
    {
      draftId: "d1",
      title: "有重生",
      images: [
        img({ id: "a", process_intent: "regenerate" }),
        img({ id: "b", process_intent: "regenerate", sort_order: 1 })
      ]
    },
    {
      draftId: "d2",
      title: "無重生",
      images: [img({ id: "c", process_intent: "keep" })]
    }
  ]);
  // two regenerate images on one draft still count as 1 item
  assert.equal(r.regenerateItemCount, 1);
});

await check("snapshot_json lightweight: process intents frozen per image", () => {
  const r = evaluateCreateImageBatch([
    {
      draftId: "d1",
      title: "快照商品",
      images: [
        img({ id: "img-1", process_intent: "keep", sort_order: 0 }),
        img({
          id: "img-2",
          process_intent: "de_text",
          is_spec_process: true,
          sort_order: 1
        }),
        img({ id: "det", image_type: "detail", process_intent: "keep" }) // excluded
      ]
    }
  ]);
  assert.equal(r.snapshot.length, 1);
  assert.equal(r.snapshot[0].draftId, "d1");
  assert.equal(r.snapshot[0].images.length, 2);
  assert.deepEqual(
    r.snapshot[0].images.map((x) => x.processIntent),
    ["keep", "de_text"]
  );
  assert.equal(r.snapshot[0].images[1].isSpecProcess, true);
  assert.equal(
    r.snapshot[0].images.some((x) => x.imageId === "det"),
    false
  );
});

await check("partial ready + blocked message", () => {
  const r = evaluateCreateImageBatch([
    {
      draftId: "ok",
      title: "OK",
      images: [img({ id: "1", process_intent: "keep" })]
    },
    {
      draftId: "bad",
      title: "BAD",
      images: [img({ id: "2", process_intent: null })]
    }
  ]);
  assert.equal(r.readyCount, 1);
  assert.equal(r.blockedCount, 1);
  const msg = formatCreateImageBatchResponseMessage(r);
  assert.match(msg, /已建立送圖批次（1 件）/);
  assert.match(msg, /1 件被擋/);
  assert.match(msg, /「BAD」/);
});

await check("single-item ready (1A) message uses count 1", () => {
  const r = evaluateCreateImageBatch([
    {
      draftId: "solo",
      title: "單件",
      images: [img({ id: "1", process_intent: "keep" })]
    }
  ]);
  assert.equal(formatCreateImageBatchResponseMessage(r), formatImageBatchCreatedMessage(1));
});

// --- Static file checks ---

await check("migration 025 has required tables/columns", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/025_image_batches.sql"),
    "utf8"
  );
  for (const needle of [
    "create table if not exists public.image_batches",
    "create table if not exists public.image_batch_items",
    "snapshot_json",
    "regenerate_item_count",
    "notify_sent_at",
    "stuck_notified_at",
    "current_image_batch_id",
    "enable row level security",
    "grant select, insert on public.image_batches"
  ]) {
    assert.ok(sql.includes(needle), `missing in 025: ${needle}`);
  }
  // 2A honesty: migration comments must not force image_status change
  assert.match(sql, /image_status[\s\S]{0,80}NOT changed|NOT changed[\s\S]{0,80}image_status/i);
});

await check("API route exists and uses service insert + 2A guards", () => {
  const src = fs.readFileSync(
    path.join(root, "src/app/api/drafts/batch/send-images/route.ts"),
    "utf8"
  );
  assert.match(src, /from\("image_batches"\)/);
  assert.match(src, /from\("image_batch_items"\)/);
  assert.match(src, /current_image_batch_id/);
  assert.match(src, /snapshot_json/);
  assert.match(src, /evaluateCreateImageBatch/);
  assert.doesNotMatch(src, /image_status:\s*["']processing["']/);
  // Comments may mention Make webhook; ensure we do not call one
  assert.doesNotMatch(src, /fetch\s*\(\s*['"`]https?:\/\/.*make/i);
  assert.doesNotMatch(src, /callMake|MAKE_WEBHOOK|make\.com/i);
});

await check("UI wires batch + single send to API (1A)", () => {
  const panel = fs.readFileSync(
    path.join(root, "src/components/listing/DraftResultsPanel.tsx"),
    "utf8"
  );
  const card = fs.readFileSync(
    path.join(root, "src/components/listing/ResultCard.tsx"),
    "utf8"
  );
  assert.match(panel, /\/api\/drafts\/batch\/send-images/);
  assert.match(card, /\/api\/drafts\/batch\/send-images/);
  assert.match(card, /draftIds:\s*\[draft\.id\]/);
});

await check("createImageBatch lib exports message helpers", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/drafts/createImageBatch.ts"), "utf8");
  assert.match(src, /formatImageBatchCreatedMessage/);
  assert.match(src, /buildDraftSnapshot/);
  assert.match(src, /draftHasRegenerateMark/);
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
