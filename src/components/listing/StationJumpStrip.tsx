"use client";

import { useMemo } from "react";
import { emitJumpToDraft } from "@/lib/drafts/jumpToDraft";
import {
  buildJumpStripGroups,
  jumpGroupToStationFilter,
  type JumpStripDraft
} from "@/lib/drafts/stationJumpStrip";

/**
 * R4 §7 / 回饋 41: 各站掛件總覽 under generate button.
 * Style: existing chip / soft layout tokens only.
 */
export function StationJumpStrip({ drafts }: { drafts: JumpStripDraft[] }) {
  const groups = useMemo(() => buildJumpStripGroups(drafts), [drafts]);

  if (groups.length === 0) return null;

  return (
    <div className="queue-strip" aria-label="各站掛件總覽">
      <div className="queue-strip-head">
        <span className="qtitle">各站掛件總覽</span>
        <span className="queue-hint">點擊跳到對應卡片</span>
      </div>
      {groups.map((group) => (
        <div className="queue-strip-group" key={group.key}>
          <span className="queue-strip-label">
            {group.label}
            <span className="queue-strip-date muted"> · {group.shortDate}</span>
            <span className="queue-strip-count muted">（{group.items.length}）</span>
          </span>
          <div className="queue-strip-chips">
            {group.items.map((item) => (
              <button
                type="button"
                key={item.draftId}
                className="queue-chip"
                title={`${item.title} · ${item.shortDate}`}
                onClick={() => {
                  emitJumpToDraft({
                    draftId: item.draftId,
                    station: jumpGroupToStationFilter(item.group)
                  });
                }}
              >
                <span className="queue-chip-title">{item.title}</span>
                <span className="queue-chip-date muted">{item.shortDate}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
