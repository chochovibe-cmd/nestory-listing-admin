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

type LifecycleAction = "archive" | "restore";

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
  const [confirm, setConfirm] = useState<{ row: LifecycleRow; action: LifecycleAction } | null>(null);

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const loadRows = useCallback(async () => {
    if (!hasSupabaseBrowserEnv()) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("product_drafts")
      .select("id, status, publish_status, shopify_product_id")
      .in("status", ["active_published", "draft_created", "archived"])
      .limit(200);
    // New status values are additive; fall back for an older preview schema.
    if (error) {
      const fallback = await supabase.from("product_drafts").select("id, status, publish_status, shopify_product_id").in("status", ["active_published", "draft_created"]).limit(200);
      if (fallback.error) return;
      setRows((fallback.data ?? []) as LifecycleRow[]);
      return;
    }
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

  async function runLifecycle() {
    if (!confirm || !isRealProductId(confirm.row.shopify_product_id)) return;
    const { row, action } = confirm;
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/drafts/${row.id}/shopify-lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmAction: true })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error ?? "Shopify 操作失敗", "error");
        return;
      }
      setConfirm(null);
      showToast(action === "archive" ? "已封存 Shopify 商品" : "已恢復 Shopify 商品為草稿", "success");
      window.location.assign("/records?tab=published");
    } catch {
      showToast("Shopify 操作連線失敗", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {Object.entries(targets).map(([id, target]) => {
        const row = byId.get(id);
        if (!row || !isRealProductId(row.shopify_product_id)) return null;
        const lifecycleStatus = row.status === "archived" ? "archived" : row.publish_status || row.status;
        if (lifecycleStatus === "active_published") {
          return createPortal(
            <Button
              key={`unpublish-${id}`}
              variant="secondary"
              size="sm"
              type="button"
              disabled={busyId !== null}
              loading={busyId === id}
              onClick={() => setConfirm({ row, action: "archive" })}
              aria-label="封存 Shopify 商品"
            >
              Shopify 封存
            </Button>,
            target,
            `unpublish-${id}`
          );
        }
        if (lifecycleStatus === "archived") {
          return createPortal(
            <Button
              key={`republish-${id}`}
              variant="primary"
              size="sm"
              type="button"
              disabled={busyId !== null}
              loading={busyId === id}
              onClick={() => setConfirm({ row, action: "restore" })}
            >
              恢復 Shopify
            </Button>,
            target,
            `republish-${id}`
          );
        }
        return null;
      })}

      {confirm ? (
        <div className="modal-overlay open" role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && busyId === null) setConfirm(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shopify-lifecycle-title"
            className="modal-box"
          >
            <div className="modal-hdr"><h3 id="shopify-lifecycle-title">{confirm.action === "archive" ? "確認封存 Shopify 商品" : "確認恢復 Shopify 商品"}</h3><button className="modal-close" type="button" onClick={() => setConfirm(null)} disabled={busyId !== null} aria-label="關閉">×</button></div>
            <div className="modal-body"><p>{confirm.action === "archive" ? "商品會從顧客端移除，但仍保留在 Shopify 後台，可稍後恢復。" : "商品會恢復為 Shopify 草稿，不會直接公開販售。"}</p><div className="approve-sum-actions">
              <Button
                size="sm"
                type="button"
                disabled={busyId !== null}
                onClick={() => setConfirm(null)}
              >
                取消
              </Button>
              <Button
                variant={confirm.action === "archive" ? "secondary" : "primary"}
                size="sm"
                type="button"
                loading={busyId === confirm.row.id}
                onClick={() => void runLifecycle()}
              >
                {confirm.action === "archive" ? "確認封存" : "確認恢復"}
              </Button>
            </div></div>
          </div>
        </div>
      ) : null}
    </>
  );
}
