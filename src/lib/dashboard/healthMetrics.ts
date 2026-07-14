/**
 * E5-open: dashboard health metrics (heatmap · rework rate · tag warn rate).
 * Q1-A copy_generated_at heatmap · Q2-A 8 weeks · Q3-A rework (field ≥2) ·
 * Q4-A last 30 Taiwan days for rates · Q5-A tag warnings whitelist ·
 * Q6-A team-wide (not E1 scope) · zero migration · honest — when empty.
 */

import { taipeiLocalToUtcIso } from "@/lib/dashboard/makeQuotaStats";
import { MANUAL_HISTORY_PROVIDER } from "@/lib/drafts/copyVersionHistory";

/** Heatmap: last N calendar weeks (Mon–Sun grid). */
export const HEATMAP_WEEKS = 8;

/** Rework + Tag rates: last N Taiwan calendar days (inclusive of today). */
export const RATE_WINDOW_DAYS = 30;

/** Soft cap for product_drafts fetch (heatmap + tag). */
export const HEALTH_DRAFT_FETCH_LIMIT = 500;

/** Soft cap for generation_history fetch (rework). */
export const HEALTH_HISTORY_FETCH_LIMIT = 2000;

export const HEALTH_DRAFT_SELECT_COLUMNS =
  "id, status, warnings, shopify_tags, copy_generated_at";

export const HEALTH_HISTORY_SELECT_COLUMNS =
  "draft_id, field_name, provider, created_at";

/** Intensity buckets for heatmap cell count. */
export type HeatLevel = 0 | 1 | 2 | 3;

export type HealthDraftRow = {
  id: string;
  status?: string | null;
  warnings?: unknown;
  shopify_tags?: unknown;
  copy_generated_at?: string | null;
};

export type HealthHistoryRow = {
  draft_id: string;
  field_name?: string | null;
  provider?: string | null;
  created_at?: string | null;
};

export type TaiwanDayRange = {
  /** Inclusive start (Taipei 00:00) as UTC ISO. */
  startIso: string;
  /** Exclusive end (day after last, Taipei 00:00) as UTC ISO. */
  endIso: string;
  /** First day YYYY-MM-DD (Taipei). */
  startKey: string;
  /** Last day YYYY-MM-DD (Taipei), inclusive. */
  endKey: string;
  /** Display e.g. 近 30 日 */
  label: string;
};

export type HeatCell = {
  /** YYYY-MM-DD Taipei */
  dayKey: string;
  /** M/D label */
  labelMd: string;
  count: number;
  level: HeatLevel;
  /** After today (current week filler) */
  isFuture: boolean;
  /** Weekday Mon=0 … Sun=6 */
  weekdayMon0: number;
  weekIndex: number;
  title: string;
};

export type HeatmapView = {
  weeks: number;
  cells: HeatCell[];
  range: TaiwanDayRange;
  totalCount: number;
  daysWithActivity: number;
  honestyLabel: string;
  subHint: string;
  emptyText: string | null;
  truncationNote: string | null;
};

export type ReworkRateView = {
  ratePct: number | null;
  numerator: number;
  denominator: number;
  /** Drafts with field≥2 and at least one AI (non-manual, non-null) secondary row */
  aiSecondaryCount: number;
  /** Drafts with field≥2 only via manual / null providers */
  manualOnlyCount: number;
  range: TaiwanDayRange;
  honestyLabel: string;
  subHint: string;
  emptyText: string | null;
  truncationNote: string | null;
  displayLabel: string;
};

export type TagHealthView = {
  ratePct: number | null;
  numerator: number;
  denominator: number;
  needsRevisionCount: number;
  emptyTagsCount: number;
  range: TaiwanDayRange;
  honestyLabel: string;
  subHint: string;
  emptyText: string | null;
  truncationNote: string | null;
  displayLabel: string;
};

export type HealthMetricsView = {
  heatmap: HeatmapView;
  rework: ReworkRateView;
  tagHealth: TagHealthView;
  visibilityPartial: boolean;
};

// --- Taiwan calendar helpers (same Intl pattern as makeQuotaStats) ---

export function taiwanYmdParts(date: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day)
  };
}

export function dayKeyFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function taiwanDayKey(date: Date): string {
  const p = taiwanYmdParts(date);
  return dayKeyFromParts(p.year, p.month, p.day);
}

/** Mon=0 … Sun=6 for a Taipei calendar day. */
export function taiwanWeekdayMon0(year: number, month: number, day: number): number {
  const iso = taipeiLocalToUtcIso(year, month, day, 12, 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short"
  });
  const short = fmt.format(new Date(iso)); // e.g. Mon
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6
  };
  if (map[short] != null) return map[short];
  // Fallback: civil date weekday (UTC noon of Y-M-D) — Taipei has no DST.
  const civil = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const js = civil.getUTCDay(); // 0=Sun
  return js === 0 ? 6 : js - 1;
}

