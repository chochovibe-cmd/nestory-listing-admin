/**
 * E3-open: Make 額度錶（本月操作數估算 / 上限）.
 * Q1-A weighted ops · Q2-A team-wide (not dashboard scope) · Q4-A missing table honest —
 * Zero migration; not Make billing API.
 */

/** Free-tier style default (Make.com free ops/month planning). */
export const DEFAULT_MAKE_OPS_LIMIT = 1000;

/** Docs: ~8–10 Make ops per product on image pipeline. */
export const DEFAULT_OPS_PER_IMAGE_ITEM = 8;

/** Shorter publish scenario estimate per product. */
export const DEFAULT_OPS_PER_PUBLISH_ITEM = 3;

/** Yellow warning when used/limit ≥ this fraction. */
export const MAKE_QUOTA_WARN_RATIO = 0.8;

export type MakeQuotaBatchRow = {
  total_count?: number | null;
  created_at?: string | null;
  created_by?: string | null;
};

export type MakeQuotaWeights = {
  perImageItem: number;
  perPublishItem: number;
};

export type TaiwanMonthRange = {
  /** Inclusive start as UTC ISO (Taipei month day 1 00:00). */
  startIso: string;
  /** Exclusive end = start of next Taipei month (UTC ISO). */
  endIso: string;
  /** Display e.g. 2026/07 */
  labelYm: string;
  /** Short range hint e.g. 7/1～今天 */
  rangeHint: string;
};

/**
 * Asia/Taipei calendar month containing `now`.
 * Uses Intl parts (no extra deps); start/end as absolute instants.
 */
export function taiwanMonthRange(now: Date = new Date()): TaiwanMonthRange {
  const parts = taiwanYmdParts(now);
  const y = parts.year;
  const m = parts.month; // 1–12

  const startIso = taipeiLocalToUtcIso(y, m, 1, 0, 0, 0);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const endIso = taipeiLocalToUtcIso(nextY, nextM, 1, 0, 0, 0);

  const labelYm = `${y}/${String(m).padStart(2, "0")}`;
  const rangeHint = `${m}/1～今天`;

  return {
    startIso,
    endIso,
    labelYm,
    rangeHint
  };
}

function taiwanYmdParts(date: Date): { year: number; month: number; day: number } {
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

/**
 * Interpret y-m-d H:M:S as wall time in Asia/Taipei and return UTC ISO.
 * Binary-search offset (handles DST none for Taipei; still correct).
 */
export function taipeiLocalToUtcIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): string {
  // Initial guess: treat as UTC then correct by Taipei offset at that instant
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

function taiwanYmdHmsParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
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
  const bag: Record<string, string> = {};
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

export function isCreatedInTaiwanMonth(
  createdAt: string | null | undefined,
  range: TaiwanMonthRange
): boolean {
  if (!createdAt || typeof createdAt !== "string") return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  const start = Date.parse(range.startIso);
  const end = Date.parse(range.endIso);
  return t >= start && t < end;
}

export function sumBatchTotalCount(rows: MakeQuotaBatchRow[]): number {
  let sum = 0;
  for (const r of rows) {
    const n = r.total_count;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      sum += Math.floor(n);
    }
  }
  return sum;
}

export function estimateMakeOps(input: {
  imageItemCount: number;
  publishItemCount: number;
  weights?: Partial<MakeQuotaWeights>;
}): number {
  const w: MakeQuotaWeights = {
    perImageItem: input.weights?.perImageItem ?? DEFAULT_OPS_PER_IMAGE_ITEM,
    perPublishItem: input.weights?.perPublishItem ?? DEFAULT_OPS_PER_PUBLISH_ITEM
  };
  const img = Math.max(0, Math.floor(input.imageItemCount)) * w.perImageItem;
  const pub = Math.max(0, Math.floor(input.publishItemCount)) * w.perPublishItem;
  return img + pub;
}

