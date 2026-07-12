"use client";

import {
  STAGE_OPTIONS,
  type StageKey
} from "@/lib/drafts/stageFilter";

export function StageFilterPills({
  stage,
  counts,
  onChange,
  /** Hide stages that need images when queue has none (e.g. 圖片未標記). */
  hideWhenZero,
  ariaLabel = "依階段篩選"
}: {
  stage: StageKey;
  counts: Record<StageKey, number>;
  onChange: (next: StageKey) => void;
  hideWhenZero?: StageKey[];
  ariaLabel?: string;
}) {
  const hidden = new Set(hideWhenZero ?? []);

  return (
    <div className="pill-group stage-filter-pills" aria-label={ariaLabel} role="toolbar">
      {STAGE_OPTIONS.map(({ key, label }) => {
        if (hidden.has(key) && (counts[key] ?? 0) === 0 && stage !== key) {
          return null;
        }
        const count = counts[key] ?? 0;
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
    </div>
  );
}
