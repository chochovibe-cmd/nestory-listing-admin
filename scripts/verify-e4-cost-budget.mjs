/**
 * E4-open pure-logic verification (no secrets, no network).
 * Mirrors src/lib/dashboard/costBudgetStats.ts + wiring checks.
 *
 * Run: node scripts/verify-e4-cost-budget.mjs
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

// --- Inline mirrors (keep in sync with costBudgetStats + makeQuotaStats) ---

const DEFAULT_MONTHLY_BUDGET_NTD = 600;
const DEFAULT_USD_TO_TWD = 32;
const COST_BUDGET_WARN_RATIO = 0.8;
const COST_DRAFT_FETCH_LIMIT = 500;
const COST_DETAIL_UI_LIMIT = 20;

function taiwanYmdParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const bag = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day)
  };
}

function taiwanYmdHmsParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const bag = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second)
  };
}

function taipeiLocalToUtcIso(year, month, day, hour = 0, minute = 0, second = 0) {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const asIf = new Date(utcMs);
    const parts = taiwanYmdHmsParts(asIf);
    const want = Date.UTC(year, month - 1, day, hour, minute, second);
    const got = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const delta = want - got;
    if (delta === 0) break;
    utcMs += delta;
  }
  return new Date(utcMs).toISOString();
}

function taiwanMonthRange(now = new Date()) {
  const parts = taiwanYmdParts(now);
  const y = parts.year;
  const m = parts.month;
  const startIso = taipeiLocalToUtcIso(y, m, 1, 0, 0, 0);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const endIso = taipeiLocalToUtcIso(nextY, nextM, 1, 0, 0, 0);
  return {
    startIso,
    endIso,
    labelYm: `${y}/${String(m).padStart(2, "0")}`,
    rangeHint: `${m}/1～今天`
  };
}

function isCreatedInTaiwanMonth(createdAt, range) {
  if (!createdAt || typeof createdAt !== "string") return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  const start = Date.parse(range.startIso);
  const end = Date.parse(range.endIso);
  return t >= start && t < end;
}

function parseCostUsd(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function usdToNtd(usd, rate = DEFAULT_USD_TO_TWD) {
  const r =
    typeof rate === "number" && Number.isFinite(rate) && rate > 0
      ? rate
      : DEFAULT_USD_TO_TWD;
  return Math.round(usd * r * 100) / 100;
}

function truncateTitle(title, max = 28) {
  const t = (title ?? "").trim();
  if (!t) return "（無標題）";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function isMissingCostColumnError(message) {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("generation_cost_estimate") ||
    m.includes("copy_generated_at") ||
    m.includes("generation_input_tokens") ||
    m.includes("generation_output_tokens") ||
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column"))
  );
}

function costBudgetMigrationHint(errorMessage) {
  if (!errorMessage || !isMissingCostColumnError(errorMessage)) return null;
  return "成本欄位尚未建立，請在 Supabase SQL Editor 執行 migration 014（copy_generated_at／generation_cost_estimate 等）。成本無法估算。";
}

function computeCostBudgetView(input) {
  const month = taiwanMonthRange(input.now ?? new Date());
  const rate = input.usdToTwd ?? DEFAULT_USD_TO_TWD;
  const budgetNtd =
    typeof input.budgetNtd === "number" &&
    Number.isFinite(input.budgetNtd) &&
    input.budgetNtd > 0
      ? Math.floor(input.budgetNtd)
      : DEFAULT_MONTHLY_BUDGET_NTD;
  const fetchLimit = input.fetchLimit ?? COST_DRAFT_FETCH_LIMIT;
  const detailUiLimit = input.detailUiLimit ?? COST_DETAIL_UI_LIMIT;

  const inMonth = input.rows.filter((r) =>
    isCreatedInTaiwanMonth(r.copy_generated_at, month)
  );

  let totalUsd = 0;
  let withCostCount = 0;
  let missingCostCount = 0;
  const withCost = [];

  for (const r of inMonth) {
    const cost = parseCostUsd(r.generation_cost_estimate);
    if (cost === null) {
      missingCostCount += 1;
      continue;
    }
    withCostCount += 1;
    totalUsd += cost;
    withCost.push({
      id: r.id,
      title: truncateTitle(r.title_zh),
      costUsd: cost,
      costNtd: usdToNtd(cost, rate),
      model: r.generation_model?.trim() || null,
      copyGeneratedAt: r.copy_generated_at,
      href: `/drafts/${r.id}`
    });
  }

  withCost.sort((a, b) => {
    if (b.costUsd !== a.costUsd) return b.costUsd - a.costUsd;
    return Date.parse(b.copyGeneratedAt) - Date.parse(a.copyGeneratedAt);
  });

  totalUsd = Math.round(totalUsd * 1_000_000) / 1_000_000;
  const totalNtd = usdToNtd(totalUsd, rate);
  const remainingNtd = Math.max(0, Math.round((budgetNtd - totalNtd) * 100) / 100);
  const usedRatio = budgetNtd > 0 ? totalNtd / budgetNtd : 0;
  const barPct = Math.min(100, Math.round(usedRatio * 100));
  const warn = usedRatio >= COST_BUDGET_WARN_RATIO;

  return {
    month,
    totalUsd,
    totalNtd,
    budgetNtd,
    remainingNtd,
    usedRatio,
    barPct,
    warn,
    monthRowCount: inMonth.length,
    withCostCount,
    missingCostCount,
    usdToTwd: rate,
    honestyLabel: "估算 · 非信用卡帳單",
    detailItems: withCost.slice(0, detailUiLimit),
    detailTotal: withCostCount,
    truncationNote:
      input.rows.length >= fetchLimit
        ? `已載入上限 ${fetchLimit} 筆，合計可能未列完`
        : null
  };
}

// ---------------------------------------------------------------------------
console.log("verify-e4-cost-budget");

await check("files exist", () => {
  assert.ok(exists("src/lib/dashboard/costBudgetStats.ts"));
  assert.ok(exists("src/components/dashboard/DashboardTodoPanel.tsx"));
  assert.ok(exists("scripts/verify-e4-cost-budget.mjs"));
});

await check("lib constants Q3-A + honesty", () => {
  const lib = read("src/lib/dashboard/costBudgetStats.ts");
  assert.ok(lib.includes("DEFAULT_MONTHLY_BUDGET_NTD = 600"));
  assert.ok(lib.includes("DEFAULT_USD_TO_TWD = 32"));
  assert.ok(lib.includes("COST_BUDGET_WARN_RATIO = 0.8"));
  assert.ok(lib.includes("估算 · 非信用卡帳單"));
  assert.ok(lib.includes("僅文案 token"));
  assert.ok(lib.includes("copy_generated_at"));
  assert.ok(lib.includes("parseCostUsd"));
  assert.ok(lib.includes("migration 014"));
  // no fake per-model split
  assert.ok(!lib.includes("Vision 辨識"));
  assert.ok(!lib.includes("perModel"));
});

await check("Dashboard wires E4 below E3", () => {
  const ui = read("src/components/dashboard/DashboardTodoPanel.tsx");
  assert.ok(ui.includes("computeCostBudgetView"));
  assert.ok(ui.includes("dash-cost-panel") || ui.includes("月預算 · AI 成本"));
  // UX-G T48 / UX-PKG3: honesty lives in page disclaimer (not per-panel chip)
  assert.ok(
    ui.includes("估算 · 非信用卡帳單") ||
      ui.includes("非 Make／信用卡帳單") ||
      ui.includes("非信用卡")
  );
  assert.ok(ui.includes("copy_generated_at"));
  assert.ok(ui.includes("COST_DRAFT_SELECT_COLUMNS"));
  assert.ok(ui.includes("E4 Q1-A") || ui.includes("E4-open"));
  // detail links to /drafts/[id]
  assert.ok(ui.includes("item.href") || ui.includes("/drafts/"));
  // footer no longer claims E4 is later-only
  assert.ok(!ui.includes("月預算成本／熱圖／AI 顧問 → 後續版本（E4–E6）"));
  assert.ok(ui.includes("E5–E6") || ui.includes("E5-E6") || ui.includes("E5"));
  // E3 still present above
  assert.ok(ui.includes("dash-quota-panel"));
  assert.ok(ui.includes("computeMakeQuotaView"));
  // UX-PKG3: cost panel collapsible default closed
  assert.ok(ui.includes("CollapsibleSection"));
  assert.ok(ui.includes("costSectionOpen"));
});

await check("CSS cost list reuses tokens", () => {
  const css = read("src/app/globals.css");
  assert.ok(css.includes(".dash-cost-row"));
  assert.ok(css.includes(".dash-cost-list"));
  assert.ok(css.includes("var(--warn)"));
  assert.ok(css.includes("var(--accent)"));
  assert.ok(css.includes("var(--border-soft)"));
  assert.ok(css.includes("min-height: 44px"));
});

await check("null cost not counted as 0", () => {
  const now = new Date("2026-07-14T12:00:00+08:00");
  const inMonth = "2026-07-10T04:00:00.000Z";
  const view = computeCostBudgetView({
    rows: [
      {
        id: "a",
        title_zh: "有成本",
        generation_cost_estimate: 0.026,
        copy_generated_at: inMonth
      },
      {
        id: "b",
        title_zh: "缺成本",
        generation_cost_estimate: null,
        copy_generated_at: inMonth
      },
      {
        id: "c",
        title_zh: "字串空",
        generation_cost_estimate: "",
        copy_generated_at: inMonth
      }
    ],
    now
  });
  assert.equal(view.withCostCount, 1);
  assert.equal(view.missingCostCount, 2);
  assert.equal(view.totalUsd, 0.026);
  assert.equal(view.totalNtd, usdToNtd(0.026, 32));
  assert.equal(view.monthRowCount, 3);
});

await check("Q1-A excludes prev month and missing copy_generated_at", () => {
  const now = new Date("2026-07-14T12:00:00+08:00");
  const view = computeCostBudgetView({
    rows: [
      {
        id: "june",
        title_zh: "上月",
        generation_cost_estimate: 1,
        // 2026-06-30 23:59 Taipei
        copy_generated_at: "2026-06-30T15:59:00.000Z"
      },
      {
        id: "null-ts",
        title_zh: "無戳",
        generation_cost_estimate: 2,
        copy_generated_at: null
      },
      {
        id: "july",
        title_zh: "本月",
        generation_cost_estimate: 0.5,
        // 2026-07-10 12:00 Taipei
        copy_generated_at: "2026-07-10T04:00:00.000Z"
      }
    ],
    now
  });
  // Only rows whose copy_generated_at falls in Taipei July
  assert.ok(view.withCostCount >= 1);
  assert.ok(!view.detailItems.some((d) => d.id === "june"));
  assert.ok(!view.detailItems.some((d) => d.id === "null-ts"));
});

await check("NT600@32 budget bar + 80% warn", () => {
  const now = new Date("2026-07-14T12:00:00+08:00");
  const inMonth = "2026-07-10T04:00:00.000Z";
  // 480 NTD / 600 = 80% → warn. 480/32 = 15 USD
  const view = computeCostBudgetView({
    rows: [
      {
        id: "big",
        title_zh: "大件",
        generation_cost_estimate: 15,
        copy_generated_at: inMonth
      }
    ],
    budgetNtd: 600,
    usdToTwd: 32,
    now
  });
  assert.equal(view.budgetNtd, 600);
  assert.equal(view.totalUsd, 15);
  assert.equal(view.totalNtd, 480);
  assert.equal(view.remainingNtd, 120);
  assert.equal(view.barPct, 80);
  assert.equal(view.warn, true);
  assert.equal(view.honestyLabel, "估算 · 非信用卡帳單");

  const low = computeCostBudgetView({
    rows: [
      {
        id: "tiny",
        title_zh: "小",
        generation_cost_estimate: 0.026,
        copy_generated_at: inMonth
      }
    ],
    now
  });
  assert.equal(low.warn, false);
  assert.ok(low.totalNtd < 1);
});

await check("detail href /drafts/[id] and model optional", () => {
  const now = new Date("2026-07-14T12:00:00+08:00");
  const inMonth = "2026-07-10T04:00:00.000Z";
  const view = computeCostBudgetView({
    rows: [
      {
        id: "abc-123",
        title_zh: "三麗鷗米菲禮物盒絨毛公仔超長標題會被截斷顯示",
        generation_cost_estimate: 0.1,
        generation_model: "claude-sonnet-5",
        copy_generated_at: inMonth
      }
    ],
    now
  });
  assert.equal(view.detailItems.length, 1);
  assert.equal(view.detailItems[0].href, "/drafts/abc-123");
  assert.equal(view.detailItems[0].model, "claude-sonnet-5");
  assert.ok(view.detailItems[0].title.includes("…") || view.detailItems[0].title.length <= 28);
});

await check("migration hint for missing columns", () => {
  assert.ok(
    costBudgetMigrationHint(
      'column product_drafts.copy_generated_at does not exist'
    )
  );
  assert.equal(costBudgetMigrationHint("permission denied"), null);
  assert.equal(costBudgetMigrationHint(null), null);
});

await check("zero rows empty honest", () => {
  const now = new Date("2026-07-14T12:00:00+08:00");
  const view = computeCostBudgetView({ rows: [], now });
  assert.equal(view.totalUsd, 0);
  assert.equal(view.withCostCount, 0);
  assert.equal(view.barPct, 0);
  assert.equal(view.warn, false);
});

await check("parseCostUsd null hygiene", () => {
  assert.equal(parseCostUsd(null), null);
  assert.equal(parseCostUsd(undefined), null);
  assert.equal(parseCostUsd(""), null);
  assert.equal(parseCostUsd(NaN), null);
  assert.equal(parseCostUsd(0), 0); // true zero is allowed and counted
  assert.equal(parseCostUsd(0.026), 0.026);
});

// ---------------------------------------------------------------------------
if (failures.length) {
  console.error(`\nFAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("\nALL passed");
