/**
 * R2: three-station work-queue filter (replaces nine-stage UI pills).
 * Spec §1 / §6 / §13 R2. Uses pipeline_stage via pipelineStage.ts.
 */

import {
  countPipelineStations,
  filterByPipelineStage,
  mapStatusToPipelineStage,
  type PipelineStage,
  type PipelineStationCounts,
  type PipelineStationDraft,
  type PipelineStationKey,
  isPipelineStage,
  PIPELINE_STATION_KEYS,
} from "@/lib/drafts/pipelineStage";

export type StationFilterKey = PipelineStationKey;

export const STATION_FILTER_STORAGE_KEY_RESULTS = "nestory:results-station";
export const STATION_FILTER_STORAGE_KEY_QUEUE = "nestory:queue-station";

export const DEFAULT_STATION: StationFilterKey = "copy_review";

export const STATION_OPTIONS: {
  key: StationFilterKey;
  label: string;
}[] = [
  { key: "copy_review", label: "文案審核" },
  { key: "image_review", label: "圖片審核" },
  { key: "ready", label: "完成待發布" },
];

const STATION_KEY_SET = new Set<string>(PIPELINE_STATION_KEYS);

export function isStationFilterKey(value: unknown): value is StationFilterKey {
  return typeof value === "string" && STATION_KEY_SET.has(value);
}

export function readStoredStation(
  storage: Pick<Storage, "getItem"> | null | undefined,
  storageKey: string
): StationFilterKey {
  try {
    const raw = storage?.getItem(storageKey);
    if (isStationFilterKey(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_STATION;
}

export function writeStoredStation(
  station: StationFilterKey,
  storage: Pick<Storage, "setItem"> | null | undefined,
  storageKey: string
): void {
  try {
    storage?.setItem(storageKey, station);
  } catch {
    /* ignore */
  }
}

export type StationDraft = PipelineStationDraft & {
  id: string;
  status?: string | null;
};

export function resolveDraftStation(draft: PipelineStationDraft): PipelineStage {
  if (isPipelineStage(draft.pipeline_stage)) return draft.pipeline_stage;
  return mapStatusToPipelineStage(draft.status, {
    shopifyProductId: draft.shopify_product_id,
  });
}

/** Work-queue only: three stations (excludes input / published / archived). */
export function isWorkQueueStation(stage: PipelineStage): stage is StationFilterKey {
  return (
    stage === "copy_review" || stage === "image_review" || stage === "ready"
  );
}

export function matchesStation(
  draft: PipelineStationDraft,
  station: StationFilterKey
): boolean {
  return resolveDraftStation(draft) === station;
}

export function filterDraftsByStation<T extends PipelineStationDraft>(
  drafts: T[],
  station: StationFilterKey
): T[] {
  return filterByPipelineStage(drafts, station);
}

/** Only drafts that belong on the workbench station list. */
export function filterWorkQueueDrafts<T extends PipelineStationDraft>(
  drafts: T[]
): T[] {
  return drafts.filter((d) => isWorkQueueStation(resolveDraftStation(d)));
}

export function countStations(
  drafts: PipelineStationDraft[]
): PipelineStationCounts {
  return countPipelineStations(drafts);
}

/**
 * Prefer first non-empty station; if current has items keep it;
 * if all empty keep current (or default).
 */
export function pickDefaultStation(
  counts: PipelineStationCounts,
  preferred?: StationFilterKey | null
): StationFilterKey {
  if (preferred && (counts[preferred] ?? 0) > 0) return preferred;
  for (const key of PIPELINE_STATION_KEYS) {
    if ((counts[key] ?? 0) > 0) return key;
  }
  return preferred && isStationFilterKey(preferred)
    ? preferred
    : DEFAULT_STATION;
}

export { PIPELINE_STATION_KEYS, type PipelineStationCounts };
