"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/listing/StatusBadge";
import { categoryLabel } from "@/lib/categories";
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

const PENDING_STATUSES = new Set(["pending_input", "pending_copy", "processing", "ready_for_review", "needs_revision"]);
const APPROVED_STATUSES = new Set(["approved", "publishing", "draft_created", "active_published", "csv_ready"]);
const FAILED_STATUSES = new Set(["api_failed", "failed"]);

const PUBLISH_MODE_LABELS: Record<string, string> = {
  active: "直接上架",
  draft: "僅建草稿"
};

type Filter = "all" | "pending" | "approved" | "failed";

export function DraftQueueList({ drafts }: { drafts: DraftQueueRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const counts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let failed = 0;
    for (const draft of drafts) {
      if (PENDING_STATUSES.has(draft.status)) pending += 1;
      else if (APPROVED_STATUSES.has(draft.status)) approved += 1;
      else if (FAILED_STATUSES.has(draft.status)) failed += 1;
    }
    return { pending, approved, failed };
  }, [drafts]);

  const filtered = useMemo(() => {
    if (filter === "all") return drafts;
    const set = filter === "pending" ? PENDING_STATUSES : filter === "approved" ? APPROVED_STATUSES : FAILED_STATUSES;
    return drafts.filter((draft) => set.has(draft.status));
  }, [drafts, filter]);

  const allSelected = filtered.length > 0 && filtered.every((draft) => selectedIds.has(draft.id));
  const someSelected = filtered.some((draft) => selectedIds.has(draft.id)) && !allSelected;
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

  async function batchApprove() {
    if (!selectedArray.length) return;
    setBusy(true);
    setMessage("批次核准中...");
    const response = await fetch("/api/drafts/batch/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds: selectedArray })
    });
    const payload = await response.json();
    setBusy(false);
    setMessage(response.ok ? `已核准 ${payload.approvedCount} 筆` : payload.error ?? "批次核准失敗");
    setSelectedIds(new Set());
    router.refresh();
  }

  async function batchPublish(mode: "draft" | "active") {
    if (!selectedArray.length) return;
    if (mode === "active") {
      const confirmed = window.confirm(
        `即將對已選取的 ${selectedArray.length} 筆商品建立 Shopify ACTIVE 商品（直接上架），確定嗎？`
      );
      if (!confirmed) return;
    }
    setBusy(true);
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
        ? `成功 ${payload.succeeded} 筆／失敗 ${payload.failed} 筆`
        : payload.error ?? "批次發布失敗"
    );
    setSelectedIds(new Set());
    router.refresh();
  }

  async function downloadCsv(endpoint: string, filenamePrefix: string, note?: string) {
    if (!selectedArray.length) return;
    setBusy(true);
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
      <div className="pill-group queue-filter-pills" aria-label="依狀態篩選">
        <button className={`pill-btn${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")} type="button">
          全部 {drafts.length}
        </button>
        <button className={`pill-btn${filter === "pending" ? " active" : ""}`} onClick={() => setFilter("pending")} type="button">
          待處理 {counts.pending}
        </button>
        <button className={`pill-btn${filter === "approved" ? " active" : ""}`} onClick={() => setFilter("approved")} type="button">
          已核准 {counts.approved}
        </button>
        <button className={`pill-btn${filter === "failed" ? " active" : ""}`} onClick={() => setFilter("failed")} type="button">
          失敗 {counts.failed}
        </button>
      </div>

      <div className="queue-batch-toolbar">
        <label className="check-row">
          <input
            checked={allSelected}
            onChange={toggleAll}
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            type="checkbox"
          />
          全選
        </label>
        <span className="batch-selected-count">
          {selectedIds.size > 0 ? `已選 ${selectedIds.size} 筆` : "勾選商品以使用批次操作"}
        </span>
        <div className="batch-actions">
          <button
            className="btn-mini"
            disabled={busy || !selectedArray.length}
            onClick={batchApprove}
            title="把已選取的商品狀態改成「已核准」，尚未建立 Shopify 商品"
            type="button"
          >
            一鍵審核
          </button>
          <button
            className="btn-mini"
            disabled={busy || !selectedArray.length}
            onClick={() => batchPublish("draft")}
            title="在 Shopify 建立草稿商品，不會公開上架"
            type="button"
          >
            建立草稿
          </button>
          <button
            className="btn-mini danger"
            disabled={busy || !selectedArray.length}
            onClick={() => batchPublish("active")}
            title="直接在 Shopify 建立正式上架商品，會立刻公開，請先確認內容無誤"
            type="button"
          >
            批次上架
          </button>
          <button
            className="btn-mini"
            disabled={busy || !selectedArray.length}
            onClick={() => downloadCsv("/api/exports/matrixify", "nestory-matrixify")}
            title="下載 Matrixify 格式 CSV，供 Shopify 後台批次匯入"
            type="button"
          >
            ⬇ Matrixify
          </button>
          <button
            className="btn-mini"
            disabled={busy || !selectedArray.length}
            onClick={() => downloadCsv("/api/exports/showmore", "nestory-showmore", "重量欄位為預設值 0.1kg，上傳前請手動確認。")}
            title="下載 Showmore 格式 CSV，官網庫存/重量為預設值，上傳前請手動確認"
            type="button"
          >
            ⬇ Showmore
          </button>
        </div>
      </div>
      {message ? <div className="notice">{message}</div> : null}

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
                </tr>
              </thead>
              <tbody>
                {filtered.map((draft) => (
                  <tr key={draft.id}>
                    <td>
                      <input checked={selectedIds.has(draft.id)} onChange={() => toggleOne(draft.id)} type="checkbox" />
                    </td>
                    <td>
                      <Link href={`/drafts/${draft.id}`}>
                        <strong>{displayTitle(draft)}</strong>
                      </Link>
                      <div className="muted">{categoryLabel(draft.category)}</div>
                    </td>
                    <td><StatusBadge status={draft.status} /></td>
                    <td><StatusBadge status={draft.generation_status} /></td>
                    <td>
                      <div className="muted">{PUBLISH_MODE_LABELS[draft.publish_mode] ?? draft.publish_mode}</div>
                      <StatusBadge status={draft.publish_status} />
                    </td>
                    <td>NT${draft.twd_price?.toLocaleString() ?? "-"}</td>
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
                  {draft.twd_price ? <span className="rc-price">NT${draft.twd_price.toLocaleString()}</span> : null}
                </div>
                <div className="queue-card-meta">
                  <StatusBadge status={draft.status} />
                  <StatusBadge status={draft.generation_status} />
                  <span className="muted">{PUBLISH_MODE_LABELS[draft.publish_mode] ?? draft.publish_mode}</span>
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
