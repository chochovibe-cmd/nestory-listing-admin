"use client";

import {
  FAIL_FILTER_LABEL,
  STATION_OPTIONS,
  stationNonFailCount,
  totalPipelineFailCount,
  type ResultsFilterKey,
} from "@/lib/drafts/stationFilter";
import type { PipelineStationCounts } from "@/lib/drafts/pipelineStage";

/**
 * UX-B T6: three station pills always visible (0 shown);
 * independent 失敗 pill only when fail total > 0.
 * Display counts = count − fail (non-fail work items).
 * UX-B2-P02 2-4: optional factoryPendingCount badge on image_review.
 */
export function StageFilterPills({
  stage,
  counts,
  onChange,
  ariaLabel = "依站篩選",
  factoryPendingCount,
}: {
  stage: ResultsFilterKey;
  counts: PipelineStationCounts;
  onChange: (next: ResultsFilterKey) => void;
  ariaLabel?: string;
  /** Optional — Results only; Queue list omits. Factory bridge pending review count. */
  factoryPendingCount?: number;
}) {
  const failTotal = totalPipelineFailCount(counts);

  return (
    <div className="pill-group stage-filter-pills" aria-label={ariaLabel} role="toolbar">
      {STATION_OPTIONS.map(({ key, label }) => {
        const count = stationNonFailCount(counts, key);
        const showFactoryBadge =
          key === "image_review" &&
          typeof factoryPendingCount === "number" &&
          factoryPendingCount > 0;
        return (
          <button
            className={`pill-btn${stage === key ? " active" : ""}`}
            key={key}
            onClick={() => onChange(key)}
            type="button"
          >
            {label} {count}
            {showFactoryBadge ? (
              <span className="pill-sub-badge">+{factoryPendingCount} 待驗</span>
            ) : null}
          </button>
        );
      })}
      {failTotal > 0 ? (
        <button
          className={`pill-btn station-fail-pill${stage === "fail" ? " active" : ""}`}
          onClick={() => onChange("fail")}
          type="button"
          title={`${failTotal} 件失敗`}
        >
          {FAIL_FILTER_LABEL} {failTotal}
        </button>
      ) : null}
    </div>
  );
}
