/**
 * UX-J T56: Result card collapsed status — station/flow copy is primary;
 * StatusBadge only when it adds information beyond the station.
 * Display-only; does not change draft.status / pipeline_stage.
 */

import {
  isDraftStationFail,
  type PipelineStage,
  type PipelineStationDraft
} from "@/lib/drafts/pipelineStage";
import { resolveDraftStation } from "@/lib/drafts/stationFilter";

/** User-facing station / flow labels (Chinese only). */
export function stationFlowPrimaryLabel(
  draft: PipelineStationDraft
): { label: string; kind: "station" | "fail" } {
  if (isDraftStationFail(draft)) {
    return { label: "失敗", kind: "fail" };
  }
  const station = resolveDraftStation(draft);
  switch (station as PipelineStage) {
    case "copy_review":
      return { label: "審文案", kind: "station" };
    case "image_review":
      return { label: "標圖", kind: "station" };
    case "ready":
      return { label: "待發布", kind: "station" };
    case "published":
      return { label: "已發布", kind: "station" };
    case "archived":
      return { label: "已封存", kind: "station" };
    case "input":
      return { label: "待輸入", kind: "station" };
    default:
      return { label: "處理中", kind: "station" };
  }
}

/**
 * Statuses that only restate the station (hide on ResultCard).
 * e.g. 站① + ready_for_review → "待審核" fights "審文案".
 */
const REDUNDANT_WITH_STATION: Record<string, ReadonlySet<string>> = {
  copy_review: new Set([
    "ready_for_review",
    "pending",
    "pending_copy",
    "pending_input",
    "processing",
    "completed",
    "approved"
  ]),
  image_review: new Set([
    "ready_for_review",
    "approved",
    "processing",
    "pending",
    "completed"
  ]),
  ready: new Set(["approved", "ready_for_review", "completed", "pending"]),
  input: new Set(["pending_input", "pending_copy", "processing", "pending"]),
  published: new Set(["active_published", "draft_created", "approved"]),
  archived: new Set(["archived"])
};

/** Incremental DraftStatus values worth a secondary chip. */
const INCREMENTAL_STATUSES = new Set([
  "needs_revision",
  "publishing",
  "csv_ready",
  "api_failed",
  "failed",
  "archived",
  "active_published",
  "draft_created"
]);

/**
 * Secondary StatusBadge key, or null when redundant / no extra info.
 * When primary is already「失敗」, hide failed/api_failed badges.
 */
export function secondaryStatusForResultCard(
  draft: PipelineStationDraft & { status?: string | null }
): string | null {
  const status = draft.status ?? "";
  if (!status) return null;

  const primary = stationFlowPrimaryLabel(draft);
  if (primary.kind === "fail" && (status === "failed" || status === "api_failed")) {
    return null;
  }

  if (!INCREMENTAL_STATUSES.has(status)) {
    // Non-incremental: only show if not in redundant set for current station
    const station = resolveDraftStation(draft);
    const redundant = REDUNDANT_WITH_STATION[station];
    if (redundant?.has(status)) return null;
    // Unknown statuses: show Chinese via StatusBadge rather than English leak
    if (redundant) return null;
    return status;
  }

  const station = resolveDraftStation(draft);
  const redundant = REDUNDANT_WITH_STATION[station];
  if (redundant?.has(status)) return null;

  // Station already says 已封存 / 已發布 — avoid double chip
  if (primary.label === "已封存" && status === "archived") return null;
  if (primary.label === "已發布" && (status === "active_published" || status === "draft_created")) {
    return status === "draft_created" ? "draft_created" : null;
  }

  return status;
}
