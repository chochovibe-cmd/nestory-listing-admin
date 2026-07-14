"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isAdmin } from "@/lib/auth/roles";
import {
  MIGRATION_027_HINT,
  publishBatchTitle
} from "@/lib/drafts/publishBatch";
import {
  PUBLISH_BATCH_ITEM_SELECT,
  PUBLISH_BATCH_SELECT,
  RECORDS_FETCH_LIMIT,
  batchCardTitle,
  batchMetaLine,
  batchStatusSchip,
  canRetryFailedBatch,
  failedDraftIdsFromItems,
  filterPublishBatches,
  itemLineText,
  itemStatusDotClass,
  recordsMigrationHintFromError,
  snapshotTitleMap,
  type PublishBatchItemListRow,
  type PublishBatchListRow,
  type PublishRecordsFilter
} from "@/lib/drafts/publishRecords";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";
import type { PublishMode, UserRole } from "@/types/domain";

type ScopeMode = "mine" | "all";

/**
 * D7-open / C5 skeleton: publish batch cards + detail + retry-failed (new batch).
 * Style: layout-only tokens + .schip (no BX-P).
 */
export function PublishRecordsPanel() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [scope, setScope] = useState<ScopeMode>("mine");
  const [filter, setFilter] = useState<PublishRecordsFilter>("all");
  const [rows, setRows] = useState<PublishBatchListRow[]>([]);
  const [itemsByBatch, setItemsByBatch] = useState<Record<string, PublishBatchItemListRow[]>>({});
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrationHint, setMigrationHint] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryBusyId, setRetryBusyId] = useState<string | null>(null);

  const admin = isAdmin(role);

  const load = useCallback(async () => {
    if (!hasSupabaseBrowserEnv()) {
      setError("需要設定 Supabase 才能使用發布紀錄");
      setRows([]);
      setLoading(false);
      setRoleReady(true);
      return;
    }

    setLoading(true);
    setError(null);
    setMigrationHint(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser();

      if (userError) {
        setError(userError.message);
        setRows([]);
        setRoleReady(true);
        return;
      }
      if (!user) {
        setError("請先登入");
        setRows([]);
        setRole(null);
        setRoleReady(true);
        return;
      }

      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      const nextRole = (profile?.role as UserRole | undefined) ?? null;
      setRole(nextRole);
      setRoleReady(true);

      let query = supabase
        .from("publish_batches")
        .select(PUBLISH_BATCH_SELECT)
        .order("created_at", { ascending: false })
        .limit(RECORDS_FETCH_LIMIT);

      const useMine =
        nextRole === "operator" || (isAdmin(nextRole) && scope === "mine");
      // Reviewer sees all by RLS; operator forced mine
      if (useMine || (nextRole === "reviewer" && scope === "mine")) {
        // admin mine / operator: filter created_by
        if (nextRole === "operator" || (isAdmin(nextRole) && scope === "mine")) {
          query = query.eq("created_by", user.id);
        }
      }

      const { data, error: batchError } = await query;

      if (batchError) {
        const hint = recordsMigrationHintFromError(batchError.message);
        setMigrationHint(hint);
        setError(
          hint
            ? "發布批次表尚未建立"
            : batchError.message
        );
        setRows([]);
        return;
      }

      setRows((data ?? []) as PublishBatchListRow[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMigrationHint(recordsMigrationHintFromError(msg));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => filterPublishBatches(rows, filter), [rows, filter]);

  async function ensureItems(batchId: string): Promise<PublishBatchItemListRow[]> {
    if (itemsByBatch[batchId]) return itemsByBatch[batchId];
    const supabase = createClient();
    const { data, error: itemError } = await supabase
      .from("publish_batch_items")
      .select(PUBLISH_BATCH_ITEM_SELECT)
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });

    if (itemError) {
      setNotice(itemError.message);
      return [];
    }
    const list = (data ?? []) as PublishBatchItemListRow[];
    setItemsByBatch((prev) => ({ ...prev, [batchId]: list }));
    return list;
  }

  async function toggleOpen(batchId: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
    if (!itemsByBatch[batchId]) {
      await ensureItems(batchId);
    }
  }

  /**
   * Q3 A-lite: re-run failed drafts as a NEW batch (same publishMode).
   */
  async function retryFailed(row: PublishBatchListRow) {
    setRetryBusyId(row.id);
    setNotice(null);
    try {
      const items = await ensureItems(row.id);
      const failedIds = failedDraftIdsFromItems(items);
      if (failedIds.length === 0) {
        setNotice("此批沒有可重送的失敗件");
        return;
      }

      const publishMode = (row.publish_mode === "active" ? "active" : "draft") as PublishMode;
      const response = await fetch("/api/drafts/batch/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftIds: failedIds,
          publishMode,
          confirmActive: publishMode === "active"
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(
          [payload.error ?? "重送失敗", payload.hint].filter(Boolean).join(" — ")
        );
        return;
      }
      setNotice(
        payload.message ??
          `已新建批次重送：成功 ${payload.succeeded ?? 0}／失敗 ${payload.failed ?? 0}`
      );
      await load();
    } catch {
      setNotice("重送連線失敗");
    } finally {
      setRetryBusyId(null);
    }
  }

  return (
    <div className="rec-page">
      <div className="ir-page-header">
        <div className="ir-title-row">
          <h1>🧾 發布紀錄</h1>
          <span className="ir-sub">批次發布結果（Shopify API）· 失敗可重送新批</span>
        </div>
        {roleReady && admin ? (
          <div className="ir-scope">
            <label className="sr-only" htmlFor="rec-scope">
              範圍
            </label>
            <select
              id="rec-scope"
              className="ir-scope-select"
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeMode)}
            >
              <option value="mine">只看我的</option>
              <option value="all">全部成員</option>
            </select>
          </div>
        ) : null}
      </div>

      <div className="rec-filters stage-filter-pills" role="tablist" aria-label="紀錄篩選">
        <button
          type="button"
          className={`pill-btn${filter === "all" ? " sel sel--fill" : ""}`}
          onClick={() => setFilter("all")}
        >
          全部
        </button>
        <button
          type="button"
          className={`pill-btn${filter === "has_failed" ? " sel sel--fill" : ""}`}
          onClick={() => setFilter("has_failed")}
        >
          有失敗
        </button>
        <span
          className="rec-filter-muted"
          title="Showmore／Matrixify 走 CSV 下載，不進本頁 Shopify 批次帳"
        >
          Showmore／Matrixify 匯出不進本頁批次帳
        </span>
      </div>

      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <p className="muted">載入中…</p>
      ) : error ? (
        <div className="notice notice-warn rec-empty">
          <p>
            <strong>{error}</strong>
          </p>
          {migrationHint ? (
            <p className="muted" style={{ marginTop: 8 }}>
              {migrationHint}
            </p>
          ) : null}
          {!migrationHint ? (
            <p style={{ marginTop: 10 }}>
              <button type="button" className="mini-btn" onClick={() => void load()}>
                重試
              </button>
            </p>
          ) : (
            <p className="muted" style={{ marginTop: 8 }}>
              執行 SQL 後重新整理本頁即可。在此之前不會顯示假資料。
            </p>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="notice rec-empty ir-empty">
          <p>
            <strong>尚無發布批次</strong>
          </p>
          <p className="muted" style={{ marginTop: 6 }}>
            在工作檯「核准並建草稿／上架」後，結果會出現在這裡。
          </p>
          <p style={{ marginTop: 12 }}>
            <Link href="/drafts/new" className="mini-btn">
              去工作檯
            </Link>
          </p>
        </div>
      ) : (
        <div className="rec-list ir-list">
          {visible.map((row) => {
            const open = openIds.has(row.id);
            const statusMeta = batchStatusSchip(row.status);
            const items = itemsByBatch[row.id] ?? [];
            const titles = snapshotTitleMap(row.snapshot_json);
            const showRetry = canRetryFailedBatch(row, items.length ? items : undefined);
            const retryBusy = retryBusyId === row.id;

            return (
              <article key={row.id} className="rec-card ir-card">
                <div className="rec-head ir-head">
                  <button
                    type="button"
                    className="rec-head-main"
                    onClick={() => void toggleOpen(row.id)}
                    aria-expanded={open}
                  >
                    <span className="rec-icon" aria-hidden>
                      🛍
                    </span>
                    <span className="rec-head-text">
                      <span className="rec-title">{batchCardTitle(row)}</span>
                      <span className="rec-meta muted">{batchMetaLine(row)}</span>
                    </span>
                    <span className={statusMeta.className}>{statusMeta.label}</span>
                    {row.done_count > 0 ? (
                      <span className="schip schip--ok">成功 {row.done_count}</span>
                    ) : null}
                    {row.failed_count > 0 ? (
                      <span className="schip schip--error">失敗 {row.failed_count}</span>
                    ) : null}
                    <span className="ir-head-chev">{open ? "▴" : "▾"}</span>
                  </button>
                  {showRetry ? (
                    <button
                      type="button"
                      className="mini-btn rec-retry"
                      disabled={retryBusy || !!retryBusyId}
                      onClick={(e) => {
                        e.stopPropagation();
                        void retryFailed(row);
                      }}
                    >
                      {retryBusy ? "重送中…" : "↻ 重送失敗件"}
                    </button>
                  ) : null}
                </div>
                {open ? (
                  <div className="rec-body ir-body">
                    {row.error_summary ? (
                      <p className="muted rec-summary">{row.error_summary}</p>
                    ) : null}
                    {items.length === 0 ? (
                      <p className="muted">載入明細…</p>
                    ) : (
                      <ul className="rec-items">
                        {items.map((item) => (
                          <li key={item.id} className="rec-item">
                            <span className={itemStatusDotClass(item.item_status)} aria-hidden />
                            <span className="rec-item-text">
                              {itemLineText(item, titles.get(item.draft_id))}
                            </span>
                            {item.shopify_admin_url ? (
                              <a
                                className="mini-btn"
                                href={item.shopify_admin_url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                後台
                              </a>
                            ) : null}
                            <Link className="mini-btn" href={`/drafts/${item.draft_id}`}>
                              草稿
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="muted rec-mode-hint">
                      {publishBatchTitle(
                        row.publish_mode === "active" ? "active" : "draft"
                      )}
                      {" · "}
                      共 {row.total_count} 件
                    </p>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