/** Add calendar days to a Taipei Y-M-D (handles month/year). */
export function addTaiwanCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number
): { year: number; month: number; day: number } {
  // Anchor at Taipei noon, add 24h * delta in UTC ms then re-read Taipei parts
  const iso = taipeiLocalToUtcIso(year, month, day, 12, 0, 0);
  const next = new Date(Date.parse(iso) + deltaDays * 24 * 60 * 60 * 1000);
  return taiwanYmdParts(next);
}

export function formatMd(month: number, day: number): string {
  return `${month}/${day}`;
}

/**
 * Inclusive last `days` Taiwan days ending today → [start 00:00, tomorrow 00:00).
 */
export function taiwanLastNDaysRange(
  days: number,
  now: Date = new Date()
): TaiwanDayRange {
  const n = Math.max(1, Math.floor(days));
  const today = taiwanYmdParts(now);
  const start = addTaiwanCalendarDays(today.year, today.month, today.day, -(n - 1));
  const endExclusive = addTaiwanCalendarDays(today.year, today.month, today.day, 1);
  const startIso = taipeiLocalToUtcIso(start.year, start.month, start.day, 0, 0, 0);
  const endIso = taipeiLocalToUtcIso(
    endExclusive.year,
    endExclusive.month,
    endExclusive.day,
    0,
    0,
    0
  );
  return {
    startIso,
    endIso,
    startKey: dayKeyFromParts(start.year, start.month, start.day),
    endKey: dayKeyFromParts(today.year, today.month, today.day),
    label: `近 ${n} 日`
  };
}

/**
 * Heatmap range: 8 Mon–Sun weeks ending the week that contains `now` (Taipei).
 * start = Monday of (current week Monday − 7*(weeks-1) days).
 */
export function taiwanHeatmapRange(
  weeks: number = HEATMAP_WEEKS,
  now: Date = new Date()
): TaiwanDayRange {
  const w = Math.max(1, Math.floor(weeks));
  const today = taiwanYmdParts(now);
  const mon0 = taiwanWeekdayMon0(today.year, today.month, today.day);
  // This week's Monday
  const thisMon = addTaiwanCalendarDays(today.year, today.month, today.day, -mon0);
  // First Monday of grid
  const start = addTaiwanCalendarDays(thisMon.year, thisMon.month, thisMon.day, -7 * (w - 1));
  // Exclusive end = day after last Sunday of current week
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

/** Instant in [startIso, endIso). */
export function isInIsoRange(
  iso: string | null | undefined,
  startIso: string,
  endIso: string
): boolean {
  if (!iso || typeof iso !== "string") return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  return t >= start && t < end;
}

export function heatLevelFromCount(count: number): HeatLevel {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}

/** Parse warnings array from JSON/unknown. */
export function parseWarnings(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  }
  return [];
}

/** Parse shopify_tags / tags array. */
export function parseTags(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  }
  return [];
}

/**
 * Tag-related warning whitelist (nestoryTagsV2 / B4 / legacy tag_rules).
 * Does NOT match SEO length, forbidden terms, image, web search, etc.
 */
export function isTagRelatedWarning(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  // V2 dictionary / prefix tags
  if (/V2/i.test(m) && (/字典/.test(m) || /tag/i.test(m) || /IP/.test(m) || /角色/.test(m) || /類型/.test(m))) {
    return true;
  }
  if (/IP_\s*tag/i.test(m) || /角色_\s*tag/.test(m) || /類型_\s*tag/.test(m)) return true;
  if (/不在\s*V2\s*IP\s*字典/.test(m)) return true;
  if (/不在\s*Tags\s*V2\s*固定類型/i.test(m)) return true;
  if (/尚未建立\s*V2\s*字典/.test(m)) return true;
  if (/未輸出\s*(IP_|角色_|類型_)\s*tag/i.test(m)) return true;
  // Legacy tag_rules (may still exist on old drafts)
  if (/tag_rules/i.test(m)) return true;
  if (/尚未建立.*tag_rules/i.test(m)) return true;
  if (/無法產生.*標籤/.test(m) && (/IP|角色|類型|二手|tag/i.test(m))) return true;
  if (/缺少\s*IP_\s*tag/.test(m)) return true;
  return false;
}

export function draftHasTagWarning(warnings: unknown): boolean {
  return parseWarnings(warnings).some(isTagRelatedWarning);
}

export function isMissingHealthColumnError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("copy_generated_at") ||
    m.includes("generation_history") ||
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column")) ||
    m.includes("does not exist") && (m.includes("relation") || m.includes("table"))
  );
}

