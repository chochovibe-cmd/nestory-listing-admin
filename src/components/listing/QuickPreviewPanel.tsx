"use client";

import { useMemo } from "react";
import { emitJumpToDraft } from "@/lib/drafts/jumpToDraft";
import {
  buildJumpStripGroups,
  jumpGroupToStationFilter,
  type JumpStripDraft
} from "@/lib/drafts/stationJumpStrip";

/**
 * UX-B T5 / T10: 快速預覽（桌機 B 塊 / 手機「新增」子分頁）.
 * Not a full ResultCard — grouped summary chips → emitJumpToDraft.
 * Reuses .queue-strip tokens (same as former StationJumpStrip).
 */
export function QuickPreviewPanel({
  drafts,
  excludeDraftIds = null,
  title = "快速預覽",
  hint = "點擊跳到審核區對應卡片"
}: {
  drafts: JumpStripDraft[];
  /** T10-A: hide currently editing draft from 未完成草稿 group */
  excludeDraftIds?: readonly string[] | null;
  title?: string;
  hint?: string;
}) {
  const groups = useMemo(
    () => buildJumpStripGroups(drafts, { excludeDraftIds }),
    [drafts, excludeDraftIds]
  );

  if (groups.length === 0) {
    return (
      <div className="panel queue-strip quick-preview-panel" aria-label={title}>
        <div className="queue-strip-head">
          <span className="qtitle">{title}</span>
        </div>
        <p className="muted quick-preview-empty">尚無可預覽的稿件</p>
      </div>
    );
  }

  return (
    <div className="panel queue-strip quick-preview-panel" aria-label={title}>
      <div className="queue-strip-head">
        <span className="qtitle">{title}</span>
        <span className="queue-hint">{hint}</span>
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
