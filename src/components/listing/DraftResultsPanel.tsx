"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ResultCard } from "@/components/listing/ResultCard";
import { ApproveSummaryModal } from "@/components/listing/ApproveSummaryModal";
import { StageFilterPills } from "@/components/drafts/StageFilterPills";
import { GENERATION_PROGRESS_EVENT, type GenerationProgress } from "@/components/listing/generationProgress";
import {
  buildBatchApproveSummary,
  modalHeading,
  primaryConfirmLabel,
} from "@/lib/drafts/approveSummary";
import {
  RESULT_SORT_OPTIONS,
  type ResultSortMode,
  readStoredResultSort,
  sortResultDrafts,
  writeStoredResultSort
} from "@/lib/drafts/resultSort";
import {
  countByStage,
  filterDraftsByStage,
  readStoredStage,
  STAGE_FILTER_STORAGE_KEY_RESULTS,
  type StageKey,
  writeStoredStage
} from "@/lib/drafts/stageFilter";
import {
  formatArchiveResultMessage,
  formatUnarchiveResultMessage
} from "@/lib/drafts/archiveDrafts";
import {
  applyOptimisticHide,
  filterByOptimisticHide,
  reconcileOptimisticHide,
  type OptimisticHideMap
} from "@/lib/drafts/optimisticArchiveHide";
import { scheduleRouterRefresh } from "@/lib/drafts/scheduleRouterRefresh";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import type { ProductDraft, ProductImage } from "@/types/domain";

