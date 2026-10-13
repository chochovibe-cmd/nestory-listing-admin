"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ResultCard } from "@/components/listing/ResultCard";
import { showToast } from "@/components/Toast";
import {
  RESULT_CARD_TABS,
  type ResultCardTabId
} from "@/lib/drafts/resultCardTabs";
import {
  createSequentialReviewState,
  reduceSequentialReview,
  sequentialCounts,
  sequentialCurrentId,
  sequentialSkippedIds,
  type SequentialReviewAction,
  type SequentialReviewState
} from "@/lib/drafts/sequentialReview";
import type { ProductDraft, ProductImage, ProductVariantRow } from "@/types/domain";

/** UX-Q T70: focus in editable field → do not steal keys (align UX-I). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/** 站① tabs for 1–5: 文案｜規格｜定價｜Tags｜SEO（無圖片） */
const STATION1_TABS: ResultCardTabId[] = RESULT_CARD_TABS.filter(
  (tab) => tab.id !== "images"
).map((tab) => tab.id);

/** Align with DraftResultsPanel VariantPriceRow (avoid circular import). */
type SeqVariantPriceRow = Pick<
  ProductVariantRow,
  | "id"
  | "draft_id"
  | "twd_price"
  | "compare_at_price"
  | "sort_order"
  | "option1_value"
  | "option2_value"
  | "option3_value"
  | "option1_name"
  | "option2_name"
  | "option3_name"
  | "sku"
  | "cny_price"
  | "price_locked"
  | "inventory_quantity"
  | "inventory_policy"
  | "image_id"
>;

export type SequentialReviewQueueItem = {
  draft: ProductDraft;
  images: ProductImage[];
  variantPrices: SeqVariantPriceRow[];
};

/** copy = 站① 審文案；image = 站② 標圖分流（BX1 延伸） */
export type SequentialReviewMode = "copy" | "image";

function queueItemTitle(item: SequentialReviewQueueItem | undefined): string {
  if (!item) return "商品草稿";
  const raw = item.draft.title_zh || item.draft.taobao_title || "商品草稿";
  return raw.length > 36 ? `${raw.slice(0, 36)}…` : raw;
}

/**
 * UX-Q T70 / BX1: full-screen sequential review.
 * One ResultCard at a time; station action success → next; Esc ends.
 * mode=image: 站② 逐件標圖（A＝標圖通過，1 強制圖片分頁）.
 *
 * REVIEW-FLOW B7: 上一筆／跳過 ›, per-item outcome (done / skipped, see
 * lib/drafts/sequentialReview.ts) and an end-of-round summary when something was skipped.
 */
