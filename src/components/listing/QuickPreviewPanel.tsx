"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { emitJumpToDraft } from "@/lib/drafts/jumpToDraft";
import {
  buildJumpStripGroups,
  jumpGroupToStationFilter,
  type JumpStripDraft
} from "@/lib/drafts/stationJumpStrip";

/**
 * UX-B T5 / T10: 快速預覽（桌機 B 塊 / 手機「新增」子分頁）.
 * CAP-2.5: input/未完成草稿 → /drafts/new?draft= (full navigation);
 * other groups keep emitJumpToDraft.
 */
export function QuickPreviewPanel({
  drafts,
  excludeDraftIds = null,
  title = "快速預覽",
  hint = "未完成→開表單；其他→跳審核區"
}: {
  drafts: JumpStripDraft[];
  /** T10-A: hide currently editing draft from 未完成草稿 group */
  excludeDraftIds?: readonly string[] | null;
  title?: string;
  hint?: string;
}) {
  const router = useRouter();
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
        {/* UX-AB T85: unified empty-state */}
        <div className="empty-state">
          <div className="empty-icon" aria-hidden>
            📋
          </div>
          <p className="empty-state-title">尚無可預覽的稿件</p>
          <p className="empty-state-desc">從「新增」開始建立第一筆</p>
        </div>
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
                className={`queue-chip${item.isInterrupted ? " is-interrupted" : ""}`}
                title={
                  item.isInterrupted
                    ? `${item.title} · ${item.shortDate} · 可能中斷`
                    : `${item.title} · ${item.shortDate}`
                }
                onClick={() => {
                  if (item.group === "input") {
                    // CAP-2.5: full page nav so server reloads seed
                    router.push(`/drafts/new?draft=${encodeURIComponent(item.draftId)}`);
                    return;
                  }
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
