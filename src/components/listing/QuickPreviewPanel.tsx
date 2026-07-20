"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/Toast";
import { isArchiveBusyStatus } from "@/lib/drafts/archiveDrafts";
import { emitJumpToDraft } from "@/lib/drafts/jumpToDraft";
import { undoArchiveDrafts, UNDO_TOAST_MS } from "@/lib/drafts/quickUndo";
import { scheduleRouterRefresh } from "@/lib/drafts/scheduleRouterRefresh";
import {
  buildJumpStripGroups,
  daysSince,
  jumpGroupToStationFilter,
  type JumpStripDraft,
  type JumpStripItem
} from "@/lib/drafts/stationJumpStrip";

/**
 * UX-B T5 / T10: 快速預覽（桌機 B 塊 / 手機「新增」子分頁）.
 * CAP-2.5: input/未完成草稿 → /drafts/new?draft= (full navigation);
 * other groups keep emitJumpToDraft.
 * UX-B2-P06: card-style chips + 停留天數 + × soft-archive.
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
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(() => new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  const groups = useMemo(() => {
    const built = buildJumpStripGroups(drafts, { excludeDraftIds });
    if (hiddenIds.size === 0) return built;
    return built
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !hiddenIds.has(item.draftId))
      }))
      .filter((group) => group.items.length > 0);
  }, [drafts, excludeDraftIds, hiddenIds]);

  const dismissDraft = useCallback(
    async (draftId: string) => {
      if (dismissingIds.has(draftId)) return;
      const draft = drafts.find((d) => d.id === draftId);
      if (draft?.status && isArchiveBusyStatus(draft.status)) {
        showToast("生成中／上架中，請稍後再移出", "error");
        return;
      }

      setDismissingIds((prev) => new Set(prev).add(draftId));
      // Optimistic hide; refresh is source of truth
      setHiddenIds((prev) => new Set(prev).add(draftId));

      try {
        const response = await fetch("/api/drafts/batch/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftIds: [draftId], action: "archive" })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setHiddenIds((prev) => {
            const next = new Set(prev);
            next.delete(draftId);
            return next;
          });
          showToast(
            typeof payload.error === "string" ? payload.error : "移出草稿失敗",
            "error"
          );
          return;
        }

        const archivedIds = (payload.archivedIds as string[] | undefined) ?? [];
        const skippedBusy = Number(payload.skippedBusyCount ?? 0);
        if (!archivedIds.length) {
          setHiddenIds((prev) => {
            const next = new Set(prev);
            next.delete(draftId);
            return next;
          });
          showToast(
            skippedBusy > 0
              ? "生成中／上架中，請稍後再移出"
              : typeof payload.message === "string"
                ? payload.message
                : "沒有可移出的草稿",
            "error"
          );
          return;
        }

        const msg =
          typeof payload.message === "string" ? payload.message : "已移出草稿";
        showToast(msg, "success", UNDO_TOAST_MS.archive, {
          actionLabel: "復原",
          onAction: async () => {
            const result = await undoArchiveDrafts(archivedIds);
            showToast(result.message, result.ok ? "success" : "error");
            if (result.ok) {
              setHiddenIds((prev) => {
                const next = new Set(prev);
                for (const id of archivedIds) next.delete(id);
                return next;
              });
            }
            scheduleRouterRefresh(() => router.refresh());
          }
        });
        scheduleRouterRefresh(() => router.refresh());
      } catch {
        setHiddenIds((prev) => {
          const next = new Set(prev);
          next.delete(draftId);
          return next;
        });
        showToast("移出草稿連線失敗", "error");
      } finally {
        setDismissingIds((prev) => {
          const next = new Set(prev);
          next.delete(draftId);
          return next;
        });
      }
    },
    [dismissingIds, drafts, router]
  );

  const jumpToItem = useCallback(
    (item: JumpStripItem) => {
      if (item.group === "input") {
        // CAP-2.5: full page nav so server reloads seed
        router.push(`/drafts/new?draft=${encodeURIComponent(item.draftId)}`);
        return;
      }
      emitJumpToDraft({
        draftId: item.draftId,
        station: jumpGroupToStationFilter(item.group)
      });
    },
    [router]
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
            {group.items.map((item) => {
              const stayDays = daysSince(item.createdAt ?? item.sortAt);
              const metaLabel = `${item.shortDate} · 已停留 ${stayDays} 天`;
              const titleTip = item.isInterrupted
                ? `${item.title} · ${metaLabel} · 可能中斷`
                : `${item.title} · ${metaLabel}`;
              return (
                <div
                  key={item.draftId}
                  className={`queue-chip${item.isInterrupted ? " is-interrupted" : ""}`}
                  role="button"
                  tabIndex={0}
                  title={titleTip}
                  onClick={() => jumpToItem(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      jumpToItem(item);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="queue-chip-close"
                    aria-label="移出草稿"
                    disabled={dismissingIds.has(item.draftId)}
                    onClick={(e) => {
                      e.stopPropagation();
                      void dismissDraft(item.draftId);
                    }}
                  >
                    ×
                  </button>
                  <span className="queue-chip-title">{item.title}</span>
                  <span className="queue-chip-meta muted">{metaLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
