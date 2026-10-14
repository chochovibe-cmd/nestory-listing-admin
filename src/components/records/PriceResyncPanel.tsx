"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { PricingSettings } from "@/lib/pricing";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import {
  buildResyncRowPlan,
  describePricingSettings,
  type ResyncCandidate,
  type ResyncPreviewLine,
  type ResyncRowPlan
} from "@/lib/variants/priceResyncPlan";

type PreviewOk = {
  mock: boolean;
  lines?: ResyncPreviewLine[];
  unmatched?: string[];
  skipReason?: string | null;
  note?: string;
};

type RowState = {
  loading: boolean;
  /** why the product cannot be resynced safely (shown, never guessed around) */
  skipReason: string | null;
  loadError: string | null;
  plan: ResyncRowPlan | null;
  status: "idle" | "syncing" | "done" | "failed";
  message: string | null;
};

const EMPTY_ROW: RowState = { loading: true, skipReason: null, loadError: null, plan: null, status: "idle", message: null };

function titleOf(c: ResyncCandidate): string {
  return c.title_zh || c.taobao_title || "未命名";
}

function fmt(value: number | null): string {
  return value == null ? "—" : String(value);
}

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; payload: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return { ok: response.ok, payload: await response.json().catch(() => null) };
}

/**
 * VARIANT-CLEAN: 價格／款式圖重同步 (發布紀錄的第 5 個分頁).
 * Lists live products whose Shopify price differs from the current formula, or whose variant
 * pictures are not bound. Nothing is ticked by default (this changes live prices); 全選 ticks
 * everything. Each product is its own request, from this browser, one after the other —
 * the same stepwise idea as the publish batch. Layout reuses .rec-items / .schip / Button.
 */
