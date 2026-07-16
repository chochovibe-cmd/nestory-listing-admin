"use client";

import {
  STATION_OPTIONS,
  type StationFilterKey,
} from "@/lib/drafts/stationFilter";
import type { PipelineStationCounts } from "@/lib/drafts/pipelineStage";

export function StageFilterPills({
  stage,
  counts,
  onChange,
  ariaLabel = "依站篩選",
}: {
  stage: StationFilterKey;
  counts: PipelineStationCounts;
  onChange: (next: StationFilterKey) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="pill-group stage-filter-pills" aria-label={ariaLabel} role="toolbar">
      {STATION_OPTIONS.map(({ key, label }) => {
        const count = counts[key] ?? 0;
        const fail = counts.fail?.[key] ?? 0;
        // R2 §6 / 回饋 18: hide zero-count stations unless selected
        if (count === 0 && stage !== key) {
          return null;
        }
        return (
          <button
            className={`pill-btn${stage === key ? " active" : ""}`}
            key={key}
            onClick={() => onChange(key)}
            type="button"
          >
            {label} {count}
            {fail > 0 ? (
              <span className="station-fail-count" title={`${fail} 件失敗`}>
                {" "}
                · <span className="station-fail-num">{fail}</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
