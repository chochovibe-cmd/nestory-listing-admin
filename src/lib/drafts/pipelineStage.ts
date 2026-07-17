/**
 * R1: pipeline_stage mapping + three-station badge counts (data layer only).
 * Spec: docs/流程重構規格書-2026-07-16.md §2 / §6 / §13 R1.
 * Dual-write with draft status until R2+ retires status gradually.
 */

export const PIPELINE_STAGES = [
  "input",
  "copy_review",
  "image_review",
  "ready",
  "published",
  "archived"
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Work-queue stations shown as tab badges (R2 UI). */
export type PipelineStationKey = "copy_review" | "image_review" | "ready";

export const PIPELINE_STATION_KEYS: PipelineStationKey[] = [
  "copy_review",
  "image_review",
  "ready"
];

const STAGE_SET = new Set<string>(PIPELINE_STAGES);

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && STAGE_SET.has(value);
}

/** Non-empty Shopify product GID / mock id → historical §11 endpoint. */
export function hasShopifyProductId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export type MapStatusToPipelineStageOpts = {
  /**
   * Q4-B: when status=approved and this is set, map to published (§11
   * historical "approve created Shopify draft"). New approves omit this → image_review.
   */
  shopifyProductId?: string | null;
};

/**
 * Status → pipeline_stage (same table as migration 029 backfill).
 * Unknown status falls back to input.
 */
export function mapStatusToPipelineStage(
  status: string | null | undefined,
  opts?: MapStatusToPipelineStageOpts
): PipelineStage {
  switch (status ?? "") {
    case "pending_input":
    case "pending_copy":
    case "processing":
      return "input";
    case "ready_for_review":
    case "needs_revision":
    case "failed":
      return "copy_review";
    case "approved":
      return hasShopifyProductId(opts?.shopifyProductId)
        ? "published"
        : "image_review";
    case "publishing":
      return "ready";
    case "csv_ready":
    case "draft_created":
    case "active_published":
    case "api_failed":
      return "published";
    case "archived":
      return "archived";
    default:
      return "input";
  }
}

/** Convenience for dual-write patches: { pipeline_stage }. */
export function pipelineStagePatch(
  status: string | null | undefined,
  opts?: MapStatusToPipelineStageOpts
): { pipeline_stage: PipelineStage } {
  return { pipeline_stage: mapStatusToPipelineStage(status, opts) };
}

export type PipelineStationDraft = {
  id?: string;
  pipeline_stage?: string | null;
  /** Fallback when pipeline_stage missing (pre-migration rows / partial selects). */
  status?: string | null;
  generation_status?: string | null;
  image_status?: string | null;
  publish_status?: string | null;
  shopify_product_id?: string | null;
};

export type PipelineStationCounts = {
  copy_review: number;
  image_review: number;
  ready: number;
  fail: {
    copy_review: number;
    image_review: number;
    /** Q5-A: always 0 in R1 — publish fails live on records page, not station badges. */
    ready: number;
  };
};

function resolveStage(row: PipelineStationDraft): PipelineStage {
  if (isPipelineStage(row.pipeline_stage)) return row.pipeline_stage;
  return mapStatusToPipelineStage(row.status, {
    shopifyProductId: row.shopify_product_id
  });
}

/** Copy-station fail light (generation / draft status failed). */
export function isCopyFail(row: PipelineStationDraft): boolean {
  return row.status === "failed" || row.generation_status === "failed";
}

/** Image-station fail light (image pipeline failed). */
export function isImageFail(row: PipelineStationDraft): boolean {
  return row.image_status === "failed";
}

/**
 * UX-B T6: draft counts as station-fail for the independent 失敗 pill.
 * Mirrors countPipelineStations fail lights (no new pipeline_stage).
 */
export function isDraftStationFail(row: PipelineStationDraft): boolean {
  const stage = resolveStage(row);
  if (stage === "copy_review") return isCopyFail(row);
  if (stage === "image_review") return isImageFail(row);
  // Q5-A: ready has no fail light in counts; still no fail.ready rows.
  return false;
}

/** Sum of fail.* from countPipelineStations (copy + image + ready). */
export function totalPipelineFailCount(counts: PipelineStationCounts): number {
  return (
    (counts.fail?.copy_review ?? 0) +
    (counts.fail?.image_review ?? 0) +
    (counts.fail?.ready ?? 0)
  );
}

/** Station pill display count = total at station − fail light (non-fail work items). */
export function stationNonFailCount(
  counts: PipelineStationCounts,
  key: PipelineStationKey
): number {
  const total = counts[key] ?? 0;
  const fail = counts.fail?.[key] ?? 0;
  return Math.max(0, total - fail);
}

/** Filter to drafts whose station fail light is true. */
export function filterFailDrafts<T extends PipelineStationDraft>(rows: T[]): T[] {
  return rows.filter((row) => isDraftStationFail(row));
}

/** Work-queue station rows excluding station-fail lights (no double-list with 失敗 pill). */
export function filterNonFailByStation<T extends PipelineStationDraft>(
  rows: T[],
  stage: PipelineStationKey
): T[] {
  return filterByPipelineStage(rows, stage).filter((row) => !isDraftStationFail(row));
}

/**
 * Three-station badge counts + per-station failure lights (pure; unit-testable).
 * Does not count input / published / archived. Publish failures (api_failed) are
 * intentionally excluded from fail.ready (Q5-A).
 */
export function countPipelineStations(
  rows: PipelineStationDraft[]
): PipelineStationCounts {
  const out: PipelineStationCounts = {
    copy_review: 0,
    image_review: 0,
    ready: 0,
    fail: { copy_review: 0, image_review: 0, ready: 0 }
  };

  for (const row of rows) {
    const stage = resolveStage(row);
    if (stage === "copy_review") {
      out.copy_review += 1;
      if (isCopyFail(row)) out.fail.copy_review += 1;
    } else if (stage === "image_review") {
      out.image_review += 1;
      if (isImageFail(row)) out.fail.image_review += 1;
    } else if (stage === "ready") {
      out.ready += 1;
      // Q5-A: do not count api_failed / publish_status failures here.
    }
  }

  return out;
}

export function filterByPipelineStage<T extends PipelineStationDraft>(
  rows: T[],
  stage: PipelineStage
): T[] {
  return rows.filter((row) => resolveStage(row) === stage);
}