export function PriceResyncPanel() {
  const [candidates, setCandidates] = useState<ResyncCandidate[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [previewProgress, setPreviewProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelled = useRef(false);

  const patchRow = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_ROW), ...patch } }));
  }, []);

  const loadPreview = useCallback(
    async (candidate: ResyncCandidate, pricing: PricingSettings) => {
      patchRow(candidate.id, { loading: true, loadError: null, skipReason: null });
      try {
        const { ok, payload } = await postJson(`/api/price-resync/${candidate.id}/preview`);
        if (!ok) {
          patchRow(candidate.id, { loading: false, loadError: payload?.error ?? "讀取 Shopify 失敗" });
          return;
        }
        const preview = payload as PreviewOk;
        if (preview.mock) {
          patchRow(candidate.id, { loading: false, loadError: preview.note ?? "模擬模式：不查詢 Shopify" });
          return;
        }
        if (preview.skipReason) {
          patchRow(candidate.id, { loading: false, skipReason: preview.skipReason });
          return;
        }
        patchRow(candidate.id, {
          loading: false,
          plan: buildResyncRowPlan({ candidate, preview: { lines: preview.lines ?? [] }, settings: pricing })
        });
      } catch {
        patchRow(candidate.id, { loading: false, loadError: "連線失敗" });
      }
    },
    [patchRow]
  );

  const loadAll = useCallback(async () => {
    cancelled.current = false;
    setLoadingList(true);
    setLoadError(null);
    const pricing = getStoredPricingSettings();
    setSettings(pricing);
    try {
      const response = await fetch("/api/price-resync/candidates");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setLoadError(payload?.error ?? "讀取已上架商品失敗");
        return;
      }
      const list = (payload?.drafts ?? []) as ResyncCandidate[];
      setCandidates(list);
      setRows(Object.fromEntries(list.map((c) => [c.id, { ...EMPTY_ROW }])));
      setSelected(new Set());
      setLoadingList(false);
      // One product per request, one after the other (never a burst against Shopify).
      for (let i = 0; i < list.length; i += 1) {
        if (cancelled.current) return;
        setPreviewProgress({ done: i, total: list.length });
        await loadPreview(list[i], pricing);
      }
      setPreviewProgress(null);
    } catch {
      setLoadError("讀取已上架商品連線失敗");
    } finally {
      setLoadingList(false);
    }
  }, [loadPreview]);

  useEffect(() => {
    void loadAll();
    return () => {
      cancelled.current = true;
    };
  }, [loadAll]);

  const actionable = useMemo(
    () => candidates.filter((c) => rows[c.id]?.plan?.needsAction),
    [candidates, rows]
  );
  const skipped = useMemo(() => candidates.filter((c) => rows[c.id]?.skipReason), [candidates, rows]);
  const failedLoads = useMemo(() => candidates.filter((c) => rows[c.id]?.loadError), [candidates, rows]);
  const upToDate = useMemo(
    () => candidates.filter((c) => rows[c.id]?.plan && !rows[c.id]?.plan?.needsAction).length,
    [candidates, rows]
  );
  const selectedCount = actionable.filter((c) => selected.has(c.id) && rows[c.id]?.status !== "done").length;

  async function syncOne(candidate: ResyncCandidate) {
    const plan = rows[candidate.id]?.plan;
    if (!plan) return;
    patchRow(candidate.id, { status: "syncing", message: null });
    try {
      const { ok, payload } = await postJson(`/api/price-resync/${candidate.id}/apply`, {
        variants: plan.request,
        bindImages: plan.imageCount > 0
      });
      if (!ok) {
        patchRow(candidate.id, { status: "failed", message: payload?.error ?? "同步失敗" });
        return;
      }
      const notes = [
        payload?.mock ? "模擬模式，未寫入" : `價格 ${payload?.pricesUpdated ?? 0} 款、綁圖 ${payload?.imagesBound ?? 0} 張`,
        ...(Array.isArray(payload?.warnings) ? payload.warnings : [])
      ];
      patchRow(candidate.id, { status: "done", message: notes.join("；") });
    } catch {
      patchRow(candidate.id, { status: "failed", message: "連線失敗" });
    }
  }

  async function syncSelected() {
    if (running) return;
    setRunning(true);
    try {
      for (const candidate of actionable) {
        if (!selected.has(candidate.id) || rows[candidate.id]?.status === "done") continue;
        await syncOne(candidate);
      }
    } finally {
      setRunning(false);
    }
  }

  if (loadingList && candidates.length === 0) return <p className="muted">載入已上架商品…</p>;
  if (loadError) {
    return (
      <div className="notice notice-warn rec-empty">
        <p>
          <strong>{loadError}</strong>
        </p>
        <p style={{ marginTop: 10 }}>
          <Button size="sm" type="button" onClick={() => void loadAll()}>
            重試
          </Button>
        </p>
      </div>
    );
  }

  return (
    <div className="vr-panel">
      <p className="vc-note">
        只同步每個款式的<strong>售價、定價（劃線價）、款式圖</strong>；不會動標題、描述、圖片順序、庫存、庫存政策、商品狀態與銷售管道，也不會改 SKU 和款式名稱。
      </p>
      {settings ? <p className="vc-note">{describePricingSettings(settings)}</p> : null}
      {previewProgress ? (
        <p className="muted">
          讀取 Shopify 現價中 {previewProgress.done + 1}/{previewProgress.total}…
        </p>
      ) : null}

      <div className="vr-toolbar">
        <h2 className="vr-title">價格／款式圖重同步</h2>
        <div className="vr-toolbar-actions">
          <Button
            disabled={running || actionable.length === 0}
            onClick={() => setSelected(new Set(actionable.map((c) => c.id)))}
            size="sm"
            type="button"
          >
            全選
          </Button>
          <Button
            disabled={running || selectedCount === 0}
            loading={running}
            onClick={() => void syncSelected()}
            size="sm"
            type="button"
            variant="primary"
          >
            同步勾選的商品（{selectedCount}）
          </Button>
        </div>
      </div>

      {actionable.length === 0 && !previewProgress ? (
        <div className="empty-state">
          <div className="empty-icon">◈</div>
          <p className="empty-state-title">沒有需要同步的商品</p>
          <p className="empty-state-desc">已上架商品的 Shopify 價格都符合目前公式，款式圖也都綁好了</p>
        </div>
      ) : null}

      <ul className="rec-items vr-list">
        {actionable.map((candidate) => {
          const state = rows[candidate.id] ?? EMPTY_ROW;
          const plan = state.plan as ResyncRowPlan;
          return (
            <li className="rec-item vr-item" key={candidate.id}>
              <input
                aria-label={`勾選 ${titleOf(candidate)}`}
                checked={selected.has(candidate.id)}
                disabled={running || state.status === "syncing" || state.status === "done"}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(candidate.id);
                  else next.delete(candidate.id);
                  setSelected(next);
                }}
                type="checkbox"
              />
              <span className="rec-item-text">
                <strong>{titleOf(candidate)}</strong>
                <span className="vr-id muted"> · {candidate.id.slice(0, 8)}</span>
                <span className="vr-lines">
                  {plan.lines
                    .filter((line) => line.priceChanged || line.needsImage || line.note)
                    .map((line, index) => (
                      <span className="vr-line" key={`${line.rowId ?? "single"}-${index}`}>
                        {line.label}：
                        {line.priceChanged ? (
                          <>
                            <span className="vc-price-old">{fmt(line.oldPrice)}</span> → <strong>{fmt(line.newPrice)}</strong>
                            {line.oldCompareAt !== line.newCompareAt && (line.newCompareAt != null || line.oldCompareAt != null) ? (
                              <span className="vc-orig">（定價 {fmt(line.oldCompareAt)} → {fmt(line.newCompareAt)}）</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="vc-orig">價格不變</span>
                        )}
                        {line.needsImage ? <span className="vc-orig">　要綁圖</span> : null}
                        {line.note ? <span className="vc-orig">　{line.note}</span> : null}
                      </span>
                    ))}
                </span>
                <span className="vr-summary vc-orig">
                  {plan.imageCount > 0 ? `要綁圖 ${plan.imageCount} 張` : "款式圖都已綁好"}
                </span>
              </span>
              <span className="vr-status">
                {state.status === "syncing" ? <span className="schip schip--run">同步中</span> : null}
                {state.status === "done" ? <span className="schip schip--ok">完成</span> : null}
                {state.status === "failed" ? <span className="schip schip--danger">失敗</span> : null}
                {state.message ? <span className="vc-orig vr-message">{state.message}</span> : null}
                {state.status === "failed" ? (
                  <Button disabled={running} onClick={() => void syncOne(candidate)} size="sm" type="button">
                    重試
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {upToDate > 0 ? <p className="muted">另有 {upToDate} 件商品已是最新，不需要同步。</p> : null}
      {skipped.length > 0 ? (
        <div className="vr-skipped">
          <p className="vc-note">以下商品無法安全對應 Shopify 上的款式，已略過（不會亂猜）：</p>
          <ul className="rec-items">
            {skipped.map((candidate) => (
              <li className="rec-item" key={candidate.id}>
                <span className="rec-item-text">
                  <strong>{titleOf(candidate)}</strong>
                  <span className="vc-orig"> — {rows[candidate.id]?.skipReason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failedLoads.length > 0 ? (
        <div className="vr-skipped">
          <p className="vc-note">以下商品讀不到 Shopify 資料：</p>
          <ul className="rec-items">
            {failedLoads.map((candidate) => (
              <li className="rec-item" key={candidate.id}>
                <span className="rec-item-text">
                  <strong>{titleOf(candidate)}</strong>
                  <span className="vc-orig"> — {rows[candidate.id]?.loadError}</span>
                </span>
                <Button onClick={() => settings && void loadPreview(candidate, settings)} size="sm" type="button">
                  重試
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