export function healthDraftMigrationHint(
  errorMessage: string | null | undefined
): string | null {
  if (!errorMessage) return null;
  const m = errorMessage.toLowerCase();
  if (m.includes("copy_generated_at") || (m.includes("column") && m.includes("does not exist"))) {
    return "生成時間欄位尚未建立，請在 Supabase SQL Editor 執行 migration 014（copy_generated_at）。熱圖／Tag 健康無法計算。";
  }
  return null;
}

export function healthHistoryMigrationHint(
  errorMessage: string | null | undefined
): string | null {
  if (!errorMessage) return null;
  const m = errorMessage.toLowerCase();
  if (
    m.includes("generation_history") ||
    (m.includes("relation") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("generation_history"))
  ) {
    return "版本紀錄表尚未建立，請在 Supabase SQL Editor 執行 migration 007（generation_history）。文案重做率無法計算。";
  }
  if (m.includes("column") && m.includes("does not exist")) {
    return "版本紀錄欄位異常，請檢查 migration 007（generation_history）。文案重做率無法計算。";
  }
  return null;
}

/**
 * Build 8×7 heatmap cells from drafts counted by copy_generated_at (Taipei day).
 */
export function computeHeatmapView(input: {
  rows: HealthDraftRow[];
  weeks?: number;
  fetchLimit?: number;
  now?: Date;
  visibilityPartial?: boolean;
}): HeatmapView {
  const weeks = input.weeks ?? HEATMAP_WEEKS;
  const now = input.now ?? new Date();
  const range = taiwanHeatmapRange(weeks, now);
  const fetchLimit = input.fetchLimit ?? HEALTH_DRAFT_FETCH_LIMIT;
  const todayKey = taiwanDayKey(now);

  const counts = new Map<string, number>();
  for (const r of input.rows) {
    if (!isInIsoRange(r.copy_generated_at, range.startIso, range.endIso)) continue;
    const key = taiwanDayKey(new Date(r.copy_generated_at!));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const startParts = {
    year: Number(range.startKey.slice(0, 4)),
    month: Number(range.startKey.slice(5, 7)),
    day: Number(range.startKey.slice(8, 10))
  };

  const cells: HeatCell[] = [];
  let totalCount = 0;
  let daysWithActivity = 0;
  const totalCells = weeks * 7;

  for (let i = 0; i < totalCells; i++) {
    const p = addTaiwanCalendarDays(startParts.year, startParts.month, startParts.day, i);
    const dayKey = dayKeyFromParts(p.year, p.month, p.day);
    const isFuture = dayKey > todayKey;
    const count = isFuture ? 0 : (counts.get(dayKey) ?? 0);
    if (!isFuture) {
      totalCount += count;
      if (count > 0) daysWithActivity += 1;
    }
    const level = heatLevelFromCount(count);
    const labelMd = formatMd(p.month, p.day);
    cells.push({
      dayKey,
      labelMd,
      count,
      level,
      isFuture,
      weekdayMon0: i % 7,
      weekIndex: Math.floor(i / 7),
      title: isFuture ? `${labelMd} · （未來）` : `${labelMd} · ${count} 件`
    });
  }

  const vis = input.visibilityPartial ? "依你的可見權限" : "全隊";
  const startLabel = formatMd(startParts.month, startParts.day);
  const endP = addTaiwanCalendarDays(startParts.year, startParts.month, startParts.day, totalCells - 1);
  const endLabel = formatMd(endP.month, endP.day);

  let emptyText: string | null = null;
  if (totalCount === 0) {
    emptyText = "近 8 週尚無記到文案生成時間的草稿（格上為 0）";
  }

  let truncationNote: string | null = null;
  if (input.rows.length >= fetchLimit) {
    truncationNote = `已載入上限 ${fetchLimit} 筆，熱圖可能未列完`;
  }

  return {
    weeks,
    cells,
    range,
    totalCount,
    daysWithActivity,
    honestyLabel: "台灣日 · 依文案生成時間 · 非 GSC／銷售",
    subHint: `${vis} · ${range.label}（${startLabel}～${endLabel}）· copy_generated_at`,
    emptyText,
    truncationNote
  };
}

/**
 * Rework rate: drafts with any field_name having ≥2 history rows in window /
 * drafts with ≥1 history row in window.
 */
export function computeReworkRateView(input: {
  historyRows: HealthHistoryRow[];
  fetchLimit?: number;
  now?: Date;
  visibilityPartial?: boolean;
}): ReworkRateView {
  const now = input.now ?? new Date();
  const range = taiwanLastNDaysRange(RATE_WINDOW_DAYS, now);
  const fetchLimit = input.fetchLimit ?? HEALTH_HISTORY_FETCH_LIMIT;

  // draft_id → field_name → { total, hasAi }
  const byDraft = new Map<
    string,
    Map<string, { total: number; ai: number; manual: number; nullish: number }>
  >();

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
      bucket = { total: 0, ai: 0, manual: 0, nullish: 0 };
      fields.set(field, bucket);
    }
    bucket.total += 1;
    const prov = r.provider;
    if (prov == null || prov === "") {
      bucket.nullish += 1;
    } else if (prov === MANUAL_HISTORY_PROVIDER) {
      bucket.manual += 1;
    } else {
      bucket.ai += 1;
    }
  }

  let denominator = 0;
  let numerator = 0;
  let aiSecondaryCount = 0;
  let manualOnlyCount = 0;

  for (const [, fields] of byDraft) {
    denominator += 1;
    let reworked = false;
    let hasAiSecondary = false;
    let hasAnySecondary = false;

    for (const [, b] of fields) {
      if (b.total >= 2) {
        reworked = true;
        hasAnySecondary = true;
        // AI secondary: at least 2 rows and at least one AI row on this field
        // (first gen + field regen both AI; or baseline null + AI regen)
        if (b.ai >= 1 && b.total >= 2) {
          hasAiSecondary = true;
        }
      }
    }

    if (reworked) {
      numerator += 1;
      if (hasAiSecondary) aiSecondaryCount += 1;
      else if (hasAnySecondary) manualOnlyCount += 1;
    }
  }

  const ratePct =
    denominator === 0 ? null : Math.round((100 * numerator) / denominator);

  const vis = input.visibilityPartial ? "依你的可見權限" : "全隊";

  let emptyText: string | null = null;
  if (denominator === 0) {
    emptyText = "近 30 日尚無版本紀錄";
  }

  let truncationNote: string | null = null;
  if (input.historyRows.length >= fetchLimit) {
    truncationNote = `已載入上限 ${fetchLimit} 筆 history，重做率可能未列完`;
  }

  const displayLabel =
    ratePct === null ? "—" : `${ratePct}%`;

  return {
    ratePct,
    numerator,
    denominator,
    aiSecondaryCount,
    manualOnlyCount,
    range,
    honestyLabel: "有第二版的草稿比例 · 含 AI 重生與手動存版",
    subHint: `${vis} · ${range.label}（台北 ${range.startKey.slice(5).replace("-", "/")}～${range.endKey.slice(5).replace("-", "/")}）`,
    emptyText,
    truncationNote,
    displayLabel
  };
}

