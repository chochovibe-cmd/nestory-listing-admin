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
 */
export function StageFilterPills({
  stage,
  counts,
  onChange,
  ariaLabel = "依站篩選",
}: {
  stage: ResultsFilterKey;
  counts: PipelineStationCounts;
  onChange: (next: ResultsFilterKey) => void;
  ariaLabel?: string;
}) {
  const failTotal = totalPipelineFailCount(counts);

  return (
    <div className="pill-group stage-filter-pills" aria-label={ariaLabel} role="toolbar">
      {STATION_OPTIONS.map(({ key, label }) => {
        const count = stationNonFailCount(counts, key);
        return (
          <button
            className={`pill-btn${stage === key ? " active" : ""}`}
            key={key}
            onClick={() => onChange(key)}
            type="button"
          >
            {label} {count}
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
