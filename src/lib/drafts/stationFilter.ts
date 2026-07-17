/**
 * R2: three-station work-queue filter (replaces nine-stage UI pills).
 * Spec §1 / §6 / §13 R2. Uses pipeline_stage via pipelineStage.ts.
 * UX-B T6: labels §2.2；失敗為 UI filter key（非新 pipeline_stage）。
 */

import {
  countPipelineStations,
  filterByPipelineStage,
  filterFailDrafts,
  filterNonFailByStation,
  mapStatusToPipelineStage,
  stationNonFailCount,
  totalPipelineFailCount,
  type PipelineStage,
  type PipelineStationCounts,
  type PipelineStationDraft,
  type PipelineStationKey,
  isPipelineStage,
  PIPELINE_STATION_KEYS,
} from "@/lib/drafts/pipelineStage";

export type StationFilterKey = PipelineStationKey;

/** Results/queue pill selection: three stations + optional independent fail filter. */
export type ResultsFilterKey = StationFilterKey | "fail";

export const STATION_FILTER_STORAGE_KEY_RESULTS = "nestory:results-station";
export const STATION_FILTER_STORAGE_KEY_QUEUE = "nestory:queue-station";

export const DEFAULT_STATION: StationFilterKey = "copy_review";
export const DEFAULT_RESULTS_FILTER: ResultsFilterKey = "copy_review";

/** §2.2 user-visible station names (DB keys unchanged). */
export const STATION_OPTIONS: {
  key: StationFilterKey;
  label: string;
}[] = [
  { key: "copy_review", label: "審文案" },
  { key: "image_review", label: "標圖" },
  { key: "ready", label: "待發布" },
];

export const FAIL_FILTER_LABEL = "⚠ 失敗";

const STATION_KEY_SET = new Set<string>(PIPELINE_STATION_KEYS);

export function isStationFilterKey(value: unknown): value is StationFilterKey {
  return typeof value === "string" && STATION_KEY_SET.has(value);
}

export function isResultsFilterKey(value: unknown): value is ResultsFilterKey {
  return isStationFilterKey(value) || value === "fail";
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

/** UX-B T6: may restore "fail" pill selection. */
export function readStoredResultsFilter(
  storage: Pick<Storage, "getItem"> | null | undefined,
  storageKey: string
): ResultsFilterKey {
  try {
    const raw = storage?.getItem(storageKey);
    if (isResultsFilterKey(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_RESULTS_FILTER;
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

export function writeStoredResultsFilter(
  filter: ResultsFilterKey,
  storage: Pick<Storage, "setItem"> | null | undefined,
  storageKey: string
): void {
  try {
    storage?.setItem(storageKey, filter);
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

/**
 * UX-B T6: list for the active pill.
 * - station: non-fail only (count − fail)
 * - fail: all station-fail lights
 */
export function filterDraftsByResultsFilter<T extends PipelineStationDraft>(
  drafts: T[],
  filter: ResultsFilterKey
): T[] {
  if (filter === "fail") return filterFailDrafts(drafts);
  return filterNonFailByStation(drafts, filter);
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
 * Uses non-fail counts for station keys; fail pill keeps if total fail > 0.
 */
export function pickDefaultStation(
  counts: PipelineStationCounts,
  preferred?: StationFilterKey | null
): StationFilterKey {
  if (preferred && stationNonFailCount(counts, preferred) > 0) return preferred;
  for (const key of PIPELINE_STATION_KEYS) {
    if (stationNonFailCount(counts, key) > 0) return key;
  }
  return preferred && isStationFilterKey(preferred)
    ? preferred
    : DEFAULT_STATION;
}

export function pickDefaultResultsFilter(
  counts: PipelineStationCounts,
  preferred?: ResultsFilterKey | null
): ResultsFilterKey {
  if (preferred === "fail" && totalPipelineFailCount(counts) > 0) return "fail";
  if (preferred && preferred !== "fail" && stationNonFailCount(counts, preferred) > 0) {
    return preferred;
  }
  for (const key of PIPELINE_STATION_KEYS) {
    if (stationNonFailCount(counts, key) > 0) return key;
  }
  if (totalPipelineFailCount(counts) > 0) return "fail";
  return preferred && isResultsFilterKey(preferred)
    ? preferred
    : DEFAULT_RESULTS_FILTER;
}

export {
  PIPELINE_STATION_KEYS,
  stationNonFailCount,
  totalPipelineFailCount,
  filterFailDrafts,
  type PipelineStationCounts,
};
