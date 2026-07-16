/**
 * E2-open: dashboard 流程漏斗（各階段件數＋平均停留）.
 * Q1 A+A′ main exclusive + image-review side row · Q2-A dwell with honest —
 * Reuses stageFilter vocabulary; zero migration.
 */

import {
  STAGE_FILTER_STORAGE_KEY_QUEUE,
  STAGE_FILTER_STORAGE_KEY_RESULTS,
  writeStoredStage,
  type StageKey
} from "@/lib/drafts/stageFilter";
import { isImageReviewTodo, type TodoDraftRow } from "@/lib/dashboard/todoBuckets";

/** Main trunk + side wings (exclusive assignment). Image review is separate (overlap OK). */
export type FunnelStageKey =
  | "input"
  | "copy_review"
  | "approved"
  | "published"
  | "needs_revision"
  | "failed";

export type FunnelDraftRow = TodoDraftRow & {
  created_at?: string | null;
  copy_generated_at?: string | null;
  reviewed_at?: string | null;
  published_at?: string | null;
};

const INPUT_STATUSES = new Set(["pending_input", "pending_copy", "processing"]);
const APPROVED_STATUSES = new Set(["approved", "publishing"]);
const PUBLISHED_STATUSES = new Set([
  "draft_created",
  "active_published",
  "csv_ready"
]);
const FAILED_STATUSES = new Set(["failed", "api_failed"]);

/**
 * Exclusive funnel assignment for one draft.
 * Priority: archived skip → failed side → needs_revision → main trunk by status.
 * generation_status=failed counts as failed even if status is still pending_*.
 */
export function assignFunnelStage(row: FunnelDraftRow): FunnelStageKey | null {
  if (row.status === "archived") return null;

  if (FAILED_STATUSES.has(row.status) || row.generation_status === "failed") {
    return "failed";
  }
  if (row.status === "needs_revision") return "needs_revision";
  if (INPUT_STATUSES.has(row.status)) return "input";
  if (row.status === "ready_for_review") return "copy_review";
  if (APPROVED_STATUSES.has(row.status)) return "approved";
  if (PUBLISHED_STATUSES.has(row.status)) return "published";
  return null;
}

