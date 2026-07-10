"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ResultCard } from "@/components/listing/ResultCard";
import { GENERATION_PROGRESS_EVENT, type GenerationProgress } from "@/components/listing/generationProgress";
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

  const progressHeadStatus = progress
    ? progress.steps.some((step) => step.status === "error")
      ? "error"
      : progress.steps.every((step) => step.status === "done")
        ? "done"
        : "running"
    : null;

  const imagesByDraft = new Map<string, ProductImage[]>();
  for (const image of images) {
    const list = imagesByDraft.get(image.draft_id) ?? [];
    list.push(image);
    imagesByDraft.set(image.draft_id, list);
  }

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
    <section className="panel">
      <div className="panel-header rc-panel-header">
        <h2>◈ 生成結果</h2>
        {drafts.length > 0 ? (
          <div className="rc-header-actions">
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
                onClick={() => batchApproveAndPublish("draft")}
                title="核准後在 Shopify 建立草稿商品，不會公開上架"
                type="button"
              >
                核准並建草稿
              </button>
              <button
                className="btn-mini danger"
                disabled={busy || !selectedArray.length}
                onClick={() => batchApproveAndPublish("active")}
                title="核准後直接在 Shopify 建立正式上架商品，會立刻公開，請先確認內容無誤"
                type="button"
              >
                核准並上架
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
        ) : null}
      </div>
      <div className="panel-body">
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
        {message ? <div className="notice">{message}</div> : null}
        {drafts.length === 0 && !progress ? (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p className="muted">在左側輸入商品資料並送出，生成結果會出現在這裡</p>
          </div>
        ) : (
          <div className="results-list" id="results-list">
            {drafts.map((draft) => (
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
    </section>
  );
}
