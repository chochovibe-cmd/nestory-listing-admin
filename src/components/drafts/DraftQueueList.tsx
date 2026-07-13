"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/listing/StatusBadge";
import { StageFilterPills } from "@/components/drafts/StageFilterPills";
import { categoryLabel } from "@/lib/categories";
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
  countByStage,
  filterDraftsByStage,
  readStoredStage,
  STAGE_FILTER_STORAGE_KEY_QUEUE,
  type StageKey,
  writeStoredStage
} from "@/lib/drafts/stageFilter";
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
>;

const PUBLISH_MODE_LABELS: Record<string, string> = {
  active: "直接上架",
  draft: "僅建草稿"
};

export function DraftQueueList({ drafts }: { drafts: DraftQueueRow[] }) {
  const router = useRouter();
  const [stage, setStage] = useState<StageKey>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastArchiveIds, setLastArchiveIds] = useState<string[] | null>(null);
  // B12 fix: hide rows immediately; refresh only corrects server props.
  const [optimisticHide, setOptimisticHide] = useState<OptimisticHideMap>(() => new Map());

  useEffect(() => {
    setStage(
      readStoredStage(
        typeof window !== "undefined" ? window.sessionStorage : null,
        STAGE_FILTER_STORAGE_KEY_QUEUE
      )
    );
  }, []);

  useEffect(() => {
    setOptimisticHide((prev) => reconcileOptimisticHide(prev, drafts));
  }, [drafts]);

  // Queue has no images → 圖片未標記 always 0 (still show pill for consistency).
  const stageCounts = useMemo(() => countByStage(drafts), [drafts]);

  const filtered = useMemo(() => {
    const stageRows = filterDraftsByStage(drafts, stage);
    return filterByOptimisticHide(stageRows, optimisticHide);
  }, [drafts, stage, optimisticHide]);

  const allSelected = filtered.length > 0 && filtered.every((draft) => selectedIds.has(draft.id));
  const someSelected = filtered.some((draft) => selectedIds.has(draft.id)) && !allSelected;
  const selectedArray = Array.from(selectedIds);
  const isArchivedStage = stage === "archived";

  function onStageChange(next: StageKey) {
    setStage(next);
    setSelectedIds(new Set());
    writeStoredStage(
      next,
      typeof window !== "undefined" ? window.sessionStorage : null,
      STAGE_FILTER_STORAGE_KEY_QUEUE
    );
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
    if (mode === "active") {
      const confirmed = window.confirm(
        `即將核准並對已選取的 ${selectedArray.length} 筆商品建立 Shopify ACTIVE 商品（直接上架），確定嗎？`
      );
      if (!confirmed) return;
    }
    setBusy(true);
    setLastArchiveIds(null);
    setMessage("批次核准中...");
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

    setMessage(mode === "active" ? "批次上架中..." : "批次建立草稿中...");
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

  async function downloadCsv(endpoint: string, filenamePrefix: string, note?: string) {
    if (!selectedArray.length) return;
    setBusy(true);
    setLastArchiveIds(null);
    setMessage("產生 CSV 中...");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds: selectedArray })
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
        <div className="batch-actions">
          {isArchivedStage ? (
            <button
              className="btn-mini"
              disabled={busy || !selectedArray.length}
              onClick={() => void batchArchiveOrUnarchive("unarchive")}
              title="批次解除封存"
              type="button"
            >
              解除封存
            </button>
          ) : (
            <>
              <button
                className="btn-mini"
                disabled={busy || !selectedArray.length}
                onClick={() => void batchApproveAndPublish("draft")}
                title="核准後在 Shopify 建立草稿商品，不會公開上架"
                type="button"
              >
                核准並建草稿
              </button>
              <button
                className="btn-mini danger"
                disabled={busy || !selectedArray.length}
                onClick={() => void batchApproveAndPublish("active")}
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
                onClick={() =>
                  void downloadCsv(
                    "/api/exports/showmore",
                    "nestory-showmore",
                    "重量欄位為預設值 0.1kg，上傳前請手動確認。"
                  )
                }
                title="下載 Showmore 格式 CSV，官網庫存/重量為預設值，上傳前請手動確認"
                type="button"
              >
                ⬇ Showmore
              </button>
            </>
          )}
        </div>
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
              type="button"
            >
              解除封存
            </button>
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◈</div>
          <p className="muted">這個篩選條件下沒有商品</p>
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
                  <tr key={draft.id}>
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
                                setLastArchiveIds(ids.length ? ids : null);
                                setMessage(payload.message ?? "已封存");
                                setOptimisticHide((prev) =>
                                  applyOptimisticHide(prev, ids, "archived")
                                );
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
              <div className="result-card queue-card" key={draft.id}>
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
    </div>
  );
}