export function DraftResultsPanel({
  drafts,
  images
}: {
  drafts: ProductDraft[];
  images: ProductImage[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastArchiveIds, setLastArchiveIds] = useState<string[] | null>(null);
  // B12 fix: hide archived/unarchived rows immediately; refresh only corrects.
  const [optimisticHide, setOptimisticHide] = useState<OptimisticHideMap>(() => new Map());
  const [sortMode, setSortMode] = useState<ResultSortMode>("newest");
  const [stage, setStage] = useState<StageKey>("all");
  // B11 D1-B: summary only for batch Shopify paths (建草稿／上架), not pure 批次核准
  const [batchPublishSummary, setBatchPublishSummary] = useState<null | {
    mode: "draft" | "active";
    draftIds: string[];
  }>(null);
  const [batchSummaryBusy, setBatchSummaryBusy] = useState(false);

  // B1: the input panel (left) drives the 生成 progress card via a window event;
  // this panel (right) renders it at the top of the results list, matching the
  // Mockup's information architecture. On success the card auto-clears once the
  // real ResultCard lands via router.refresh; on error it stays put so the
  // operator can read which step went red and why.
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  useEffect(() => {
    function onProgress(event: Event) {
      const model = (event as CustomEvent<GenerationProgress>).detail;
      if (!model || !model.visible) {
        setProgress(null);
        return;
      }
      setProgress(model);
      const allDone = model.steps.length > 0 && model.steps.every((step) => step.status === "done");
      if (allDone) {
        setTimeout(() => setProgress(null), 1500);
      }
    }
    window.addEventListener(GENERATION_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(GENERATION_PROGRESS_EVENT, onProgress);
  }, []);

  // B9: remember sort preference for this browser tab session.
  // B12: remember stage filter for this tab session.
  useEffect(() => {
    const storage = typeof window !== "undefined" ? window.sessionStorage : null;
    setSortMode(readStoredResultSort(storage));
    setStage(readStoredStage(storage, STAGE_FILTER_STORAGE_KEY_RESULTS));
  }, []);

  // Drop optimistic hides once server props already reflect archive/unarchive.
  useEffect(() => {
    setOptimisticHide((prev) => reconcileOptimisticHide(prev, drafts));
  }, [drafts]);

  const progressHeadStatus = progress
    ? progress.steps.some((step) => step.status === "error")
      ? "error"
      : progress.steps.every((step) => step.status === "done")
        ? "done"
        : "running"
    : null;

  const imagesByDraft = useMemo(() => {
    const map = new Map<string, ProductImage[]>();
    for (const image of images) {
      const list = map.get(image.draft_id) ?? [];
      list.push(image);
      map.set(image.draft_id, list);
    }
    return map;
  }, [images]);

  const stageImages = useMemo(
    () =>
      images.map((image) => ({
        draft_id: image.draft_id,
        image_type: image.image_type,
        process_intent: image.process_intent ?? null
      })),
    [images]
  );

  const stageCounts = useMemo(() => countByStage(drafts, stageImages), [drafts, stageImages]);

  const stageFiltered = useMemo(
    () => filterDraftsByStage(drafts, stage, stageImages),
    [drafts, stage, stageImages]
  );

  const sortedDrafts = useMemo(
    () =>
      sortResultDrafts(
        stageFiltered,
        sortMode,
        stageImages
      ),
    [stageFiltered, stageImages, sortMode]
  );

  const visibleDrafts = useMemo(
    () => filterByOptimisticHide(sortedDrafts, optimisticHide),
    [sortedDrafts, optimisticHide]
  );

  const allSelected =
    visibleDrafts.length > 0 && visibleDrafts.every((draft) => selectedIds.has(draft.id));
  const someSelected =
    visibleDrafts.some((draft) => selectedIds.has(draft.id)) && !allSelected;
  const selectedArray = Array.from(selectedIds);

  function toggleOne(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((current) => {
      if (visibleDrafts.every((draft) => current.has(draft.id))) {
        const next = new Set(current);
        for (const draft of visibleDrafts) next.delete(draft.id);
        return next;
      }
      const next = new Set(current);
      for (const draft of visibleDrafts) next.add(draft.id);
      return next;
    });
  }

  function onSortChange(next: ResultSortMode) {
    setSortMode(next);
    writeStoredResultSort(next, typeof window !== "undefined" ? window.sessionStorage : null);
  }

  function onStageChange(next: StageKey) {
    setStage(next);
    setSelectedIds(new Set());
    writeStoredStage(
      next,
      typeof window !== "undefined" ? window.sessionStorage : null,
      STAGE_FILTER_STORAGE_KEY_RESULTS
    );
  }

  // B9 D1-C: pure approve (status only), no publish.
  // B11 D1-B: pure batch approve stays one-click (reversible via 退回修改) — no summary modal.
  async function batchApproveOnly() {
    if (!selectedArray.length) return;
    setBusy(true);
    setMessage("批次核准中...");
    setLastArchiveIds(null);
    const approveResponse = await fetch("/api/drafts/batch/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds: selectedArray })
    });
    const payload = await approveResponse.json().catch(() => ({}));
    setBusy(false);
    if (!approveResponse.ok) {
      setMessage(payload.error ?? "批次核准失敗");
      return;
    }
    setMessage(`已核准 ${payload.approvedCount ?? selectedArray.length} 筆文案（尚未發布）`);
    setSelectedIds(new Set());
    router.refresh();
  }

  // B11 D1-B: open one aggregated summary (D4-A), never N modals. D2-A replaces window.confirm.
  function openBatchApproveAndPublishSummary(mode: "draft" | "active") {
    if (!selectedArray.length) return;
    setBatchPublishSummary({ mode, draftIds: [...selectedArray] });
  }

  async function confirmBatchApproveAndPublish() {
    if (!batchPublishSummary) return;
    const { mode, draftIds } = batchPublishSummary;
    setBatchSummaryBusy(true);
    setBusy(true);
    try {
      setMessage("批次核准中...");
      setLastArchiveIds(null);
      const approveResponse = await fetch("/api/drafts/batch/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds }),
      });
      if (!approveResponse.ok) {
        const payload = await approveResponse.json().catch(() => ({}));
        setMessage(payload.error ?? "批次核准失敗");
        return;
      }

      setMessage(mode === "active" ? "批次上架中..." : "批次建立草稿中...");
      const response = await fetch("/api/drafts/batch/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftIds,
          publishMode: mode,
          confirmActive: mode === "active",
        }),
      });
      const payload = await response.json();
      setMessage(
        response.ok
          ? payload.message ??
              `成功 ${payload.succeeded} 筆／失敗 ${payload.failed} 筆${
                payload.skipped ? `／略過 ${payload.skipped}` : ""
              }`
          : [payload.error, payload.hint].filter(Boolean).join(" — ") || "批次發布失敗"
      );
      setBatchPublishSummary(null);
      setSelectedIds(new Set());
      router.refresh();
    } catch {
      setMessage("批次核准／發布連線失敗");
    } finally {
      setBatchSummaryBusy(false);
      setBusy(false);
    }
  }

  const batchSummaryView = useMemo(() => {
    if (!batchPublishSummary) return null;
    const items = batchPublishSummary.draftIds.map((id) => {
      const draft = drafts.find((row) => row.id === id);
      return {
        draftId: id,
        title: draft?.title_zh || draft?.taobao_title || "未命名草稿",
        warnings: draft?.warnings ?? [],
        images: imagesByDraft.get(id) ?? [],
      };
    });
    return {
      mode: batchPublishSummary.mode,
      summary: buildBatchApproveSummary(items),
      count: batchPublishSummary.draftIds.length,
    };
  }, [batchPublishSummary, drafts, imagesByDraft]);

  // B9 + B14: batch send images — B5 gate server-side; create image_batches when ready.
  async function batchSendImages() {
    if (!selectedArray.length) {
      setMessage("請先勾選商品再批次送圖。");
      return;
    }
    setBusy(true);
    setLastArchiveIds(null);
    setMessage("建立送圖批次中…");
    try {
      const response = await fetch("/api/drafts/batch/send-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: selectedArray })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const hint = typeof payload.hint === "string" ? `\n${payload.hint}` : "";
        setMessage((payload.error ?? "建立送圖批次失敗") + hint);
        return;
      }
      setMessage(typeof payload.message === "string" ? payload.message : "送圖批次處理完成");
      // Soft refresh so current_image_batch_id is available if UI later shows it
      if (payload.ok && payload.batchId) {
        scheduleRouterRefresh(() => router.refresh());
      }
    } catch {
      setMessage("建立送圖批次失敗（網路錯誤）");
    } finally {
      setBusy(false);
    }
  }

  // B12: batch archive / unarchive — busy statuses skipped per-item (like 送圖).
  // fix(B12): paint notice + optimistic hide first; defer refresh as background reconcile.
  async function batchArchiveOrUnarchive(action: "archive" | "unarchive") {
    if (!selectedArray.length) {
      setMessage(
        action === "archive"
          ? formatArchiveResultMessage({
              archivedCount: 0,
              skippedBusyCount: 0,
              includesPublished: false,
              emptySelection: true
            })
          : "請先勾選商品再批次解除封存。"
      );
      return;
    }
    setBusy(true);
    setMessage(action === "archive" ? "批次封存中…" : "批次解除封存中…");
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: selectedArray, action })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error ?? (action === "archive" ? "批次封存失敗" : "批次解除封存失敗"));
        return;
      }
      if (action === "archive") {
        const archivedIds = (payload.archivedIds as string[] | undefined) ?? [];
        setLastArchiveIds(archivedIds.length ? archivedIds : null);
        setMessage(
          typeof payload.message === "string"
            ? payload.message
            : formatArchiveResultMessage({
                archivedCount: payload.archivedCount ?? 0,
                skippedBusyCount: payload.skippedBusyCount ?? 0,
                includesPublished: Boolean(payload.includesPublished)
              })
        );
        if (archivedIds.length) {
          setOptimisticHide((prev) => applyOptimisticHide(prev, archivedIds, "archived"));
        }
      } else {
        const restoredIds =
          (payload.restoredIds as string[] | undefined) ??
          selectedArray.filter((id) => drafts.find((d) => d.id === id)?.status === "archived");
        setLastArchiveIds(null);
        setMessage(
          typeof payload.message === "string"
            ? payload.message
            : formatUnarchiveResultMessage({ restoredCount: payload.restoredCount ?? 0 })
        );
        if (restoredIds.length) {
          setOptimisticHide((prev) => applyOptimisticHide(prev, restoredIds, "unarchived"));
        }
      }
      setSelectedIds(new Set());
      scheduleRouterRefresh(() => router.refresh());
    } catch {
      setMessage(action === "archive" ? "批次封存連線失敗" : "批次解除封存連線失敗");
    } finally {
      setBusy(false);
    }
  }

  async function undoLastArchive() {
    if (!lastArchiveIds?.length) return;
    setBusy(true);
    setMessage("解除封存中…");
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: lastArchiveIds, action: "unarchive" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error ?? "解除封存失敗");
        return;
      }
      const restoredIds =
        (payload.restoredIds as string[] | undefined) ?? lastArchiveIds;
      setLastArchiveIds(null);
      setMessage(
        typeof payload.message === "string"
          ? payload.message
          : formatUnarchiveResultMessage({ restoredCount: payload.restoredCount ?? lastArchiveIds.length })
      );
      setOptimisticHide((prev) => applyOptimisticHide(prev, restoredIds, "unarchived"));
      scheduleRouterRefresh(() => router.refresh());
    } catch {
      setMessage("解除封存連線失敗");
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv(
    endpoint: string,
    filenamePrefix: string,
    note?: string,
    extraBody?: Record<string, unknown>
  ) {
    if (!selectedArray.length) return;
    setBusy(true);
    setLastArchiveIds(null);
    setMessage("產生 CSV 中...");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds: selectedArray, ...extraBody })
    });
    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setMessage(payload.error ?? "CSV 產生失敗");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filenamePrefix}-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(note ? `CSV 已下載。${note}` : "CSV 已下載");
  }

  const showToolbar = drafts.length > 0;
  const isArchivedStage = stage === "archived";

  return (
    <section className="panel results-panel">
      <div className="panel-header rc-panel-header">
        <h2>◈ 生成結果</h2>
      </div>
      <div className="panel-body results-panel-body">
        {progress ? (
          <div className="gen-card">
            <div className="gen-card-head">
              <span className={`gen-dot ${progressHeadStatus}`} />
              <span className="gen-card-title">
                {progressHeadStatus === "done"
                  ? `✓ 生成完成：${progress.title}`
                  : progressHeadStatus === "error"
                    ? `✗ 生成失敗：${progress.title}`
                    : `生成中：${progress.title}…`}
              </span>
            </div>
            <div className="gen-steps">
              {progress.steps.map((step, index) => (
                <div className={`gen-step ${step.status}`} key={step.label}>
                  <span className="gs-dot">
                    {step.status === "done"
                      ? "✓"
                      : step.status === "error"
                        ? "✕"
                        : step.status === "warn"
                          ? "!"
                          : index + 1}
                  </span>
                  {step.label}
                </div>
              ))}
            </div>
            {progress.error ? <div className="gen-error">⚠ {progress.error}</div> : null}
          </div>
        ) : null}

        {showToolbar ? (
          <>
            <div className="results-batch-toolbar" role="toolbar" aria-label="批次操作與排序">
              <label className="check-row results-batch-check">
                <input
                  checked={allSelected}
                  onChange={toggleAll}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  type="checkbox"
                />
                全選
              </label>
              <span className="batch-selected-count">
                {selectedIds.size > 0 ? `已選 ${selectedIds.size} 筆` : "勾選商品以使用批次操作"}
              </span>
              <div className="batch-actions">
                {isArchivedStage ? (
                  <button
                    className="btn-mini"
                    disabled={busy || !selectedArray.length}
                    onClick={() => void batchArchiveOrUnarchive("unarchive")}
                    title="批次解除封存，回到預設列表"
                    type="button"
                  >
                    解除封存
                  </button>
                ) : (
                  <>
                    <button
                      className="btn-mini"
                      disabled={busy || !selectedArray.length}
                      onClick={() => void batchApproveOnly()}
                      title="只核准文案狀態，不會發布到 Shopify"
                      type="button"
                    >
                      ✓ 批次核准
                    </button>
                    <button
                      className="btn-mini"
                      disabled={busy || !selectedArray.length}
                      onClick={() => void batchSendImages()}
                      title="批次送圖；標記齊全會建立送圖批次（Phase D 接通後自動處理）"
                      type="button"
                    >
                      ▶ 批次送圖
                    </button>
                    <button
                      className="btn-mini"
                      disabled={busy || !selectedArray.length}
                      onClick={() => openBatchApproveAndPublishSummary("draft")}
                      title="核准後在 Shopify 建立草稿商品，不會公開上架（先摘要確認）"
                      type="button"
                    >
                      核准並建草稿
                    </button>
                    <button
                      className="btn-mini danger"
                      disabled={busy || !selectedArray.length}
                      onClick={() => openBatchApproveAndPublishSummary("active")}
                      title="核准後直接在 Shopify 建立正式上架商品，會立刻公開，請先確認內容無誤"
                      type="button"
                    >
                      核准並上架
                    </button>
                    <button
                      className="btn-mini"
                      disabled={busy || !selectedArray.length}
                      onClick={() => void batchArchiveOrUnarchive("archive")}
                      title="批次軟刪除；生成中／上架中會跳過並彙總回報"
                      type="button"
                    >
                      🗄 批次封存
                    </button>
                    <button
                      className="btn-mini"
                      disabled={busy || !selectedArray.length}
                      onClick={() => void downloadCsv("/api/exports/matrixify", "nestory-matrixify")}
                      title="下載 Matrixify 格式 CSV，供 Shopify 後台批次匯入"
                      type="button"
                    >
                      ⬇ Matrixify
                    </button>
                    <button
                      className="btn-mini"
                      disabled={busy || !selectedArray.length}
                      onClick={() => {
                        const markup = getStoredPricingSettings().showmoreMarkupPercent;
                        void downloadCsv(
                          "/api/exports/showmore",
                          "nestory-showmore",
                          `已套 Showmore +${markup}% 並美化；庫存 999／重量 0.1kg 為預設；多款式未展開；上傳前請確認。`,
                          { showmoreMarkupPercent: markup }
                        );
                      }}
                      title="下載 Showmore CSV（加價%＋美化；庫存/重量預設；多款式請後台補）"
                      type="button"
                    >
                      ⬇ Showmore
                    </button>
                  </>
                )}
              </div>
              <label className="results-sort-label">
                <span className="sr-only">排序</span>
                <select
                  aria-label="排序"
                  className="sort-sel"
                  onChange={(event) => onSortChange(event.target.value as ResultSortMode)}
                  value={sortMode}
                >
                  {RESULT_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* B12 / 差異 9: stage pills under batch toolbar */}
            <StageFilterPills counts={stageCounts} onChange={onStageChange} stage={stage} />
          </>
        ) : null}

        {message ? (
          <div className="notice results-batch-notice" role="status">
            <span style={{ whiteSpace: "pre-wrap" }}>{message}</span>
            {lastArchiveIds && lastArchiveIds.length > 0 ? (
              <button
                className="btn-mini"
                disabled={busy}
                onClick={() => void undoLastArchive()}
                style={{ marginLeft: 10 }}
                type="button"
              >
                解除封存
              </button>
            ) : null}
          </div>
        ) : null}

        {drafts.length === 0 && !progress ? (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p className="muted">在左側輸入商品資料並送出，生成結果會出現在這裡</p>
          </div>
        ) : visibleDrafts.length === 0 && !progress ? (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p className="muted">這個篩選條件下沒有商品</p>
          </div>
        ) : (
          <div className="results-list" id="results-list">
            {visibleDrafts.map((draft) => (
              <ResultCard
                checked={selectedIds.has(draft.id)}
                draft={draft}
                images={imagesByDraft.get(draft.id) ?? []}
                key={draft.id}
                onToggle={() => toggleOne(draft.id)}
              />
            ))}
          </div>
        )}
      </div>

      {batchSummaryView ? (
        <ApproveSummaryModal
          busy={batchSummaryBusy}
          heading={modalHeading({ batchCount: batchSummaryView.count })}
          onCancel={() => {
            if (!batchSummaryBusy) setBatchPublishSummary(null);
          }}
          onConfirm={() => void confirmBatchApproveAndPublish()}
          open={Boolean(batchPublishSummary)}
          primaryDanger={batchSummaryView.mode === "active"}
          primaryLabel={primaryConfirmLabel({
            publishMode: batchSummaryView.mode,
            hasDirtyCopy: false,
          })}
          rows={batchSummaryView.summary.rows}
        />
      ) : null}
    </section>
  );
}
