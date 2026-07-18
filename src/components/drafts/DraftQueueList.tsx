"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/listing/StatusBadge";
import { StageFilterPills } from "@/components/drafts/StageFilterPills";
import { ExportPreflightModal } from "@/components/listing/ExportPreflightModal";
import { categoryLabel } from "@/lib/categories";
import type {
  ExportKind,
  ExportPreflightReport
} from "@/lib/csv/exportPreflight";
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
import {
  countStations,
  DEFAULT_RESULTS_FILTER,
  filterDraftsByResultsFilter,
  filterWorkQueueDrafts,
  pickDefaultResultsFilter,
  readStoredResultsFilter,
  STATION_FILTER_STORAGE_KEY_QUEUE,
  type ResultsFilterKey,
  writeStoredResultsFilter
} from "@/lib/drafts/stationFilter";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import type { ProductDraft } from "@/types/domain";

export type DraftQueueRow = Pick<
  ProductDraft,
  | "id"
  | "title_zh"
  | "taobao_title"
  | "original_title"
  | "category"
  | "status"
  | "generation_status"
  | "publish_mode"
  | "publish_status"
  | "twd_price"
  | "pipeline_stage"
  | "shopify_product_id"
  | "image_status"
>;

const PUBLISH_MODE_LABELS: Record<string, string> = {
  active: "直接上架",
  draft: "僅建草稿"
};

