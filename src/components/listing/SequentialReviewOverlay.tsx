"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ResultCard } from "@/components/listing/ResultCard";
import { showToast } from "@/components/Toast";
import {
  RESULT_CARD_TABS,
  type ResultCardTabId
} from "@/lib/drafts/resultCardTabs";
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

/**
 * UX-Q T70 / BX1: full-screen sequential review.
 * One ResultCard at a time; station action success → next; Esc ends.
 * mode=image: 站② 逐件標圖（A＝標圖通過，1 強制圖片分頁）.
 */
export function SequentialReviewOverlay({
  open,
  queue,
  onClose,
  mode = "copy"
}: {
  open: boolean;
  /** Snapshot at open time (order fixed; ids do not re-sort after approve). */
  queue: SequentialReviewQueueItem[];
  onClose: () => void;
  mode?: SequentialReviewMode;
}) {
  const [index, setIndex] = useState(0);
  const [approveSignal, setApproveSignal] = useState(0);
  const [externalTab, setExternalTab] = useState<ResultCardTabId | null>(null);
  const [showHints, setShowHints] = useState(true);
  const isImageMode = mode === "image";

  // Reset when opened with a new queue
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setApproveSignal(0);
    setExternalTab(isImageMode ? "images" : null);
    setShowHints(true);
  }, [open, queue, isImageMode]);

  const total = queue.length;
  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1);
  const current = total > 0 ? queue[safeIndex] : null;
  /** UX-W T89: 1-based progress; last item = 100% */
  const progressPct = total === 0 ? 0 : Math.round(((safeIndex + 1) / total) * 100);

  const titleShort = useMemo(() => {
    if (!current) return "";
    const raw =
      current.draft.title_zh || current.draft.taobao_title || "商品草稿";
    return raw.length > 36 ? `${raw.slice(0, 36)}…` : raw;
  }, [current]);

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (total === 0) return 0;
      if (i >= total - 1) return i;
      return i + 1;
    });
    // 站② 每換一卡仍落在圖片分頁；站① 不強制 tab
    setExternalTab(isImageMode ? "images" : null);
  }, [total, isImageMode]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
    setExternalTab(isImageMode ? "images" : null);
  }, [isImageMode]);

  const handleApproveSuccess = useCallback(() => {
    if (safeIndex >= total - 1) {
      showToast(isImageMode ? "逐件標圖結束" : "逐件審核結束", "success");
      onClose();
      return;
    }
    goNext();
  }, [safeIndex, total, goNext, onClose, isImageMode]);

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
        onClose();
        return;
      }

      if (key === "ArrowRight" || key === "j" || key === "J") {
        event.preventDefault();
        goNext();
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
  }, [open, goNext, goPrev, onClose, isImageMode]);

  // Clear externalTab after one paint so re-pressing same number still works
  useEffect(() => {
    if (!externalTab) return;
    const t = window.setTimeout(() => setExternalTab(null), 0);
    return () => window.clearTimeout(t);
  }, [externalTab]);

  if (!open || !current) return null;

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
              {safeIndex + 1} / {total}
            </span>
            <span className="seq-review-title" title={titleShort}>
              {titleShort}
            </span>
          </div>
          <button
            className="btn-mini seq-review-end"
            onClick={onClose}
            type="button"
            title={isImageMode ? "結束逐件標圖（Esc）" : "結束逐件審核（Esc）"}
          >
            結束逐件
          </button>
        </div>

        {/* UX-W T89: progress bar under header */}
        <div
          aria-label={`${isImageMode ? "標圖" : "審核"}進度 ${safeIndex + 1} / ${total}`}
          aria-valuemax={total}
          aria-valuemin={1}
          aria-valuenow={safeIndex + 1}
          className="seq-review-progress-track"
          role="progressbar"
        >
          <div
            className="seq-review-progress-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {showHints ? (
          <p className="muted seq-review-hints">
            {isImageMode
              ? "→／j 下一 · ←／k 上一 · A 標圖通過（兩次確認）· 1 圖片分頁 · Esc 結束 · ? 隱藏提示"
              : "→／j 下一 · ←／k 上一 · A 核准 · 1–5 分頁 · Esc 結束 · ? 隱藏提示"}
          </p>
        ) : null}

        <div className="seq-review-body">
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
        </div>
      </div>
    </div>
  );
}
