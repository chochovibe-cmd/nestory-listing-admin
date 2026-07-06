"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ResultCard } from "@/components/listing/ResultCard";
import type { ProductDraft, ProductImage } from "@/types/domain";

const PENDING_STATUSES = new Set([
  "pending_input", "pending_copy", "ready_for_review", "needs_revision"
]);
const APPROVED_STATUSES = new Set(["approved", "csv_ready"]);
const FAILED_STATUSES = new Set(["api_failed", "failed"]);

export function DraftResultsPanel({
  drafts,
  images,
  userId
}: {
  drafts: ProductDraft[];
  images: ProductImage[];
  userId: string;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const imagesByDraft = useMemo(() => {
    const map = new Map<string, ProductImage[]>();
    for (const image of images) {
      const list = map.get(image.draft_id) ?? [];
      list.push(image);
      map.set(image.draft_id, list);
    }
    return map;
  }, [images]);

  const counts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let failed = 0;
    for (const draft of drafts) {
      if (PENDING_STATUSES.has(draft.status)) pending++;
      else if (APPROVED_STATUSES.has(draft.status)) approved++;
      else if (FAILED_STATUSES.has(draft.status)) failed++;
    }
    return { pending, approved, failed };
  }, [drafts]);

  const allSelected = drafts.length > 0 && selectedIds.size === drafts.length;
  const someSelected = selectedIds.size > 0 && !allSelected;
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
    setSelectedIds((current) =>
      current.size === drafts.length ? new Set() : new Set(drafts.map((d) => d.id))
    );
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

  return (
    <div>
      <div className="batch-toolbar">
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
          {selectedIds.size > 0 ? `已選 ${selectedIds.size} 筆` : "請先勾選才能使用批次操作"}
        </span>
        <span className="batch-status-counts">
          <span className="status-pill">待處理 {counts.pending}</span>
          <span className="status-pill status-ok">已核准 {counts.approved}</span>
          {counts.failed > 0 ? <span className="status-pill status-warn">失敗 {counts.failed}</span> : null}
        </span>
        <div className="batch-actions">
          <button
            disabled={busy || !selectedArray.length}
            onClick={batchApprove}
            title="把已選取的商品狀態改成「已核准」，尚未建立 Shopify 商品"
            type="button"
          >
            批次核准
          </button>
          <button
            disabled={busy || !selectedArray.length}
            onClick={() => batchPublish("draft")}
            title="在 Shopify 建立草稿商品，不會公開上架"
            type="button"
          >
            批次建立草稿
          </button>
          <button
            className="danger"
            disabled={busy || !selectedArray.length}
            onClick={() => batchPublish("active")}
            title="直接在 Shopify 建立正式上架商品，會立刻公開，請先確認內容無誤"
            type="button"
          >
            批次上架
          </button>
          <button
            disabled={busy || !selectedArray.length}
            onClick={() => downloadCsv("/api/exports/matrixify", "nestory-matrixify")}
            title="下載 Matrixify 格式 CSV，供 Shopify 後台批次匯入"
            type="button"
          >
            匯出 Matrixify
          </button>
          <button
            disabled={busy || !selectedArray.length}
            onClick={() => downloadCsv("/api/exports/showmore", "nestory-showmore", "重量欄位為預設值 0.1kg，上傳前請手動確認。")}
            title="下載 Showmore 格式 CSV，官網庫存/重量為預設值，上傳前請手動確認"
            type="button"
          >
            匯出 Showmore
          </button>
        </div>
      </div>
      {message ? <div className="notice">{message}</div> : null}
      <div className="results-list" id="results-list">
        {drafts.map((draft) => (
          <ResultCard
            checked={selectedIds.has(draft.id)}
            draft={draft}
            images={imagesByDraft.get(draft.id) ?? []}
            key={draft.id}
            onToggle={() => toggleOne(draft.id)}
            userId={userId}
          />
        ))}
      </div>
    </div>
  );
}
