"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";

type LifecycleRow = {
  id: string;
  status: string;
  publish_status: string | null;
  shopify_product_id: string | null;
};

type TargetMap = Record<string, HTMLElement>;

function isRealProductId(value: string | null): value is string {
  return Boolean(value && value !== "mock-product-id");
}

/**
 * A1 lifecycle-only bridge for /records. It appends actions into the existing
 * product action row without changing PublishRecordsPanel's frozen layout.
 */
export function PublishLifecycleActionsBridge() {
  const [rows, setRows] = useState<LifecycleRow[]>([]);
  const [targets, setTargets] = useState<TargetMap>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<LifecycleRow | null>(null);

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const loadRows = useCallback(async () => {
    if (!hasSupabaseBrowserEnv()) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("product_drafts")
      .select("id, status, publish_status, shopify_product_id")
      .in("status", ["active_published", "draft_created"])
      .limit(200);
    if (error) return;
    setRows((data ?? []) as LifecycleRow[]);
  }, []);

  const refreshTargets = useCallback(() => {
    const next: TargetMap = {};
    document.querySelectorAll<HTMLElement>(".rec-product-card").forEach((card) => {
      const draftLink = card.querySelector<HTMLAnchorElement>('a[href^="/drafts/"]');
      const href = draftLink?.getAttribute("href") ?? "";
      const id = href.startsWith("/drafts/") ? href.slice("/drafts/".length).split(/[?#/]/)[0] : "";
      if (!id) return;
      let target = card.querySelector<HTMLElement>(`[data-shopify-lifecycle-actions="${CSS.escape(id)}"]`);
      if (!target) {
        target = document.createElement("span");
        target.dataset.shopifyLifecycleActions = id;
        target.style.display = "inline-flex";
        target.style.alignItems = "center";
        target.style.gap = "8px";
        card.appendChild(target);
      }
      next[id] = target;
    });
    setTargets(next);
  }, []);

  useEffect(() => {
    void loadRows();
    const timer = window.setTimeout(refreshTargets, 0);
    const observer = new MutationObserver(() => refreshTargets());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [loadRows, refreshTargets]);

  async function republish(row: LifecycleRow) {
    if (!isRealProductId(row.shopify_product_id)) return;
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/drafts/${row.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishMode: "active", confirmActive: true })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error ?? "重新上架失敗", "error");
        return;
      }
      showToast("已重新上架，同一個 Shopify 商品已恢復 ACTIVE", "success");
      window.location.assign("/records?tab=published");
    } catch {
      showToast("重新上架連線失敗", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmUnpublish() {
    const row = confirmRow;
    if (!row || !isRealProductId(row.shopify_product_id)) return;
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/drafts/${row.id}/unpublish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmUnpublish: true })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error ?? "下架失敗", "error");
        return;
      }
      setConfirmRow(null);
      showToast("已下架；Shopify 商品保留為草稿", "success");
      window.location.assign("/records?tab=shopify_drafts");
    } catch {
      showToast("下架連線失敗", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {Object.entries(targets).map(([id, target]) => {
        const row = byId.get(id);
        if (!row || !isRealProductId(row.shopify_product_id)) return null;
        const lifecycleStatus = row.publish_status || row.status;
        if (lifecycleStatus === "active_published") {
          return createPortal(
            <Button
              key={`unpublish-${id}`}
              variant="secondary"
              size="sm"
              type="button"
              disabled={busyId !== null}
              loading={busyId === id}
              onClick={() => setConfirmRow(row)}
              aria-label="下架 Shopify 商品"
            >
              下架
            </Button>,
            target,
            `unpublish-${id}`
          );
        }
        if (lifecycleStatus === "draft_created") {
          return createPortal(
            <Button
              key={`republish-${id}`}
              variant="primary"
              size="sm"
              type="button"
              disabled={busyId !== null}
              loading={busyId === id}
              onClick={() => void republish(row)}
            >
              重新上架
            </Button>,
            target,
            `republish-${id}`
          );
        }
        return null;
      })}

      {confirmRow ? (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(0,0,0,.28)"
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && busyId === null) setConfirmRow(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shopify-unpublish-title"
            className="notice"
            style={{ width: "min(420px, 100%)", padding: 20 }}
          >
            <p id="shopify-unpublish-title" style={{ margin: 0, fontWeight: 700 }}>
              確認將此商品下架？
            </p>
            <p className="muted" style={{ margin: "8px 0 16px" }}>
              Shopify 商品會保留，但顧客端將不可購買。
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button
                size="sm"
                type="button"
                disabled={busyId !== null}
                onClick={() => setConfirmRow(null)}
              >
                取消
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                loading={busyId === confirmRow.id}
                onClick={() => void confirmUnpublish()}
              >
                確認下架
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
