/**
 * R4 §7: pure helpers for 快速預覽 / 各站掛件總覽.
 * Zero DB — callers pass already-loaded drafts.
 * UX-B T5/T10: §2.2 labels; exclude current editing draft from 未完成草稿.
 */

import {
  mapStatusToPipelineStage,
  type PipelineStage,
  isPipelineStage
} from "@/lib/drafts/pipelineStage";
import type { StationFilterKey } from "@/lib/drafts/stationFilter";

export type JumpStripDraft = {
  id: string;
  title_zh?: string | null;
  taobao_title?: string | null;
  original_title?: string | null;
  status?: string | null;
  pipeline_stage?: string | null;
  /** Real generation flag; design wording "pipeline_stage=generating" maps here. */
  generation_status?: string | null;
  shopify_product_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** UX-AE T134: stuck mid-generation when last update > 2 minutes ago. */
export const JUMP_STRIP_INTERRUPT_MS = 120_000;

/**
 * T134: interrupted = generating-like + updated_at older than 2 min.
 * Design says pipeline_stage === 'generating' (not a real pipeline key);
 * also treat generation_status/status processing as generating.
 */
export function isJumpStripInterrupted(
  draft: JumpStripDraft,
  nowMs: number = Date.now()
): boolean {
  const generating =
    draft.pipeline_stage === "generating" ||
    draft.generation_status === "processing" ||
    draft.status === "processing";
  if (!generating) return false;
  if (!draft.updated_at) return false;
  const t = new Date(draft.updated_at).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t > JUMP_STRIP_INTERRUPT_MS;
}

/** Stations shown in the jump strip (work queue + input remnants). */
export type JumpStripGroupKey = "input" | StationFilterKey;

export const JUMP_STRIP_GROUP_ORDER: JumpStripGroupKey[] = [
  "input",
  "copy_review",
  "image_review",
  "ready"
];

/** §2.2 / T10: input remnants = 未完成草稿 (not scary 待輸入). */
export const JUMP_STRIP_GROUP_LABELS: Record<JumpStripGroupKey, string> = {
  input: "未完成草稿",
  copy_review: "文案待審核",
  image_review: "圖片待標示",
  ready: "完成待發布"
};

export type JumpStripItem = {
  draftId: string;
  title: string;
  group: JumpStripGroupKey;
  shortDate: string;
  sortAt: string;
  /** UX-AE T134: show ⚠ on quick-preview chip */
  isInterrupted: boolean;
};

export type JumpStripGroup = {
  key: JumpStripGroupKey;
  label: string;
  shortDate: string;
  items: JumpStripItem[];
};

export type BuildJumpStripGroupsOpts = {
  /**
   * UX-B T10 scheme A: exclude these ids from the input/未完成草稿 group
   * (typically the draft currently being edited on the form).
   * Station groups (①②③) are not filtered by this.
   */
  excludeDraftIds?: readonly string[] | null;
};

export function jumpStripTitle(draft: JumpStripDraft): string {
  return (
    draft.title_zh?.trim() ||
    draft.taobao_title?.trim() ||
    draft.original_title?.trim() ||
    "未命名"
  );
}

export function shortJumpDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}/${dd}`;
  } catch {
    return "—";
  }
}

export function resolveJumpStripGroup(draft: JumpStripDraft): JumpStripGroupKey | null {
  const stage: PipelineStage = isPipelineStage(draft.pipeline_stage)
    ? draft.pipeline_stage
    : mapStatusToPipelineStage(draft.status, {
        shopifyProductId: draft.shopify_product_id
      });
  if (stage === "input") return "input";
  if (stage === "copy_review") return "copy_review";
  if (stage === "image_review") return "image_review";
  if (stage === "ready") return "ready";
  return null;
}

/** Build grouped hangers; empty groups omitted. Newest first within group. */
export function buildJumpStripGroups(
  drafts: JumpStripDraft[],
  opts?: BuildJumpStripGroupsOpts
): JumpStripGroup[] {
  const exclude = new Set(
    (opts?.excludeDraftIds ?? []).filter((id) => typeof id === "string" && id.length > 0)
  );
  const buckets = new Map<JumpStripGroupKey, JumpStripItem[]>();
  for (const key of JUMP_STRIP_GROUP_ORDER) buckets.set(key, []);

  for (const draft of drafts) {
    const group = resolveJumpStripGroup(draft);
    if (!group) continue;
    // T10-A: current editing draft must not appear under 未完成草稿
    if (group === "input" && exclude.has(draft.id)) continue;
    const sortAt = draft.updated_at || draft.created_at || "";
    buckets.get(group)!.push({
      draftId: draft.id,
      title: jumpStripTitle(draft),
      group,
      shortDate: shortJumpDate(sortAt),
      sortAt,
      isInterrupted: isJumpStripInterrupted(draft)
    });
  }

  const groups: JumpStripGroup[] = [];
  for (const key of JUMP_STRIP_GROUP_ORDER) {
    const items = buckets.get(key) ?? [];
    if (items.length === 0) continue;
    items.sort((a, b) => (b.sortAt || "").localeCompare(a.sortAt || ""));
    const shortDate = items[0]?.shortDate ?? "—";
    groups.push({
      key,
      label: JUMP_STRIP_GROUP_LABELS[key],
      shortDate,
      items
    });
  }
  return groups;
}

/** Station filter for results pane (input → copy_review as nearest work station). */
export function jumpGroupToStationFilter(
  group: JumpStripGroupKey
): StationFilterKey {
  if (group === "input") return "copy_review";
  return group;
}
