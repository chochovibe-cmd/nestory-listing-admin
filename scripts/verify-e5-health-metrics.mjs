/**
 * E5-open pure-logic verification (no secrets, no network).
 * Mirrors src/lib/dashboard/healthMetrics.ts + wiring checks.
 *
 * Run: node scripts/verify-e5-health-metrics.mjs
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

// --- Inline mirrors (keep in sync with healthMetrics + makeQuotaStats) ---

const HEATMAP_WEEKS = 8;
const RATE_WINDOW_DAYS = 30;
const HEALTH_DRAFT_FETCH_LIMIT = 500;
const HEALTH_HISTORY_FETCH_LIMIT = 2000;
const MANUAL_HISTORY_PROVIDER = "manual";

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

function dayKeyFromParts(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function taiwanDayKey(date) {
  const p = taiwanYmdParts(date);
  return dayKeyFromParts(p.year, p.month, p.day);
}

function addTaiwanCalendarDays(year, month, day, deltaDays) {
  const iso = taipeiLocalToUtcIso(year, month, day, 12, 0, 0);
  const next = new Date(Date.parse(iso) + deltaDays * 24 * 60 * 60 * 1000);
  return taiwanYmdParts(next);
}

function taiwanWeekdayMon0(year, month, day) {
  const iso = taipeiLocalToUtcIso(year, month, day, 12, 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short"
  });
  const short = fmt.format(new Date(iso));
  const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  if (map[short] != null) return map[short];
  const civil = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const js = civil.getUTCDay();
  return js === 0 ? 6 : js - 1;
}

function taiwanLastNDaysRange(days, now = new Date()) {
  const n = Math.max(1, Math.floor(days));
  const today = taiwanYmdParts(now);
  const start = addTaiwanCalendarDays(today.year, today.month, today.day, -(n - 1));
  const endExclusive = addTaiwanCalendarDays(today.year, today.month, today.day, 1);
  return {
    startIso: taipeiLocalToUtcIso(start.year, start.month, start.day, 0, 0, 0),
    endIso: taipeiLocalToUtcIso(
      endExclusive.year,
      endExclusive.month,
      endExclusive.day,
      0,
      0,
      0
    ),
    startKey: dayKeyFromParts(start.year, start.month, start.day),
    endKey: dayKeyFromParts(today.year, today.month, today.day),
    label: `近 ${n} 日`
  };
}

function taiwanHeatmapRange(weeks = HEATMAP_WEEKS, now = new Date()) {
  const w = Math.max(1, Math.floor(weeks));
  const today = taiwanYmdParts(now);
  const mon0 = taiwanWeekdayMon0(today.year, today.month, today.day);
  const thisMon = addTaiwanCalendarDays(today.year, today.month, today.day, -mon0);
  const start = addTaiwanCalendarDays(thisMon.year, thisMon.month, thisMon.day, -7 * (w - 1));
  const thisSun = addTaiwanCalendarDays(thisMon.year, thisMon.month, thisMon.day, 6);
  const endExclusive = addTaiwanCalendarDays(thisSun.year, thisSun.month, thisSun.day, 1);
  return {
    startIso: taipeiLocalToUtcIso(start.year, start.month, start.day, 0, 0, 0),
    endIso: taipeiLocalToUtcIso(
      endExclusive.year,
      endExclusive.month,
      endExclusive.day,
      0,
      0,
      0
    ),
    startKey: dayKeyFromParts(start.year, start.month, start.day),
    endKey: dayKeyFromParts(thisSun.year, thisSun.month, thisSun.day),
    label: `近 ${w} 週`
  };
}

function isInIsoRange(iso, startIso, endIso) {
  if (!iso || typeof iso !== "string") return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= Date.parse(startIso) && t < Date.parse(endIso);
}

function heatLevelFromCount(count) {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}

function isTagRelatedWarning(message) {
  const m = (message ?? "").trim();
  if (!m) return false;
  if (/V2/i.test(m) && (/字典/.test(m) || /tag/i.test(m) || /IP/.test(m) || /角色/.test(m) || /類型/.test(m))) {
    return true;
  }
  if (/IP_\s*tag/i.test(m) || /角色_\s*tag/.test(m) || /類型_\s*tag/.test(m)) return true;
  if (/不在\s*V2\s*IP\s*字典/.test(m)) return true;
  if (/不在\s*Tags\s*V2\s*固定類型/i.test(m)) return true;
  if (/尚未建立\s*V2\s*字典/.test(m)) return true;
  if (/未輸出\s*(IP_|角色_|類型_)\s*tag/i.test(m)) return true;
  if (/tag_rules/i.test(m)) return true;
  if (/尚未建立.*tag_rules/i.test(m)) return true;
  if (/無法產生.*標籤/.test(m) && (/IP|角色|類型|二手|tag/i.test(m))) return true;
  if (/缺少\s*IP_\s*tag/.test(m)) return true;
  return false;
}

function draftHasTagWarning(warnings) {
  if (!Array.isArray(warnings)) return false;
  return warnings.some((w) => typeof w === "string" && isTagRelatedWarning(w));
}

function computeHeatmapView(input) {
  const weeks = input.weeks ?? HEATMAP_WEEKS;
  const now = input.now ?? new Date();
  const range = taiwanHeatmapRange(weeks, now);
  const todayKey = taiwanDayKey(now);
  const counts = new Map();
  for (const r of input.rows) {
    if (!isInIsoRange(r.copy_generated_at, range.startIso, range.endIso)) continue;
    const key = taiwanDayKey(new Date(r.copy_generated_at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const startParts = {
    year: Number(range.startKey.slice(0, 4)),
    month: Number(range.startKey.slice(5, 7)),
    day: Number(range.startKey.slice(8, 10))
  };
  const cells = [];
  let totalCount = 0;
  for (let i = 0; i < weeks * 7; i++) {
    const p = addTaiwanCalendarDays(startParts.year, startParts.month, startParts.day, i);
    const dayKey = dayKeyFromParts(p.year, p.month, p.day);
    const isFuture = dayKey > todayKey;
    const count = isFuture ? 0 : (counts.get(dayKey) ?? 0);
    if (!isFuture) totalCount += count;
    cells.push({ dayKey, count, level: heatLevelFromCount(count), isFuture });
  }
  return { weeks, cells, range, totalCount };
}

function computeReworkRateView(input) {
  const now = input.now ?? new Date();
  const range = taiwanLastNDaysRange(RATE_WINDOW_DAYS, now);
  const byDraft = new Map();
  for (const r of input.historyRows) {
    if (!r.draft_id) continue;
    if (!isInIsoRange(r.created_at, range.startIso, range.endIso)) continue;
    const field = (r.field_name ?? "").trim() || "_unknown";
    let fields = byDraft.get(r.draft_id);
    if (!fields) {
      fields = new Map();
      byDraft.set(r.draft_id, fields);
    }
    let bucket = fields.get(field);
    if (!bucket) {
      bucket = { total: 0, ai: 0 };
      fields.set(field, bucket);
    }
    bucket.total += 1;
    const prov = r.provider;
    if (prov != null && prov !== "" && prov !== MANUAL_HISTORY_PROVIDER) {
      bucket.ai += 1;
    }
  }
  let denominator = 0;
  let numerator = 0;
  for (const [, fields] of byDraft) {
    denominator += 1;
    for (const [, b] of fields) {
      if (b.total >= 2) {
        numerator += 1;
        break;
      }
    }
  }
  const ratePct = denominator === 0 ? null : Math.round((100 * numerator) / denominator);
  return { ratePct, numerator, denominator, range };
}

function computeTagHealthView(input) {
  const now = input.now ?? new Date();
  const range = taiwanLastNDaysRange(RATE_WINDOW_DAYS, now);
  let denominator = 0;
  let numerator = 0;
  let needsRevisionCount = 0;
  let emptyTagsCount = 0;
  for (const r of input.rows) {
    if (r.status === "archived") continue;
    if (!isInIsoRange(r.copy_generated_at, range.startIso, range.endIso)) continue;
    denominator += 1;
    if (draftHasTagWarning(r.warnings)) numerator += 1;
    if (r.status === "needs_revision") needsRevisionCount += 1;
    if (!Array.isArray(r.shopify_tags) || r.shopify_tags.length === 0) emptyTagsCount += 1;
  }
  const ratePct = denominator === 0 ? null : Math.round((100 * numerator) / denominator);
  return { ratePct, numerator, denominator, needsRevisionCount, emptyTagsCount, range };
}

// ---------------------------------------------------------------------------
console.log("verify-e5-health-metrics");

await check("files exist", () => {
  assert.ok(exists("src/lib/dashboard/healthMetrics.ts"));
  assert.ok(exists("src/components/dashboard/DashboardTodoPanel.tsx"));
  assert.ok(exists("scripts/verify-e5-health-metrics.mjs"));
});

await check("lib Q1–Q6 constants + honesty", () => {
  const lib = read("src/lib/dashboard/healthMetrics.ts");
  assert.ok(lib.includes("HEATMAP_WEEKS = 8"));
  assert.ok(lib.includes("RATE_WINDOW_DAYS = 30"));
  assert.ok(lib.includes("copy_generated_at"));
  assert.ok(lib.includes("isTagRelatedWarning"));
  assert.ok(lib.includes("computeReworkRateView"));
  assert.ok(lib.includes("computeHeatmapView"));
  assert.ok(lib.includes("computeTagHealthView"));
  assert.ok(lib.includes("有第二版的草稿比例"));
  assert.ok(lib.includes("依 warnings 字樣"));
  assert.ok(lib.includes("非 GSC"));
  assert.ok(lib.includes("MANUAL_HISTORY_PROVIDER"));
  assert.ok(!lib.includes("假 GSC"));
  assert.ok(!lib.includes("SEO 健康 87"));
});

await check("Dashboard wires E5 below E4", () => {
  const ui = read("src/components/dashboard/DashboardTodoPanel.tsx");
  assert.ok(ui.includes("computeHealthMetricsView"));
  assert.ok(ui.includes("dash-health-panel") || ui.includes("健康指標"));
  assert.ok(ui.includes("生成日曆") || ui.includes("dash-heat"));
  assert.ok(ui.includes("文案重做率"));
  assert.ok(ui.includes("Tag 提醒率"));
  assert.ok(ui.includes("generation_history"));
  assert.ok(ui.includes("HEALTH_DRAFT_SELECT_COLUMNS"));
  assert.ok(ui.includes("E5-open") || ui.includes("E5 Q"));
  // later note is E6 only
  assert.ok(ui.includes("E6"));
  assert.ok(!ui.includes("熱圖／AI 顧問 → 後續版本（E5–E6）"));
  // E4 section still present and health after cost (use panel markers, not comments)
  const costIdx = ui.indexOf('id="dash-cost-title"');
  const healthIdx = ui.indexOf('id="dash-health-title"');
  assert.ok(costIdx >= 0 && healthIdx > costIdx, "health panel must be after cost panel");
});

await check("CSS heat + rates use tokens", () => {
  const css = read("src/app/globals.css");
  assert.ok(css.includes("dash-heat-cell"));
  assert.ok(css.includes("dash-health-rates"));
  assert.ok(css.includes("var(--accent)"));
  assert.ok(css.includes("dash-heat-cell--l3"));
  // no hardcoded hex for heat levels
  const heatBlock = css.slice(css.indexOf("dash-health-panel"), css.indexOf("dash-heat-legend") + 200);
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(heatBlock));
});

// Fixed "now" for deterministic tests: 2026-07-14 12:00 UTC ≈ Taipei afternoon
const NOW = new Date("2026-07-14T04:00:00.000Z"); // Taipei 12:00

await check("heatmap 8 weeks · Mon start · Taiwan day count", () => {
  const range = taiwanHeatmapRange(8, NOW);
  assert.equal(range.label, "近 8 週");
  // start should be a Monday
  const sp = {
    y: Number(range.startKey.slice(0, 4)),
    m: Number(range.startKey.slice(5, 7)),
    d: Number(range.startKey.slice(8, 10))
  };
  assert.equal(taiwanWeekdayMon0(sp.y, sp.m, sp.d), 0, "heatmap start is Monday");

  // Two drafts same Taipei day
  const dayIso = taipeiLocalToUtcIso(2026, 7, 14, 10, 0, 0);
  const dayIso2 = taipeiLocalToUtcIso(2026, 7, 14, 22, 0, 0);
  const outside = taipeiLocalToUtcIso(2026, 1, 1, 12, 0, 0);
  const view = computeHeatmapView({
    rows: [
      { id: "a", copy_generated_at: dayIso },
      { id: "b", copy_generated_at: dayIso2 },
      { id: "c", copy_generated_at: outside }
    ],
    now: NOW
  });
  assert.equal(view.weeks, 8);
  assert.equal(view.cells.length, 56);
  assert.equal(view.totalCount, 2);
  const cell = view.cells.find((c) => c.dayKey === "2026-07-14");
  assert.ok(cell);
  assert.equal(cell.count, 2);
  assert.equal(cell.level, 2); // 2–3 → level 2
});

await check("heatmap empty days are 0 not missing; future not counted", () => {
  const view = computeHeatmapView({ rows: [], now: NOW });
  assert.equal(view.totalCount, 0);
  assert.ok(view.cells.every((c) => c.count === 0 || c.isFuture));
  const today = view.cells.find((c) => c.dayKey === "2026-07-14");
  assert.ok(today && !today.isFuture && today.count === 0);
});

await check("heat levels 0/1/2/3", () => {
  assert.equal(heatLevelFromCount(0), 0);
  assert.equal(heatLevelFromCount(1), 1);
  assert.equal(heatLevelFromCount(2), 2);
  assert.equal(heatLevelFromCount(3), 2);
  assert.equal(heatLevelFromCount(4), 3);
});

await check("rework rate: field ≥2 / has history; empty → null", () => {
  const empty = computeReworkRateView({ historyRows: [], now: NOW });
  assert.equal(empty.ratePct, null);
  assert.equal(empty.denominator, 0);

  const t1 = taipeiLocalToUtcIso(2026, 7, 10, 8, 0, 0);
  const t2 = taipeiLocalToUtcIso(2026, 7, 11, 8, 0, 0);
  const tOld = taipeiLocalToUtcIso(2026, 1, 1, 8, 0, 0);

  // draft A: title has 2 rows → reworked
  // draft B: only 1 row → not reworked
  // draft C: old outside window → ignore
  const view = computeReworkRateView({
    now: NOW,
    historyRows: [
      { draft_id: "A", field_name: "enriched_title", provider: "anthropic", created_at: t1 },
      { draft_id: "A", field_name: "enriched_title", provider: "anthropic", created_at: t2 },
      { draft_id: "B", field_name: "seo_title", provider: "openai", created_at: t1 },
      { draft_id: "C", field_name: "seo_title", provider: "openai", created_at: tOld },
      { draft_id: "C", field_name: "seo_title", provider: "openai", created_at: tOld }
    ]
  });
  assert.equal(view.denominator, 2);
  assert.equal(view.numerator, 1);
  assert.equal(view.ratePct, 50);
});

await check("rework: first gen 7 fields each once = 0% not fake high", () => {
  const t1 = taipeiLocalToUtcIso(2026, 7, 12, 8, 0, 0);
  const fields = [
    "enriched_title",
    "generated_description_html",
    "generated_faq_html",
    "seo_title",
    "meta_description",
    "why_we_chose_it",
    "product_highlights"
  ];
  const rows = fields.map((field_name) => ({
    draft_id: "D1",
    field_name,
    provider: "anthropic",
    created_at: t1
  }));
  const view = computeReworkRateView({ historyRows: rows, now: NOW });
  assert.equal(view.denominator, 1);
  assert.equal(view.numerator, 0);
  assert.equal(view.ratePct, 0);
});

await check("tag warn whitelist: V2 yes, SEO length no", () => {
  assert.equal(
    isTagRelatedWarning('角色「小八」尚未建立 V2 字典 canonical name，未輸出角色_ tag。'),
    true
  );
  assert.equal(isTagRelatedWarning("IP「某某」不在 V2 IP 字典中，未輸出 IP_ tag。"), true);
  assert.equal(isTagRelatedWarning("角色「x」尚未建立正式 tag_rules，將不產生角色標籤。"), true);
  assert.equal(isTagRelatedWarning("商品標題約 50 字，已超過 45 字，建議縮短。"), false);
  assert.equal(isTagRelatedWarning("Meta Description 稍短，建議補充款式亮點。"), false);
  assert.equal(isTagRelatedWarning("禁忌詞命中：親"), false);
});

await check("tag health rate + archived excluded + empty —", () => {
  const empty = computeTagHealthView({ rows: [], now: NOW });
  assert.equal(empty.ratePct, null);

  const inWin = taipeiLocalToUtcIso(2026, 7, 5, 12, 0, 0);
  const view = computeTagHealthView({
    now: NOW,
    rows: [
      {
        id: "1",
        status: "ready_for_review",
        copy_generated_at: inWin,
        warnings: ['IP「X」不在 V2 IP 字典中，未輸出 IP_ tag。'],
        shopify_tags: ["定位_IP周邊"]
      },
      {
        id: "2",
        status: "ready_for_review",
        copy_generated_at: inWin,
        warnings: ["商品標題約 50 字，已超過 45 字，建議縮短。"],
        shopify_tags: ["IP_吉伊卡哇"]
      },
      {
        id: "3",
        status: "archived",
        copy_generated_at: inWin,
        warnings: ["tag_rules missing"],
        shopify_tags: []
      },
      {
        id: "4",
        status: "needs_revision",
        copy_generated_at: inWin,
        warnings: [],
        shopify_tags: []
      }
    ]
  });
  // 1,2,4 in denom (3 archived out); 1 has tag warn
  assert.equal(view.denominator, 3);
  assert.equal(view.numerator, 1);
  assert.equal(view.ratePct, 33);
  assert.equal(view.needsRevisionCount, 1);
  assert.equal(view.emptyTagsCount, 1);
});

await check("rate window is 30 Taiwan days", () => {
  const r = taiwanLastNDaysRange(30, NOW);
  assert.equal(r.endKey, "2026-07-14");
  // start = 2026-07-14 - 29 days = 2026-06-15
  assert.equal(r.startKey, "2026-06-15");
});

await check("no migration SQL in E5 package", () => {
  // Ensure we didn't add a new migration for E5
  const migDir = path.join(root, "supabase", "migrations");
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql"));
  assert.ok(!files.some((f) => /e5|health_metrics/i.test(f)));
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