export function DraftQueueList({ drafts }: { drafts: DraftQueueRow[] }) {
  const router = useRouter();
  const [stage, setStage] = useState<ResultsFilterKey>("copy_review");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastArchiveIds, setLastArchiveIds] = useState<string[] | null>(null);
  /** UX-E T28: arm destructive publish (no window.confirm). */
  const [publishArm, setPublishArm] = useState<null | "draft" | "active">(null);
  /** UX-E T46: archive undo 10s */
  const archiveUndoTimerRef = useRef<number | null>(null);
  // B12 fix: hide rows immediately; refresh only corrects server props.
  const [optimisticHide, setOptimisticHide] = useState<OptimisticHideMap>(() => new Map());
  /** UX-H T49: brief leave fade before optimistic hide (archive only). */
  const [leavingIds, setLeavingIds] = useState<Set<string>>(() => new Set());

  function clearArchiveUndoTimer() {
    if (archiveUndoTimerRef.current != null) {
      window.clearTimeout(archiveUndoTimerRef.current);
      archiveUndoTimerRef.current = null;
    }
  }

  function armArchiveUndo(ids: string[]) {
    clearArchiveUndoTimer();
    if (!ids.length) {
      setLastArchiveIds(null);
      return;
    }
    setLastArchiveIds(ids);
    archiveUndoTimerRef.current = window.setTimeout(() => {
      setLastArchiveIds(null);
      archiveUndoTimerRef.current = null;
    }, 10_000);
  }

  useEffect(() => () => clearArchiveUndoTimer(), []);
  // D9-open: queue rows are light → preflight via API
  const [exportPreflight, setExportPreflight] = useState<null | {
    kind: ExportKind;
    report: ExportPreflightReport;
    draftIds: string[];
    markupPercent?: number;
  }>(null);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    setStage(
      readStoredResultsFilter(
        typeof window !== "undefined" ? window.sessionStorage : null,
        STATION_FILTER_STORAGE_KEY_QUEUE
      )
    );
  }, []);

  useEffect(() => {
    setOptimisticHide((prev) => reconcileOptimisticHide(prev, drafts));
  }, [drafts]);

  function scheduleArchiveLeave(ids: string[]) {
    if (!ids.length) return;
    setLeavingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    window.setTimeout(() => {
      setOptimisticHide((prev) => applyOptimisticHide(prev, ids, "archived"));
      setLeavingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, 280);
  }

  const workQueue = useMemo(() => filterWorkQueueDrafts(drafts), [drafts]);
  const stageCounts = useMemo(() => countStations(workQueue), [workQueue]);

  const filtered = useMemo(() => {
    const stageRows = filterDraftsByResultsFilter(workQueue, stage);
    return filterByOptimisticHide(stageRows, optimisticHide);
  }, [workQueue, stage, optimisticHide]);

  const allSelected = filtered.length > 0 && filtered.every((draft) => selectedIds.has(draft.id));
  const someSelected = filtered.some((draft) => selectedIds.has(draft.id)) && !allSelected;
  const selectedArray = Array.from(selectedIds);
  const isReadyStation = stage === "ready";

  function onStageChange(next: ResultsFilterKey) {
    setStage(next);
    setSelectedIds(new Set());
    setPublishArm(null);
    writeStoredResultsFilter(
      next,
      typeof window !== "undefined" ? window.sessionStorage : null,
      STATION_FILTER_STORAGE_KEY_QUEUE
    );
  }

  useEffect(() => {
    setPublishArm(null);
  }, [selectedArray.join("|")]);

  /** UX-E T33: leave empty filter → station with items */
  function clearQueueFilter() {
    const next = pickDefaultResultsFilter(stageCounts, DEFAULT_RESULTS_FILTER);
    onStageChange(next === "fail" ? DEFAULT_RESULTS_FILTER : next);
  }

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
      if (filtered.every((draft) => current.has(draft.id))) {
        const next = new Set(current);
        for (const draft of filtered) next.delete(draft.id);
        return next;
      }
      const next = new Set(current);
      for (const draft of filtered) next.add(draft.id);
      return next;
    });
  }

  // Approve and publish are merged into one click, same reasoning as
  // ResultCard's single-item action: same person does both steps, so a
  // separate "一鍵審核" pass before publishing is just an extra round trip.
  async function batchApproveAndPublish(mode: "draft" | "active") {
    if (!selectedArray.length) return;
    // UX-E T28: double-confirm (esp. ACTIVE); no native gray dialog
    if (publishArm !== mode) {
      setPublishArm(mode);
      setMessage(
        mode === "active"
          ? `⚠ 再點確認：核准並正式上架 ${selectedArray.length} 筆（立刻公開）`
          : `再點確認：核准並建草稿 ${selectedArray.length} 筆`
      );
      return;
    }
    setPublishArm(null);
    const n = selectedArray.length;
    setBusy(true);
    clearArchiveUndoTimer();
    setLastArchiveIds(null);
    setMessage(mode === "active" ? `上架中（已選 ${n} 筆）…` : `核准建草稿中（已選 ${n} 筆）…`);
    const approveResponse = await fetch("/api/drafts/batch/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds: selectedArray })
    });
    if (!approveResponse.ok) {
      const payload = await approveResponse.json().catch(() => ({}));
      setBusy(false);
      setMessage(payload.error ?? "批次核准失敗");
      return;
    }

    setMessage(mode === "active" ? `上架中（已選 ${n} 筆）…` : `建立草稿中（已選 ${n} 筆）…`);
    const response = await fetch("/api/drafts/batch/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds: selectedArray, publishMode: mode, confirmActive: mode === "active" })
    });
    const payload = await response.json();
    setBusy(false);
    setMessage(
      response.ok
        ? payload.message ??
            `成功 ${payload.succeeded} 筆／失敗 ${payload.failed} 筆${
              payload.skipped ? `／略過 ${payload.skipped}` : ""
            }`
        : [payload.error, payload.hint].filter(Boolean).join(" — ") || "批次發布失敗"
    );
    setSelectedIds(new Set());
    router.refresh();
  }

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
        armArchiveUndo(archivedIds);
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
          scheduleArchiveLeave(archivedIds);
        }
      } else {
        const restoredIds =
          (payload.restoredIds as string[] | undefined) ??
          selectedArray.filter((id) => drafts.find((d) => d.id === id)?.status === "archived");
        clearArchiveUndoTimer();
        setLastArchiveIds(null);
        setMessage(
          typeof payload.message === "string"
            ? payload.message
            : formatUnarchiveResultMessage({ restoredCount: payload.restoredCount ?? 0 })
        );
        if (restoredIds.length) {
          setLeavingIds((prev) => {
            const next = new Set(prev);
            for (const id of restoredIds) next.delete(id);
            return next;
          });
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
    setMessage("復原中…");
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: lastArchiveIds, action: "unarchive" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error ?? "復原失敗");
        return;
      }
      const restoredIds =
        (payload.restoredIds as string[] | undefined) ?? lastArchiveIds;
      clearArchiveUndoTimer();
      setLastArchiveIds(null);
      setMessage(
        typeof payload.message === "string"
          ? payload.message
          : formatUnarchiveResultMessage({ restoredCount: payload.restoredCount ?? lastArchiveIds.length })
      );
      setLeavingIds((prev) => {
        const next = new Set(prev);
        for (const id of restoredIds) next.delete(id);
        return next;
      });
      setOptimisticHide((prev) => applyOptimisticHide(prev, restoredIds, "unarchived"));
      scheduleRouterRefresh(() => router.refresh());
    } catch {
      setMessage("復原連線失敗");
    } finally {
      setBusy(false);
    }
  }

  async function openExportPreflight(kind: ExportKind) {
    if (!selectedArray.length) {
      setMessage("請先勾選商品再匯出。");
      return;
    }
    const markup = getStoredPricingSettings().showmoreMarkupPercent;
    setBusy(true);
    setLastArchiveIds(null);
    setMessage("健檢中…");
    try {
      const response = await fetch("/api/exports/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftIds: selectedArray,
          kind,
          showmoreMarkupPercent: markup
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(
          typeof payload.error === "string" ? payload.error : "健檢失敗"
        );
        return;
      }
      setMessage("");
      setExportPreflight({
        kind,
        report: payload as ExportPreflightReport,
        draftIds: selectedArray,
        markupPercent: kind === "showmore" ? markup : undefined
      });
    } catch {
      setMessage("健檢連線失敗");
    } finally {
      setBusy(false);
    }
  }

  async function confirmExportDownload() {
    if (!exportPreflight || !exportPreflight.report.canExport) return;
    const { kind, draftIds, markupPercent } = exportPreflight;
    const endpoint =
      kind === "showmore" ? "/api/exports/showmore" : "/api/exports/matrixify";
    const filenamePrefix =
      kind === "showmore" ? "nestory-showmore" : "nestory-matrixify";
    const note =
      kind === "showmore"
        ? `已套 Showmore +${markupPercent ?? 5}% 並美化；庫存 999／重量 0.1kg 為預設；多款式未展開；上傳前請確認。`
        : undefined;
    const extraBody =
      kind === "showmore" ? { showmoreMarkupPercent: markupPercent } : undefined;

    setExportBusy(true);
    setBusy(true);
    setLastArchiveIds(null);
    setMessage("產生 CSV 中...");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds, ...extraBody })
      });

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
      setExportPreflight(null);
    } catch {
      setMessage("CSV 下載連線失敗");
    } finally {
      setExportBusy(false);
      setBusy(false);
    }
  }

  function displayTitle(draft: DraftQueueRow): string {
    return draft.title_zh || draft.taobao_title || draft.original_title || "未命名商品";
  }

  return (
    <div>
      <StageFilterPills
        ariaLabel="佇列依階段篩選"
        counts={stageCounts}
        onChange={onStageChange}
        stage={stage}
      />

      <div className="queue-batch-toolbar">
        <label className="check-row">
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
        {/* UX-E T27: hide batch actions until selection; primary 1–2 + 更多 */}
        {selectedIds.size > 0 ? (
          <div className="batch-actions">
            {isReadyStation ? (
              <>
                <button
                  className={`btn-mini batch-primary-action${publishArm === "draft" ? " danger" : ""}`}
                  disabled={busy || !selectedArray.length}
                  onClick={() => void batchApproveAndPublish("draft")}
                  title={
                    publishArm === "draft"
                      ? `再點確認建草稿 ${selectedArray.length} 筆`
                      : "核准後在 Shopify 建立草稿商品，不會公開上架"
                  }
                  type="button"
                >
                  {publishArm === "draft"
                    ? `⚠ 再點確認建草稿 ${selectedArray.length} 筆`
                    : "核准並建草稿"}
                </button>
                <button
                  className="btn-mini danger batch-primary-action"
                  disabled={busy || !selectedArray.length}
                  onClick={() => void batchApproveAndPublish("active")}
                  title={
                    publishArm === "active"
                      ? `再點確認正式上架 ${selectedArray.length} 筆`
                      : "核准後直接在 Shopify 建立正式上架商品，會立刻公開，請先確認內容無誤"
                  }
                  type="button"
                >
                  {publishArm === "active"
                    ? `⚠ 再點確認上架 ${selectedArray.length} 筆`
                    : "核准並上架"}
                </button>
                <details className="batch-more">
                  <summary className="btn-mini">更多 ▾</summary>
                  <div className="batch-more-menu">
                    <button
                      className="btn-mini"
                      disabled={busy || !selectedArray.length}
                      onClick={() => void batchArchiveOrUnarchive("archive")}
                      title="移出工作佇列（軟刪除，可救回）"
                      type="button"
                    >
                      🗄 移出佇列
                    </button>
                    <button
                      className="btn-mini"
                      disabled={busy || !selectedArray.length}
                      onClick={() => void openExportPreflight("matrixify")}
                      title="匯出前健檢＋預覽，確認後下載 Matrixify CSV"
                      type="button"
                    >
                      ⬇ Matrixify
                    </button>
                    <button
                      className="btn-mini"
                      disabled={busy || !selectedArray.length}
                      onClick={() => void openExportPreflight("showmore")}
                      title="匯出前健檢＋預覽（加價%／售價），確認後下載 Showmore CSV"
                      type="button"
                    >
                      ⬇ Showmore
                    </button>
                  </div>
                </details>
              </>
            ) : (
              <button
                className="btn-mini batch-primary-action"
                disabled={busy || !selectedArray.length}
                onClick={() => void batchArchiveOrUnarchive("archive")}
                title="移出工作佇列（軟刪除，可救回）"
                type="button"
              >
                🗄 移出佇列
              </button>
            )}
          </div>
        ) : null}
      </div>
      {message ? (
        <div className="notice">
          <span style={{ whiteSpace: "pre-wrap" }}>{message}</span>
          {lastArchiveIds && lastArchiveIds.length > 0 ? (
            <button
              className="btn-mini"
              disabled={busy}
              onClick={() => void undoLastArchive()}
              style={{ marginLeft: 10 }}
              title="10 秒內可復原"
              type="button"
            >
              復原
            </button>
          ) : null}
        </div>
      ) : null}

      {workQueue.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◈</div>
          <p className="muted">目前沒有在工作佇列的商品</p>
          <Link className="button primary" href="/drafts/new" style={{ marginTop: 12 }}>
            去新增商品
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◈</div>
          <p className="muted">這個篩選下沒有商品</p>
          <button className="button" onClick={clearQueueFilter} style={{ marginTop: 12 }} type="button">
            清除篩選
          </button>
        </div>
      ) : (
        <>
          <div className="queue-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th aria-label="選取" />
                  <th>商品</th>
                  <th>狀態</th>
                  <th>產文</th>
                  <th>發布</th>
                  <th>售價</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((draft) => (
                  <tr
                    className={leavingIds.has(draft.id) ? "is-leaving" : undefined}
                    key={draft.id}
                  >
                    <td>
                      <input
                        checked={selectedIds.has(draft.id)}
                        onChange={() => toggleOne(draft.id)}
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <Link href={`/drafts/${draft.id}`}>
                        <strong>{displayTitle(draft)}</strong>
                      </Link>
                      <div className="muted">{categoryLabel(draft.category)}</div>
                    </td>
                    <td>
                      <StatusBadge status={draft.status} />
                    </td>
                    <td>
                      <StatusBadge status={draft.generation_status} />
                    </td>
                    <td>
                      <div className="muted">
                        {PUBLISH_MODE_LABELS[draft.publish_mode] ?? draft.publish_mode}
                      </div>
                      <StatusBadge status={draft.publish_status} />
                    </td>
                    <td>NT${draft.twd_price?.toLocaleString() ?? "-"}</td>
                    <td>
                      {draft.status === "archived" ? (
                        <button
                          className="btn-mini"
                          disabled={busy}
                          onClick={() => {
                            void (async () => {
                              setBusy(true);
                              setMessage("解除封存中…");
                              try {
                                const response = await fetch("/api/drafts/batch/archive", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ draftIds: [draft.id], action: "unarchive" })
                                });
                                const payload = await response.json().catch(() => ({}));
                                if (!response.ok) {
                                  setMessage(payload.error ?? "解除封存失敗");
                                  return;
                                }
                                setLastArchiveIds(null);
                                setMessage(payload.message ?? "已解除封存");
                                setOptimisticHide((prev) =>
                                  applyOptimisticHide(prev, [draft.id], "unarchived")
                                );
                                scheduleRouterRefresh(() => router.refresh());
                              } catch {
                                setMessage("解除封存連線失敗");
                              } finally {
                                setBusy(false);
                              }
                            })();
                          }}
                          type="button"
                        >
                          解除封存
                        </button>
                      ) : (
                        <button
                          className="btn-mini"
                          disabled={busy}
                          onClick={() => {
                            void (async () => {
                              setBusy(true);
                              setMessage("封存中…");
                              try {
                                const response = await fetch("/api/drafts/batch/archive", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ draftIds: [draft.id], action: "archive" })
                                });
                                const payload = await response.json().catch(() => ({}));
                                if (!response.ok) {
                                  setMessage(payload.error ?? "封存失敗");
                                  return;
                                }
                                const ids = (payload.archivedIds as string[] | undefined) ?? [draft.id];
                                armArchiveUndo(ids);
                                setMessage(payload.message ?? "已封存");
                                scheduleArchiveLeave(ids);
                                scheduleRouterRefresh(() => router.refresh());
                              } catch {
                                setMessage("封存連線失敗");
                              } finally {
                                setBusy(false);
                              }
                            })();
                          }}
                          type="button"
                        >
                          封存
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="queue-cards">
            {filtered.map((draft) => (
              <div
                className={`result-card queue-card${leavingIds.has(draft.id) ? " is-leaving" : ""}`}
                key={draft.id}
              >
                <Link aria-label={displayTitle(draft)} className="queue-card-link" href={`/drafts/${draft.id}`} />
                <div className="rc-header">
                  <input
                    checked={selectedIds.has(draft.id)}
                    className="rc-checkbox"
                    onChange={() => toggleOne(draft.id)}
                    type="checkbox"
                  />
                  <span className="rc-title">{displayTitle(draft)}</span>
                  {draft.twd_price ? (
                    <span className="rc-price">NT${draft.twd_price.toLocaleString()}</span>
                  ) : null}
                </div>
                <div className="queue-card-meta">
                  <StatusBadge status={draft.status} />
                  <StatusBadge status={draft.generation_status} />
                  <span className="muted">
                    {PUBLISH_MODE_LABELS[draft.publish_mode] ?? draft.publish_mode}
                  </span>
                  <StatusBadge status={draft.publish_status} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ExportPreflightModal
        busy={exportBusy}
        onCancel={() => {
          if (!exportBusy) setExportPreflight(null);
        }}
        onConfirm={() => void confirmExportDownload()}
        open={Boolean(exportPreflight)}
        report={exportPreflight?.report ?? null}
      />
    </div>
  );
}
