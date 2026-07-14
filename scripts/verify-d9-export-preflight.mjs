/**
 * D9-open verification (no secrets / no live export).
 *
 * - Pure preflight rules: error vs warn severity
 * - Showmore no image = error; Matrixify no image = warn
 * - Showmore sell preview uses same markup+beautify as export
 * - Static wiring: modal, panels, preflight API, no force on export route
 *
 * Run: node scripts/verify-d9-export-preflight.mjs
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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// ── Inline mirrors of nestoryPrice + showmorePricing + exportPreflight ──

const LOW_TIER_PRICES = [99, 129, 149, 169, 199, 229, 249, 299];
const MID_TIER_PRICES = [329, 349, 399, 449, 499, 549, 599, 699, 799, 899];
const HIGH_TIER_PRICES = [
  980, 990, 999, 1080, 1099, 1180, 1199, 1280, 1299, 1580, 1680, 2280, 4480
];

function nearestAtOrAbove(tier, rawPrice, extensionStep) {
  const candidate = tier.find((price) => price >= rawPrice);
  if (candidate !== undefined) return candidate;
  let extended = tier[tier.length - 1];
  while (extended < rawPrice) extended += extensionStep;
  return extended;
}

function beautifyNestoryPrice(rawPrice) {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 0;
  const basePrice = Math.ceil(rawPrice);
  if (basePrice < 300) return nearestAtOrAbove(LOW_TIER_PRICES, basePrice, 50);
  if (basePrice <= 900) return nearestAtOrAbove(MID_TIER_PRICES, basePrice, 100);
  return nearestAtOrAbove(HIGH_TIER_PRICES, basePrice, 1000);
}

function nextBeautifiedPriceAbove(price) {
  if (!Number.isFinite(price) || price < 0) return beautifyNestoryPrice(1);
  const candidate = beautifyNestoryPrice(Math.floor(price) + 1);
  if (candidate > price) return candidate;
  return beautifyNestoryPrice(candidate + 1);
}

const DEFAULT_SHOWMORE_MARKUP_PERCENT = 5;
const EXPORTABLE = new Set(["approved", "api_failed", "csv_ready"]);

function normalizeShowmoreMarkupPercent(value) {
  if (value == null || value === "") return DEFAULT_SHOWMORE_MARKUP_PERCENT;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SHOWMORE_MARKUP_PERCENT;
  return Math.min(100, Math.max(0, n));
}

function applyShowmoreMarkup(price, markupPercent) {
  if (price == null || !Number.isFinite(Number(price))) return "";
  const base = Number(price);
  if (base <= 0) return "";
  const pct = normalizeShowmoreMarkupPercent(markupPercent);
  return beautifyNestoryPrice(base * (1 + pct / 100));
}

function applyShowmoreCompareAt(compareAt, sellPriceShowmore, markupPercent) {
  if (compareAt == null || !Number.isFinite(Number(compareAt))) return "";
  const base = Number(compareAt);
  if (base <= 0) return "";
  let marked = applyShowmoreMarkup(base, markupPercent);
  if (marked === "") return "";
  if (typeof sellPriceShowmore === "number" && sellPriceShowmore > 0 && marked <= sellPriceShowmore) {
    marked = nextBeautifiedPriceAbove(sellPriceShowmore);
  }
  return marked;
}

function pickImages(images) {
  return (images ?? [])
    .filter((i) => i.image_type !== "spec")
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function imageUrl(image) {
  if (!image) return "";
  return image.processed_file_url || image.original_file_url || "";
}

function hasProductImage(images) {
  return pickImages(images).some((i) => Boolean(imageUrl(i)));
}

function draftTitle(d) {
  return (
    String(d.title_zh ?? "").trim() ||
    String(d.taobao_title ?? "").trim() ||
    String(d.original_title ?? "").trim() ||
    ""
  );
}

function runExportPreflight(drafts, options) {
  const kind = options.kind;
  const markupPercent =
    kind === "showmore"
      ? normalizeShowmoreMarkupPercent(options.showmoreMarkupPercent ?? 5)
      : null;

  const errorMessages = [];
  const warningMessages = [];
  const infoMessages = [];

  if (!drafts.length) {
    errorMessages.push("未選擇任何商品");
  }

  const items = drafts.map((draft) => {
    const issues = [];
    const title = draftTitle(draft);
    if (!title) issues.push({ level: "error", code: "title_empty", message: "標題空白" });
    const hasSell =
      draft.twd_price != null &&
      Number.isFinite(Number(draft.twd_price)) &&
      Number(draft.twd_price) > 0;
    if (!hasSell) issues.push({ level: "error", code: "price_empty", message: "無售價" });
    if (!EXPORTABLE.has(draft.status)) {
      issues.push({ level: "error", code: "status_not_exportable", message: "狀態不可匯出" });
    }
    if (!hasProductImage(draft.product_images)) {
      if (kind === "showmore") {
        issues.push({ level: "error", code: "image_empty", message: "無商品圖" });
      } else {
        issues.push({ level: "warn", code: "image_empty", message: "無商品圖" });
      }
    }
    if (
      !(String(draft.description_html ?? "").trim() || String(draft.description_plain ?? "").trim())
    ) {
      issues.push({ level: "warn", code: "description_empty", message: "商品介紹空白" });
    }
    if (
      draft.twd_cost == null ||
      !Number.isFinite(Number(draft.twd_cost)) ||
      Number(draft.twd_cost) <= 0
    ) {
      issues.push({ level: "warn", code: "cost_empty", message: "缺成本" });
    }

    let sellPriceDisplay = null;
    let compareAtDisplay = null;
    if (hasSell) {
      if (kind === "showmore") {
        const sell = applyShowmoreMarkup(Number(draft.twd_price), markupPercent);
        sellPriceDisplay = typeof sell === "number" ? sell : null;
        const compare = applyShowmoreCompareAt(
          draft.compare_at_price,
          sell,
          markupPercent
        );
        compareAtDisplay = typeof compare === "number" ? compare : null;
      } else {
        sellPriceDisplay = Number(draft.twd_price);
        if (draft.compare_at_price != null && Number(draft.compare_at_price) > 0) {
          compareAtDisplay = Number(draft.compare_at_price);
        }
      }
    }

    for (const issue of issues) {
      const line = `${title || "未命名"}：${issue.message}`;
      if (issue.level === "error") errorMessages.push(line);
      else if (issue.level === "warn") warningMessages.push(line);
    }

    return {
      draftId: draft.id,
      sellPriceDisplay,
      compareAtDisplay,
      issues,
      hasError: issues.some((i) => i.level === "error"),
      hasWarn: issues.some((i) => i.level === "warn")
    };
  });

  if (kind === "showmore" && drafts.length > 0) {
    infoMessages.push("庫存 999／重量 0.1kg 為預設；上傳前請在 Showmore 確認");
  }

  const hasErrors = errorMessages.length > 0;
  return {
    kind,
    markupPercent,
    items,
    errorMessages,
    warningMessages,
    infoMessages,
    errorCount: errorMessages.length,
    warnCount: warningMessages.length,
    infoCount: infoMessages.length,
    hasErrors,
    hasWarnings: warningMessages.length > 0,
    canExport: !hasErrors && drafts.length > 0
  };
}

function baseDraft(over = {}) {
  return {
    id: "d1",
    title_zh: "測試商品",
    status: "approved",
    twd_price: 1000,
    twd_cost: 200,
    compare_at_price: 1200,
    price_mode: "sale",
    description_html: "介紹文字",
    description_plain: null,
    variant_dimensions: null,
    product_images: [
      {
        image_type: "main",
        processed_file_url: "https://cdn.example/a.webp",
        original_file_url: "https://storage.example/a.jpg",
        sort_order: 0
      }
    ],
    ...over
  };
}

console.log("D9-open export preflight checks\n");

// ── Pure rules ───────────────────────────────────────────────────────────

await check("empty selection → error, cannot export", () => {
  const r = runExportPreflight([], { kind: "showmore" });
  assert.equal(r.canExport, false);
  assert.equal(r.hasErrors, true);
  assert.ok(r.errorMessages.some((m) => m.includes("未選擇")));
});

await check("healthy showmore → canExport; info about defaults only", () => {
  const r = runExportPreflight([baseDraft()], {
    kind: "showmore",
    showmoreMarkupPercent: 5
  });
  assert.equal(r.canExport, true);
  assert.equal(r.hasErrors, false);
  assert.equal(r.hasWarnings, false);
  assert.ok(r.infoCount >= 1);
  assert.ok(r.infoMessages[0].includes("999"));
});

await check("title empty → error", () => {
  const r = runExportPreflight(
    [baseDraft({ title_zh: "", taobao_title: "", original_title: "" })],
    { kind: "showmore" }
  );
  assert.equal(r.canExport, false);
  assert.ok(r.errorMessages.some((m) => m.includes("標題")));
});

await check("no price → error", () => {
  const r = runExportPreflight([baseDraft({ twd_price: null })], { kind: "matrixify" });
  assert.equal(r.canExport, false);
  assert.ok(r.errorMessages.some((m) => m.includes("售價")));
});

await check("status pending_input → error", () => {
  const r = runExportPreflight([baseDraft({ status: "pending_input" })], {
    kind: "showmore"
  });
  assert.equal(r.canExport, false);
  assert.ok(r.errorMessages.some((m) => m.includes("狀態")));
});

await check("Showmore no image → error", () => {
  const r = runExportPreflight([baseDraft({ product_images: [] })], {
    kind: "showmore"
  });
  assert.equal(r.canExport, false);
  assert.ok(r.items[0].issues.some((i) => i.code === "image_empty" && i.level === "error"));
});

await check("Matrixify no image → warn only (can export)", () => {
  const r = runExportPreflight([baseDraft({ product_images: [] })], {
    kind: "matrixify"
  });
  assert.equal(r.canExport, true);
  assert.equal(r.hasWarnings, true);
  assert.ok(r.items[0].issues.some((i) => i.code === "image_empty" && i.level === "warn"));
});

await check("missing cost → warn not error", () => {
  const r = runExportPreflight([baseDraft({ twd_cost: null })], { kind: "showmore" });
  assert.equal(r.canExport, true);
  assert.equal(r.hasWarnings, true);
  assert.ok(r.warningMessages.some((m) => m.includes("成本")));
});

await check("empty description → warn", () => {
  const r = runExportPreflight(
    [baseDraft({ description_html: "", description_plain: "" })],
    { kind: "matrixify" }
  );
  assert.equal(r.canExport, true);
  assert.ok(r.warningMessages.some((m) => m.includes("介紹") || m.includes("空白")));
});

await check("spec-only images count as no product image (Showmore error)", () => {
  const r = runExportPreflight(
    [
      baseDraft({
        product_images: [
          {
            image_type: "spec",
            processed_file_url: "https://x/spec.webp",
            original_file_url: null,
            sort_order: 0
          }
        ]
      })
    ],
    { kind: "showmore" }
  );
  assert.equal(r.canExport, false);
});

await check("Showmore sell price matches markup+beautify (same as D8 export)", () => {
  const base = 299;
  const markup = 5;
  const expected = applyShowmoreMarkup(base, markup);
  assert.equal(expected, beautifyNestoryPrice(base * 1.05));
  const r = runExportPreflight([baseDraft({ twd_price: base, compare_at_price: base })], {
    kind: "showmore",
    showmoreMarkupPercent: markup
  });
  assert.equal(r.items[0].sellPriceDisplay, expected);
  assert.ok(r.items[0].compareAtDisplay > r.items[0].sellPriceDisplay);
});

await check("Matrixify sell price is raw (no markup)", () => {
  const r = runExportPreflight([baseDraft({ twd_price: 1180 })], {
    kind: "matrixify"
  });
  assert.equal(r.items[0].sellPriceDisplay, 1180);
  assert.equal(r.markupPercent, null);
});

// ── Static wiring ────────────────────────────────────────────────────────

await check("exportPreflight.ts exists with severity helpers", () => {
  assert.ok(exists("src/lib/csv/exportPreflight.ts"));
  const src = read("src/lib/csv/exportPreflight.ts");
  assert.ok(src.includes("runExportPreflight"));
  assert.ok(src.includes("image_empty"));
  assert.ok(src.includes("applyShowmoreMarkup"));
  assert.ok(src.includes('kind === "showmore"'));
  assert.ok(src.includes("canExport"));
});

await check("ExportPreflightModal reuses B11 modal shell", () => {
  assert.ok(exists("src/components/listing/ExportPreflightModal.tsx"));
  const src = read("src/components/listing/ExportPreflightModal.tsx");
  assert.ok(src.includes("modal-overlay"));
  assert.ok(src.includes("modal-box"));
  assert.ok(src.includes("exportPrimaryLabel") || src.includes("仍要下載"));
  assert.ok(src.includes("disabled={!canExport}") || src.includes("!canExport"));
});

await check("preflight API route (no csv_ready side effects)", () => {
  assert.ok(exists("src/app/api/exports/preflight/route.ts"));
  const src = read("src/app/api/exports/preflight/route.ts");
  assert.ok(src.includes("runExportPreflight"));
  assert.ok(!src.includes("csv_ready") || src.includes("preflight"));
  // Must not mark drafts
  assert.ok(!src.includes('.update({'));
  assert.ok(!src.includes("publish_jobs"));
});

await check("DraftResultsPanel opens preflight before download", () => {
  const src = read("src/components/listing/DraftResultsPanel.tsx");
  assert.ok(src.includes("openExportPreflight"));
  assert.ok(src.includes("ExportPreflightModal"));
  assert.ok(src.includes("confirmExportDownload"));
  assert.ok(src.includes('openExportPreflight("showmore")'));
  assert.ok(src.includes('openExportPreflight("matrixify")'));
  // Must not wire buttons directly to download without modal
  assert.ok(!src.includes('onClick={() => void downloadCsv("/api/exports/showmore"'));
});

await check("DraftQueueList uses preflight API then confirm download", () => {
  const src = read("src/components/drafts/DraftQueueList.tsx");
  assert.ok(src.includes("/api/exports/preflight"));
  assert.ok(src.includes("ExportPreflightModal"));
  assert.ok(src.includes("confirmExportDownload"));
});

await check("ResultCard 產生 CSV goes through Matrixify preflight (Q5-A)", () => {
  const src = read("src/components/listing/ResultCard.tsx");
  assert.ok(src.includes("openMatrixifyPreflight") || src.includes("runExportPreflight"));
  assert.ok(src.includes("ExportPreflightModal"));
  assert.ok(src.includes("confirmMatrixifyExport") || src.includes("/api/exports/matrixify"));
});

await check("export showmore route still does NOT force preflight (Q4-A)", () => {
  const src = read("src/app/api/exports/showmore/route.ts");
  assert.ok(!src.includes("runExportPreflight"));
  assert.ok(!src.includes("exportPreflight"));
});

await check("globals has export-pf layout classes (tokens only)", () => {
  const src = read("src/app/globals.css");
  assert.ok(src.includes("export-preflight-modal") || src.includes("export-pf-"));
  // no hard-coded hex invent
  const block = src.slice(src.indexOf("export-pf-overview"), src.indexOf("export-pf-overview") + 800);
  assert.ok(!/#(?:[0-9a-fA-F]{3}){1,2}\b/.test(block));
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