export type MakeQuotaView = {
  used: number;
  limit: number;
  remaining: number;
  /** 0–100 for bar width */
  barPct: number;
  /** used/limit, 0 if limit≤0 */
  usedRatio: number;
  warn: boolean;
  usedLabel: string;
  month: TaiwanMonthRange;
  imageItemCount: number;
  publishItemCount: number;
  imageBatchCount: number;
  publishBatchCount: number;
  /** Honest honesty line always shown */
  honestyLabel: string;
  subHint: string;
  warnText: string | null;
};

export function computeMakeQuotaView(input: {
  imageBatches: MakeQuotaBatchRow[];
  publishBatches: MakeQuotaBatchRow[];
  limit?: number;
  weights?: Partial<MakeQuotaWeights>;
  now?: Date;
}): MakeQuotaView {
  const month = taiwanMonthRange(input.now ?? new Date());
  const imageInMonth = input.imageBatches.filter((r) =>
    isCreatedInTaiwanMonth(r.created_at, month)
  );
  const publishInMonth = input.publishBatches.filter((r) =>
    isCreatedInTaiwanMonth(r.created_at, month)
  );

  const imageItemCount = sumBatchTotalCount(imageInMonth);
  const publishItemCount = sumBatchTotalCount(publishInMonth);
  const used = estimateMakeOps({
    imageItemCount,
    publishItemCount,
    weights: input.weights
  });

  const limitRaw = input.limit ?? DEFAULT_MAKE_OPS_LIMIT;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.floor(limitRaw)
      : DEFAULT_MAKE_OPS_LIMIT;

  const remaining = Math.max(0, limit - used);
  const usedRatio = limit > 0 ? used / limit : 0;
  const barPct = Math.min(100, Math.round(usedRatio * 100));
  const warn = usedRatio >= MAKE_QUOTA_WARN_RATIO;
  const pctLabel = Math.round(usedRatio * 100);

  return {
    used,
    limit,
    remaining,
    barPct,
    usedRatio,
    warn,
    usedLabel: `${used}／${limit}`,
    month,
    imageItemCount,
    publishItemCount,
    imageBatchCount: imageInMonth.length,
    publishBatchCount: publishInMonth.length,
    honestyLabel: "估算 · 非 Make 帳單",
    subHint: `全隊 · 台北 ${month.labelYm}（${month.rangeHint}）· 送圖×${input.weights?.perImageItem ?? DEFAULT_OPS_PER_IMAGE_ITEM}＋發布×${input.weights?.perPublishItem ?? DEFAULT_OPS_PER_PUBLISH_ITEM}`,
    warnText: warn
      ? `已用約 ${pctLabel}% · 接近免費額度，考慮換手（Codex／自架 n8n）`
      : null
  };
}

/**
 * Supabase / PostgREST missing-relation messages → Q4-A honest UI.
 * P1-4: require missing-table phrase or codes — bare table name (42P17) is NOT enough.
 */
export function isMissingBatchTableError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  const mentionsBatchTable =
    m.includes("image_batches") ||
    m.includes("image_batch_items") ||
    m.includes("publish_batches") ||
    m.includes("publish_batch_items");
  if (m.includes("42p01") || m.includes("pgrst205")) {
    return mentionsBatchTable || m.includes("batch");
  }
  if (!mentionsBatchTable) return false;
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table")
  );
}

export function makeQuotaMigrationHint(
  imageError: string | null | undefined,
  publishError: string | null | undefined
): string | null {
  const imgMissing = imageError && isMissingBatchTableError(imageError);
  const pubMissing = publishError && isMissingBatchTableError(publishError);
  if (!imgMissing && !pubMissing) return null;
  const parts: string[] = [];
  if (imgMissing) parts.push("025（image_batches）");
  if (pubMissing) parts.push("027（publish_batches）");
  return `批次表尚未建立，請在 Supabase SQL Editor 執行 migration ${parts.join("、")}。額度無法估算。`;
}

/** Resolve display limit: positive int or default. */
export function resolveMakeOpsLimit(
  envValue: string | undefined | null
): number {
  if (envValue == null || envValue === "") return DEFAULT_MAKE_OPS_LIMIT;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAKE_OPS_LIMIT;
  return Math.floor(n);
}