/**
 * Tag warn rate among non-archived drafts with copy_generated_at in last 30 days.
 */
export function computeTagHealthView(input: {
  rows: HealthDraftRow[];
  fetchLimit?: number;
  now?: Date;
  visibilityPartial?: boolean;
}): TagHealthView {
  const now = input.now ?? new Date();
  const range = taiwanLastNDaysRange(RATE_WINDOW_DAYS, now);
  const fetchLimit = input.fetchLimit ?? HEALTH_DRAFT_FETCH_LIMIT;

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
    if (parseTags(r.shopify_tags).length === 0) emptyTagsCount += 1;
  }

  const ratePct =
    denominator === 0 ? null : Math.round((100 * numerator) / denominator);

  const vis = input.visibilityPartial ? "依你的可見權限" : "全隊";

  let emptyText: string | null = null;
  if (denominator === 0) {
    emptyText = "近 30 日尚無記到生成時間的草稿";
  }

  let truncationNote: string | null = null;
  if (input.rows.length >= fetchLimit) {
    truncationNote = `已載入上限 ${fetchLimit} 筆，Tag 提醒率可能未列完`;
  }

  return {
    ratePct,
    numerator,
    denominator,
    needsRevisionCount,
    emptyTagsCount,
    range,
    honestyLabel: "依 warnings 字樣 · 非外部 SEO 分數",
    subHint: `${vis} · ${range.label}`,
    emptyText,
    truncationNote,
    displayLabel: ratePct === null ? "—" : `${ratePct}%`
  };
}

export function computeHealthMetricsView(input: {
  drafts: HealthDraftRow[];
  historyRows: HealthHistoryRow[];
  now?: Date;
  visibilityPartial?: boolean;
  draftFetchLimit?: number;
  historyFetchLimit?: number;
}): HealthMetricsView {
  const now = input.now ?? new Date();
  const visibilityPartial = Boolean(input.visibilityPartial);
  return {
    heatmap: computeHeatmapView({
      rows: input.drafts,
      now,
      visibilityPartial,
      fetchLimit: input.draftFetchLimit
    }),
    rework: computeReworkRateView({
      historyRows: input.historyRows,
      now,
      visibilityPartial,
      fetchLimit: input.historyFetchLimit
    }),
    tagHealth: computeTagHealthView({
      rows: input.drafts,
      now,
      visibilityPartial,
      fetchLimit: input.draftFetchLimit
    }),
    visibilityPartial
  };
}