export function SequentialReviewOverlay({
  open,
  queue,
  onClose,
  onItemDone,
  mode = "copy"
}: {
  open: boolean;
  /** Snapshot at open time (order fixed; ids do not re-sort after approve). */
  queue: SequentialReviewQueueItem[];
  onClose: () => void;
  /**
   * An item was actioned successfully (approve / 標圖通過 / return).
   * `leftStation: false` = it stays at its station (e.g. 送生圖工廠).
   */
  onItemDone?: (draftId: string, info?: { leftStation?: boolean }) => void;
  mode?: SequentialReviewMode;
}) {
  const [review, setReview] = useState<SequentialReviewState>(() =>
    createSequentialReviewState([])
  );
  const [approveSignal, setApproveSignal] = useState(0);
  const [externalTab, setExternalTab] = useState<ResultCardTabId | null>(null);
  const [showHints, setShowHints] = useState(true);
  const isImageMode = mode === "image";

  const dispatch = useCallback((action: SequentialReviewAction) => {
    setReview((state) => reduceSequentialReview(state, action));
  }, []);

  // Reset when opened with a new queue (render-phase reset: no stale first frame, and the
  // close effect below can never see the previous round's "closed" state).
  const [syncedQueue, setSyncedQueue] = useState(queue);
  if (syncedQueue !== queue) {
    setSyncedQueue(queue);
    setReview(createSequentialReviewState(queue.map((item) => item.draft.id)));
  }
  useEffect(() => {
    if (!open) return;
    setApproveSignal(0);
    setExternalTab(isImageMode ? "images" : null);
    setShowHints(true);
  }, [open, queue, isImageMode]);

  const queueById = useMemo(() => {
    const map = new Map<string, SequentialReviewQueueItem>();
    for (const item of queue) map.set(item.draft.id, item);
    return map;
  }, [queue]);

  const counts = sequentialCounts(review);
  const total = counts.total;
  const currentId = sequentialCurrentId(review);
  const current = currentId ? queueById.get(currentId) ?? null : null;
  const inSummary = review.phase === "summary";
  /** UX-W T89: 1-based progress; last item = 100% */
  const progressPct = total === 0 ? 0 : Math.round((counts.position / total) * 100);

  const titleShort = useMemo(() => queueItemTitle(current ?? undefined), [current]);

  const skippedItems = useMemo(
    () =>
      sequentialSkippedIds(review).map((id) => ({
        id,
        index: review.ids.indexOf(id),
        title: queueItemTitle(queueById.get(id))
      })),
    [review, queueById]
  );

  const resetTab = useCallback(() => {
    // 站② 每換一卡仍落在圖片分頁；站① 不強制 tab
    setExternalTab(isImageMode ? "images" : null);
  }, [isImageMode]);

  const goSkip = useCallback(() => {
    dispatch({ type: "skip" });
    resetTab();
  }, [dispatch, resetTab]);

  const goPrev = useCallback(() => {
    dispatch({ type: "back" });
    resetTab();
  }, [dispatch, resetTab]);

  const endReview = useCallback(() => {
    dispatch({ type: "end" });
  }, [dispatch]);

  const handleApproveSuccess = useCallback(
    (info?: { leftStation?: boolean }) => {
      if (!currentId) return;
      onItemDone?.(currentId, info);
      // Pass the id of the item that was acted on: a slow request that resolves after the
      // user already moved on must still mark (and not skip past) the right item.
      dispatch({ type: "done", id: currentId });
      resetTab();
    },
    [currentId, dispatch, onItemDone, resetTab]
  );

  // Round over and nothing skipped → close (toast only when the last item was walked past).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open || review.phase !== "closed") return;
    if (review.closedBy === "finished") {
      showToast(isImageMode ? "逐件標圖結束" : "逐件審核結束", "success");
    }
    onCloseRef.current();
  }, [open, review.phase, review.closedBy, isImageMode]);

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Desktop shortcuts
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key;

      if (key === "Escape") {
        event.preventDefault();
        endReview();
        return;
      }

      // Summary screen: only Esc (above) is a shortcut; buttons handle the rest.
      if (inSummary) return;

      if (key === "ArrowRight" || key === "j" || key === "J") {
        event.preventDefault();
        goSkip();
        return;
      }

      if (key === "ArrowLeft" || key === "k" || key === "K") {
        event.preventDefault();
        goPrev();
        return;
      }

      if (key === "a" || key === "A") {
        event.preventDefault();
        setApproveSignal((n) => n + 1);
        return;
      }

      if (key === "?") {
        event.preventDefault();
        setShowHints((v) => !v);
        return;
      }

      // 站①：1–5 切文案分頁；站②：1 回圖片分頁
      if (isImageMode) {
        if (key === "1") {
          event.preventDefault();
          setExternalTab("images");
        }
        return;
      }

      if (key >= "1" && key <= "5") {
        const tabIndex = Number(key) - 1;
        const tab = STATION1_TABS[tabIndex];
        if (tab) {
          event.preventDefault();
          setExternalTab(tab);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, goSkip, goPrev, endReview, inSummary, isImageMode]);

  // Clear externalTab after one paint so re-pressing same number still works
  useEffect(() => {
    if (!externalTab) return;
    const t = window.setTimeout(() => setExternalTab(null), 0);
    return () => window.clearTimeout(t);
  }, [externalTab]);

  if (!open || (!current && !inSummary)) return null;

  return (
    <div
      aria-modal="true"
      className="modal-overlay open seq-review-overlay"
      role="dialog"
      aria-label={isImageMode ? "逐件標圖" : "逐件審核"}
    >
      <div className="modal-box seq-review-box">
        <div className="modal-hdr seq-review-hdr">
          <div className="seq-review-hdr-main">
            <span className="seq-review-progress" aria-live="polite">
              {inSummary ? "本輪結束" : `第 ${counts.position}／${total} 件`}
              <span className="seq-review-tally">
                {` · 已處理 ${counts.done}・跳過 ${counts.skipped}`}
              </span>
            </span>
            {inSummary ? null : (
              <span className="seq-review-title" title={titleShort}>
                {titleShort}
              </span>
            )}
          </div>
          <div className="seq-review-hdr-actions">
            {inSummary ? null : (
              <>
                <Button
                  size="sm"
                  className="seq-review-end"
                  disabled={review.index <= 0 && !review.fromSummary}
                  onClick={goPrev}
                  type="button"
                  title="上一筆（←／k）"
                >
                  ‹ 上一筆
                </Button>
                <Button
                  size="sm"
                  className="seq-review-end"
                  onClick={goSkip}
                  type="button"
                  title="先跳過這筆，之後可從摘要回來處理（→／j）"
                >
                  跳過 ›
                </Button>
              </>
            )}
            <Button
              size="sm"
              className="seq-review-end"
              onClick={endReview}
              type="button"
              title={isImageMode ? "結束逐件標圖（Esc）" : "結束逐件審核（Esc）"}
            >
              結束逐件
            </Button>
          </div>
        </div>

        {/* UX-W T89: progress bar under header */}
        <div
          aria-label={`${isImageMode ? "標圖" : "審核"}進度 ${counts.position} / ${total}`}
          aria-valuemax={total}
          aria-valuemin={1}
          aria-valuenow={counts.position}
          className="seq-review-progress-track"
          role="progressbar"
        >
          <div
            className="seq-review-progress-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {showHints && !inSummary ? (
          <p className="muted seq-review-hints">
            {isImageMode
              ? "→／j 跳過 · ←／k 上一筆 · A 標圖通過（兩次確認）· 1 圖片分頁 · Esc 結束 · ? 隱藏提示"
              : "→／j 跳過 · ←／k 上一筆 · A 核准 · 1–5 分頁 · Esc 結束 · ? 隱藏提示"}
          </p>
        ) : null}

        <div className="seq-review-body">
          {inSummary ? (
            <div className="seq-review-summary" role="region" aria-label="跳過摘要">
              <p className="seq-review-summary-title">
                <strong>這輪跳過 {counts.skipped} 件</strong>
                {counts.done > 0 ? `（已處理 ${counts.done} 件）` : ""}
              </p>
              <ul className="approve-sum-list">
                {skippedItems.map((item) => (
                  <li className="sum-row sum-row-warn" key={item.id}>
                    <span aria-hidden className="st-dot st-busy" />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="seq-review-jump"
                      onClick={() => dispatch({ type: "jump", index: item.index })}
                      type="button"
                      title="回到這一筆處理"
                    >
                      {item.title}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="approve-sum-actions">
                <button className="approve-sum-btn" onClick={endReview} type="button">
                  結束
                </button>
                <button
                  className="primary approve-sum-btn"
                  onClick={() => {
                    dispatch({ type: "restart_skipped" });
                    resetTab();
                  }}
                  type="button"
                >
                  只看跳過的 {counts.skipped} 件
                </button>
              </div>
            </div>
          ) : current ? (
            <ResultCard
              key={current.draft.id}
              approveSignal={approveSignal}
              defaultExpanded
              draft={current.draft}
              externalTab={externalTab}
              images={current.images}
              onApproveSuccess={handleApproveSuccess}
              sequentialMode
              sequentialStation={isImageMode ? "image" : "copy"}
              variantPrices={current.variantPrices}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