/** Entry timestamp for dwell; null → honest "—" (Q2-A). */
export function funnelStageEntryAt(
  stage: FunnelStageKey,
  row: FunnelDraftRow
): string | null {
  switch (stage) {
    case "input":
      return typeof row.created_at === "string" && row.created_at ? row.created_at : null;
    case "copy_review":
      return typeof row.copy_generated_at === "string" && row.copy_generated_at
        ? row.copy_generated_at
        : null;
    case "approved":
      return typeof row.reviewed_at === "string" && row.reviewed_at
        ? row.reviewed_at
        : null;
    case "published":
    case "needs_revision":
    case "failed":
      return null;
    default:
      return null;
  }
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Format average dwell; null → "—". */
export function formatDwellAverage(
  avgMs: number | null,
  nowMs: number = Date.now()
): string {
  void nowMs;
  if (avgMs == null || !Number.isFinite(avgMs) || avgMs < 0) return "—";
  if (avgMs < HOUR_MS) return "不到 1 小時";
  if (avgMs < 48 * HOUR_MS) {
    const hours = Math.max(1, Math.round(avgMs / HOUR_MS));
    return `約 ${hours} 小時`;
  }
  const days = Math.round((avgMs / DAY_MS) * 10) / 10;
  return `約 ${days} 天`;
}

export type FunnelStageCount = {
  key: FunnelStageKey;
  count: number;
  /** ms average of (now - entry) for rows with reliable entry; null if none */
  avgDwellMs: number | null;
  dwellLabel: string;
  /** processing/pending_copy count within input (sub only) */
  inputInProgress?: number;
};

export type FunnelStats = {
  stages: Record<FunnelStageKey, FunnelStageCount>;
  /** max count among exclusive stages (for bar width) */
  maxCount: number;
  image_review: number;
  scanned: number;
  truncated: boolean;
};

export function computeFunnelStats(
  rows: FunnelDraftRow[],
  fetchLimit: number,
  nowMs: number = Date.now()
): FunnelStats {
  const dwellSums: Record<FunnelStageKey, { sum: number; n: number }> = {
    input: { sum: 0, n: 0 },
    copy_review: { sum: 0, n: 0 },
    approved: { sum: 0, n: 0 },
    published: { sum: 0, n: 0 },
    needs_revision: { sum: 0, n: 0 },
    failed: { sum: 0, n: 0 }
  };
  const counts: Record<FunnelStageKey, number> = {
    input: 0,
    copy_review: 0,
    approved: 0,
    published: 0,
    needs_revision: 0,
    failed: 0
  };
  let inputInProgress = 0;
  let image_review = 0;

  for (const row of rows) {
    if (row.status === "archived") continue;

    if (isImageReviewTodo(row)) image_review += 1;

    const stage = assignFunnelStage(row);
    if (!stage) continue;

    counts[stage] += 1;
    if (stage === "input" && (row.status === "pending_copy" || row.status === "processing")) {
      inputInProgress += 1;
    }

    const entry = funnelStageEntryAt(stage, row);
    if (entry) {
      const t = Date.parse(entry);
      if (Number.isFinite(t) && t <= nowMs) {
        dwellSums[stage].sum += nowMs - t;
        dwellSums[stage].n += 1;
      }
    }
  }

  const stages = {} as Record<FunnelStageKey, FunnelStageCount>;
  let maxCount = 0;
  for (const key of Object.keys(counts) as FunnelStageKey[]) {
    const n = counts[key];
    maxCount = Math.max(maxCount, n);
    const { sum, n: dwellN } = dwellSums[key];
    const avgDwellMs = dwellN > 0 ? sum / dwellN : null;
    stages[key] = {
      key,
      count: n,
      avgDwellMs,
      dwellLabel: formatDwellAverage(avgDwellMs, nowMs),
      ...(key === "input" ? { inputInProgress } : {})
    };
  }

  return {
    stages,
    maxCount,
    image_review,
    scanned: rows.length,
    truncated: rows.length >= fetchLimit
  };
}

export type FunnelRowKind = "main" | "side" | "image";

export type FunnelRowDef = {
  key: FunnelStageKey | "image_review";
  kind: FunnelRowKind;
  label: string;
  count: number;
  dwellLabel: string;
  sub: string | null;
  schipClass: string;
  schipLabel: string;
  /** 0–100 relative bar */
  barPct: number;
  href: string;
  stage?: StageKey;
  stageStorageKey?: string;
};

function barPct(count: number, maxCount: number): number {
  if (maxCount <= 0 || count <= 0) return 0;
  return Math.round((count / maxCount) * 100);
}

/**
 * Build display rows: main trunk → side wings → image review (A′).
 * Zero counts still shown (same honesty as E1 cards).
 */
export function buildFunnelRows(stats: FunnelStats): FunnelRowDef[] {
  const max = stats.maxCount;
  const s = stats.stages;

  const main: FunnelRowDef[] = [
    {
      key: "input",
      kind: "main",
      label: "待輸入／進行中",
      count: s.input.count,
      dwellLabel: s.input.dwellLabel,
      sub:
        (s.input.inputInProgress ?? 0) > 0
          ? `含生成中 ${s.input.inputInProgress}`
          : null,
      schipClass: "schip",
      schipLabel: "待輸入",
      barPct: barPct(s.input.count, max),
      // R4: workbench input / results; published → records
      href: "/drafts/new",
      stage: "pending_input",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    },
    {
      key: "copy_review",
      kind: "main",
      label: "文案待審",
      count: s.copy_review.count,
      dwellLabel: s.copy_review.dwellLabel,
      sub: null,
      schipClass: "schip schip--warn",
      schipLabel: "文案已生成・待審核",
      barPct: barPct(s.copy_review.count, max),
      href: "/drafts/new?pane=results",
      stage: "copy_review",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    },
    {
      key: "approved",
      kind: "main",
      label: "已核准・待發布",
      count: s.approved.count,
      dwellLabel: s.approved.dwellLabel,
      sub: null,
      schipClass: "schip schip--ok",
      schipLabel: "已核准・待發布",
      barPct: barPct(s.approved.count, max),
      href: "/drafts/new?pane=results",
      stage: "approved",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    },
    {
      key: "published",
      kind: "main",
      label: "已發布",
      count: s.published.count,
      dwellLabel: "—",
      sub: null,
      schipClass: "schip schip--ok",
      schipLabel: "已發布",
      barPct: barPct(s.published.count, max),
      href: "/records?tab=published",
      stage: "published",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    }
  ];

  const side: FunnelRowDef[] = [
    {
      key: "needs_revision",
      kind: "side",
      label: "需修改",
      count: s.needs_revision.count,
      dwellLabel: "—",
      sub: null,
      schipClass: "schip schip--warn",
      schipLabel: "需修改",
      barPct: barPct(s.needs_revision.count, max),
      href: "/drafts/new?pane=results",
      stage: "needs_revision",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    },
    {
      key: "failed",
      kind: "side",
      label: "失敗",
      count: s.failed.count,
      dwellLabel: "—",
      sub: null,
      schipClass: "schip schip--error",
      schipLabel: "失敗",
      barPct: barPct(s.failed.count, max),
      href: "/drafts/new?pane=results",
      stage: "failed",
      stageStorageKey: STAGE_FILTER_STORAGE_KEY_RESULTS
    }
  ];

  const image: FunnelRowDef = {
    key: "image_review",
    kind: "image",
    label: "圖片待審",
    count: stats.image_review,
    dwellLabel: "—",
    sub: "可與上方主幹重疊（生圖工廠維度）",
    schipClass: "schip schip--warn",
    schipLabel: "圖片待審",
    // bar vs exclusive max; image can exceed max → clamp 100
    barPct: Math.min(100, barPct(stats.image_review, Math.max(max, 1))),
    href: "/review"
  };

  return [...main, ...side, image];
}

export function prepareFunnelNavigation(
  row: Pick<FunnelRowDef, "href" | "stage" | "stageStorageKey">,
  storage: Pick<Storage, "setItem"> | null | undefined
): string {
  if (row.stage && row.stageStorageKey) {
    writeStoredStage(row.stage, storage, row.stageStorageKey);
  }
  return row.href;
}

export function funnelTruncationNotice(stats: Pick<FunnelStats, "truncated" | "scanned">, limit: number): string | null {
  if (!stats.truncated) return null;
  return `最多統計最近 ${limit} 件（目前掃到 ${stats.scanned} 筆）`;
}

