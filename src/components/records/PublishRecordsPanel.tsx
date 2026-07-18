"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showToast } from "@/components/Toast";
import { isAdmin } from "@/lib/auth/roles";
import {
  MIGRATION_027_HINT,
  publishBatchTitle
} from "@/lib/drafts/publishBatch";
import {
  BATCH_KIND_FILTERS,
  PUBLISH_BATCH_ITEM_SELECT,
  PUBLISH_BATCH_SELECT,
  PUBLISH_RECORDS_TABS,
  RECORDS_FETCH_LIMIT,
  RECORDS_PRODUCT_SELECT,
  RECORDS_PUBLISHED_LIMIT,
  RECORDS_PUBLISHED_STATUSES,
  RECORDS_SHOPIFY_DRAFT_STATUS,
  batchCardTitle,
  batchMetaLine,
  batchProcessTagLabel,
  batchStatusSchip,
  canRetryFailedBatch,
  failedDraftIdsFromItems,
  filterBatchesByKind,
  filterBatchesForTab,
  flattenFailedItems,
  itemLineText,
  itemStatusDotClass,
  parseRecordsTab,
  recordsMigrationHintFromError,
  recordsProductStatusLabel,
  recordsProductTitle,
  snapshotProcessTagMap,
  snapshotTitleMap,
  type PublishBatchItemListRow,
  type PublishBatchListRow,
  type PublishRecordsKindFilter,
  type PublishRecordsTab,
  type RecordsProductRow
} from "@/lib/drafts/publishRecords";
import {
  filterLibraryRows,
  type LibraryDraftRow
} from "@/lib/library/productLibrary";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";
import type { PublishMode, UserRole } from "@/types/domain";

type ScopeMode = "mine" | "all";

/**
 * D7 + R4 §9: four-tab 發布紀錄（批次／失敗重試／Shopify 草稿／已發布封存）.
 * Style: layout-only tokens + .schip / pills (no new color values).
 */
export function PublishRecordsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = parseRecordsTab(searchParams.get("tab"));
  const batchFromUrl = searchParams.get("batch");

  const [role, setRole] = useState<UserRole | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [scope, setScope] = useState<ScopeMode>("mine");
  const [tab, setTab] = useState<PublishRecordsTab>(tabFromUrl);
  const [rows, setRows] = useState<PublishBatchListRow[]>([]);
  const [itemsByBatch, setItemsByBatch] = useState<
    Record<string, PublishBatchItemListRow[]>
  >({});
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrationHint, setMigrationHint] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryBusyId, setRetryBusyId] = useState<string | null>(null);
  const [failedSelected, setFailedSelected] = useState<Set<string>>(() => new Set());
  const [failedRetryBusy, setFailedRetryBusy] = useState(false);
  /** UX-N T65: client filter for batches + failed (shared). */
  const [kindFilter, setKindFilter] = useState<PublishRecordsKindFilter>("all");

  // Product tabs
  const [productRows, setProductRows] = useState<RecordsProductRow[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryHits, setLibraryHits] = useState<LibraryDraftRow[]>([]);
  const [librarySearching, setLibrarySearching] = useState(false);
  const [promoteBusyId, setPromoteBusyId] = useState<string | null>(null);

  const admin = isAdmin(role);

  useEffect(() => {
    setTab(tabFromUrl);
  }, [tabFromUrl]);

  function setTabAndUrl(next: PublishRecordsTab) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    if (next !== "batches") params.delete("batch");
    router.replace(`/records?${params.toString()}`, { scroll: false });
  }

  const loadBatches = useCallback(async () => {
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
        // UX-I T55: transient → toast + panel
        showToast(userError.message, "error");
        setError(userError.message);
        setRows([]);
        setRoleReady(true);
        return;
      }
      if (!user) {
        // Blocking notice
        setError("請先登入");
        setRows([]);
        setRole(null);
        setRoleReady(true);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
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
      if (useMine || (nextRole === "reviewer" && scope === "mine")) {
        if (nextRole === "operator" || (isAdmin(nextRole) && scope === "mine")) {
          query = query.eq("created_by", user.id);
        }
      }

      const { data, error: batchError } = await query;

      if (batchError) {
        const hint = recordsMigrationHintFromError(batchError.message);
        setMigrationHint(hint);
        // Table missing = blocking config notice; other query fails → toast
        const msg = hint ? "發布批次表尚未建立" : batchError.message;
        if (!hint) showToast(`發布紀錄載入失敗：${msg}`, "error");
        setError(msg);
        setRows([]);
        return;
      }

      setRows((data ?? []) as PublishBatchListRow[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(msg, "error");
      setError(msg);
      setMigrationHint(recordsMigrationHintFromError(msg));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  const loadProducts = useCallback(
    async (mode: "shopify_drafts" | "published") => {
      if (!hasSupabaseBrowserEnv()) {
        setProductError("需要設定 Supabase");
        return;
      }
      setProductLoading(true);
      setProductError(null);
      try {
        const supabase = createClient();
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (!user) {
          setProductError("請先登入");
          setProductRows([]);
          return;
        }

        let query = supabase
          .from("product_drafts")
          .select(RECORDS_PRODUCT_SELECT)
          .order("updated_at", { ascending: false })
          .limit(RECORDS_PUBLISHED_LIMIT);

        if (mode === "shopify_drafts") {
          query = query.eq("status", RECORDS_SHOPIFY_DRAFT_STATUS);
        } else {
          query = query.in("status", [...RECORDS_PUBLISHED_STATUSES]);
        }

        if (
          role === "operator" ||
          (isAdmin(role) && scope === "mine")
        ) {
          query = query.eq("created_by", user.id);
        }

        const { data, error: qErr } = await query;
        if (qErr) {
          setProductError(qErr.message);
          setProductRows([]);
          return;
        }
        setProductRows((data ?? []) as RecordsProductRow[]);
      } catch (e) {
        setProductError(e instanceof Error ? e.message : String(e));
        setProductRows([]);
      } finally {
        setProductLoading(false);
      }
    },
    [role, scope]
  );

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    if (tab === "shopify_drafts" || tab === "published") {
      void loadProducts(tab);
    }
  }, [tab, loadProducts]);

  // Deep link: open batch card
  useEffect(() => {
    if (!batchFromUrl || rows.length === 0) return;
    setOpenIds((prev) => new Set(prev).add(batchFromUrl));
    void ensureItems(batchFromUrl).then(() => {
      window.setTimeout(() => {
        document
          .getElementById(`rec-batch-${batchFromUrl}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when rows land
  }, [batchFromUrl, rows]);

  const visibleBatches = useMemo(
    () =>
      filterBatchesByKind(
        filterBatchesForTab(rows, tab === "failed" ? "failed" : "batches"),
        kindFilter
      ),
    [rows, tab, kindFilter]
  );

  const failedBatchesForTab = useMemo(
    () => filterBatchesByKind(filterBatchesForTab(rows, "failed"), kindFilter),
    [rows, kindFilter]
  );

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

  // Prefetch failed items when on failed tab
  useEffect(() => {
    if (tab !== "failed") return;
    for (const b of failedBatchesForTab) {
      if (!itemsByBatch[b.id]) void ensureItems(b.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, failedBatchesForTab]);

  const flatFailed = useMemo(
    () => flattenFailedItems(failedBatchesForTab, itemsByBatch),
    [failedBatchesForTab, itemsByBatch]
  );

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

  async function retryFailed(row: PublishBatchListRow) {
    setRetryBusyId(row.id);
    setNotice(null);
    try {
      const items = await ensureItems(row.id);
      const failedIds = failedDraftIdsFromItems(items);
      if (failedIds.length === 0) {
        showToast("此批沒有可重送的失敗件", "warn");
        return;
      }
      await runRetryPublish(failedIds, row.publish_mode === "active" ? "active" : "draft");
    } finally {
      setRetryBusyId(null);
    }
  }

  async function runRetryPublish(draftIds: string[], publishMode: PublishMode) {
    setNotice(null);
    try {
      const response = await fetch("/api/drafts/batch/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftIds,
          publishMode,
          confirmActive: publishMode === "active"
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // UX-I T55: operation feedback → toast
        const line = [payload.error ?? "重送失敗", payload.hint].filter(Boolean).join(" — ");
        showToast(line, "error");
        setNotice(null);
        return;
      }
      const okMsg =
        payload.message ??
        `已新建批次重送：成功 ${payload.succeeded ?? 0}／失敗 ${payload.failed ?? 0}`;
      showToast(okMsg, "success");
      setNotice(null);
      setFailedSelected(new Set());
      await loadBatches();
    } catch {
      showToast("重送連線失敗", "error");
      setNotice(null);
    }
  }

  async function retrySelectedFailed() {
    if (failedSelected.size === 0) return;
    setFailedRetryBusy(true);
    try {
      // Default draft mode for mixed history; active if any selected from active batch
      let mode: PublishMode = "draft";
      for (const draftId of failedSelected) {
        const hit = flatFailed.find((f) => f.draftId === draftId);
        if (!hit) continue;
        const batch = rows.find((r) => r.id === hit.batchId);
        if (batch?.publish_mode === "active") {
          mode = "active";
          break;
        }
      }
      await runRetryPublish([...failedSelected], mode);
    } finally {
      setFailedRetryBusy(false);
    }
  }

  async function promoteDraft(draftId: string) {
    setPromoteBusyId(draftId);
    setNotice(null);
    try {
      await runRetryPublish([draftId], "active");
      if (tab === "shopify_drafts") await loadProducts("shopify_drafts");
    } finally {
      setPromoteBusyId(null);
    }
  }

  async function searchLibrary() {
    const q = librarySearch.trim();
    if (!q) {
      setLibraryHits([]);
      return;
    }
    setLibrarySearching(true);
    try {
      const supabase = createClient();
      const { data, error: qErr } = await supabase
        .from("product_drafts")
        .select(
          "id, title_zh, taobao_title, original_title, status, created_by, published_at, created_at, shopify_product_id, ip_name, character_name"
        )
        .in("status", [
          "active_published",
          "draft_created",
          "csv_ready",
          "archived"
        ])
        .order("updated_at", { ascending: false })
        .limit(150);
      if (qErr) {
        setNotice(qErr.message);
        setLibraryHits([]);
        return;
      }
      const rowsLib = (data ?? []) as LibraryDraftRow[];
      setLibraryHits(filterLibraryRows(rowsLib, q));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "搜尋失敗");
      setLibraryHits([]);
    } finally {
      setLibrarySearching(false);
    }
  }

  return (
    <div className="rec-page">
      <div className="ir-page-header">
        <div className="ir-title-row">
          <h1>🧾 發布紀錄</h1>
          <span className="ir-sub">
            終點站＋補救站 · 批次／失敗重試／Shopify 草稿／已發布
          </span>
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

      <div className="rec-filters stage-filter-pills" role="tablist" aria-label="紀錄分頁">
        {PUBLISH_RECORDS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`pill-btn${tab === t.key ? " sel sel--fill" : ""}`}
            onClick={() => setTabAndUrl(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "batches" || tab === "failed" ? (
        <div className="rec-kind-filters" aria-label="通路篩選">
          <div
            className="rec-filters stage-filter-pills rec-kind-pills"
            role="group"
            aria-label="依通路篩選"
          >
            {BATCH_KIND_FILTERS.map((k) => (
              <button
                key={k.key}
                type="button"
                className={`pill-btn${kindFilter === k.key ? " sel sel--fill" : ""}`}
                aria-pressed={kindFilter === k.key}
                onClick={() => setKindFilter(k.key)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="rec-filter-muted">依通路篩選已載入的批次</p>
        </div>
      ) : null}

      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}

      {tab === "batches" || tab === "failed" ? (
        loading ? (
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
                <button type="button" className="mini-btn" onClick={() => void loadBatches()}>
                  重試
                </button>
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 8 }}>
                {MIGRATION_027_HINT}
              </p>
            )}
          </div>
        ) : tab === "failed" ? (
          <FailedRetrySection
            items={flatFailed}
            selected={failedSelected}
            setSelected={setFailedSelected}
            busy={failedRetryBusy}
            onRetry={() => void retrySelectedFailed()}
            itemsLoading={failedBatchesForTab.some((b) => !itemsByBatch[b.id])}
            kindFilter={kindFilter}
          />
        ) : visibleBatches.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p className="muted">
              {rows.length === 0
                ? "尚無發布批次"
                : kindFilter === "all"
                  ? "尚無發布批次"
                  : "此通路尚無批次"}
            </p>
            {rows.length === 0 ? (
              <Link className="button primary empty-state-cta" href="/drafts/new?pane=results">
                去工作檯
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="rec-list ir-list">
            {visibleBatches.map((row) => {
              const open = openIds.has(row.id);
              const statusMeta = batchStatusSchip(row.status);
              const items = itemsByBatch[row.id] ?? [];
              const titles = snapshotTitleMap(row.snapshot_json);
              const processTags = snapshotProcessTagMap(row.snapshot_json);
              const batchTag = batchProcessTagLabel(row.snapshot_json);
              const showRetry = canRetryFailedBatch(
                row,
                items.length ? items : undefined
              );
              const retryBusy = retryBusyId === row.id;

              return (
                <article
                  key={row.id}
                  className="rec-card ir-card"
                  id={`rec-batch-${row.id}`}
                >
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
                      {batchTag ? (
                        <span className="schip schip--idle rec-process-tag">{batchTag}</span>
                      ) : null}
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
                          {items.map((item) => {
                            const pTag = processTags.get(item.draft_id) ?? null;
                            return (
                              <li key={item.id} className="rec-item">
                                <span
                                  className={itemStatusDotClass(item.item_status)}
                                  aria-hidden
                                />
                                <span className="rec-item-text">
                                  {itemLineText(item, titles.get(item.draft_id))}
                                  {pTag ? (
                                    <span className="rec-item-tag muted"> · {pTag}</span>
                                  ) : null}
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
                            );
                          })}
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
        )
      ) : null}

      {tab === "shopify_drafts" || tab === "published" ? (
        <ProductListSection
          mode={tab}
          rows={productRows}
          loading={productLoading}
          error={productError}
          onRetry={() => void loadProducts(tab)}
          promoteBusyId={promoteBusyId}
          onPromote={(id) => void promoteDraft(id)}
          showSearch={tab === "published"}
          librarySearch={librarySearch}
          setLibrarySearch={setLibrarySearch}
          onSearch={() => void searchLibrary()}
          libraryHits={libraryHits}
          librarySearching={librarySearching}
        />
      ) : null}
    </div>
  );
}

function FailedRetrySection({
  items,
  selected,
  setSelected,
  busy,
  onRetry,
  itemsLoading,
  kindFilter
}: {
  items: ReturnType<typeof flattenFailedItems>;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  busy: boolean;
  onRetry: () => void;
  itemsLoading: boolean;
  kindFilter: PublishRecordsKindFilter;
}) {
  if (itemsLoading && items.length === 0) {
    return <p className="muted">載入失敗件…</p>;
  }
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◈</div>
        <p className="muted">
          {kindFilter === "all" ? "目前沒有失敗件" : "此通路目前沒有失敗件"}
        </p>
      </div>
    );
  }

  const allSelected = items.every((i) => selected.has(i.draftId));

  return (
    <div className="rec-failed-panel">
      <div className="results-batch-toolbar" role="toolbar" aria-label="失敗件批次">
        <label className="check-row results-batch-check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => {
              if (allSelected) setSelected(new Set());
              else setSelected(new Set(items.map((i) => i.draftId)));
            }}
          />
          全選
        </label>
        <span className="batch-selected-count">
          {selected.size > 0 ? `已選 ${selected.size} 筆` : "勾選失敗件以重送"}
        </span>
        <button
          type="button"
          className="button primary"
          disabled={busy || selected.size === 0}
          onClick={onRetry}
        >
          {busy ? "重送中…" : "↻ 重送勾選"}
        </button>
      </div>
      <ul className="rec-items rec-failed-list">
        {items.map((item) => (
          <li key={item.itemId} className="rec-item">
            <label className="check-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={selected.has(item.draftId)}
                onChange={() => {
                  const next = new Set(selected);
                  if (next.has(item.draftId)) next.delete(item.draftId);
                  else next.add(item.draftId);
                  setSelected(next);
                }}
              />
            </label>
            <span className="rec-dot rec-dot--ng" aria-hidden />
            <span className="rec-item-text">
              <strong>{item.title}</strong>
              {item.processTag ? (
                <span className="muted"> · {item.processTag}</span>
              ) : null}
              <br />
              <span className="muted">{item.errorMessage}</span>
            </span>
            <Link className="mini-btn" href={`/drafts/${item.draftId}`}>
              草稿
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductListSection({
  mode,
  rows,
  loading,
  error,
  onRetry,
  promoteBusyId,
  onPromote,
  showSearch,
  librarySearch,
  setLibrarySearch,
  onSearch,
  libraryHits,
  librarySearching
}: {
  mode: "shopify_drafts" | "published";
  rows: RecordsProductRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  promoteBusyId: string | null;
  onPromote: (id: string) => void;
  showSearch: boolean;
  librarySearch: string;
  setLibrarySearch: (v: string) => void;
  onSearch: () => void;
  libraryHits: LibraryDraftRow[];
  librarySearching: boolean;
}) {
  return (
    <div className="rec-product-panel">
      {showSearch ? (
        <div className="rec-search-row">
          <input
            className="library-search"
            type="search"
            placeholder="搜尋更早的商品（名稱／IP／角色）…"
            value={librarySearch}
            onChange={(e) => setLibrarySearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch();
            }}
            aria-label="商品庫搜尋"
          />
          <button
            type="button"
            className="mini-btn"
            disabled={librarySearching}
            onClick={onSearch}
          >
            {librarySearching ? "搜尋中…" : "搜尋"}
          </button>
        </div>
      ) : null}

      {libraryHits.length > 0 ? (
        <div className="rec-library-hits">
          <p className="muted" style={{ marginBottom: 8 }}>
            搜尋結果（商品庫，最多顯示已載入命中）
          </p>
          <ul className="rec-items">
            {libraryHits.map((row) => (
              <li key={row.id} className="rec-item rec-product-card">
                <span className="rec-item-text">
                  <strong>
                    {row.title_zh || row.taobao_title || row.original_title || "未命名"}
                  </strong>
                  <br />
                  <span className="muted">
                    {recordsProductStatusLabel(row.status)}
                    {row.ip_name ? ` · ${row.ip_name}` : ""}
                  </span>
                </span>
                <Link className="mini-btn" href={`/drafts/${row.id}`}>
                  開啟
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading ? (
        <p className="muted">載入中…</p>
      ) : error ? (
        <div className="notice notice-warn">
          <p>{error}</p>
          <button type="button" className="mini-btn" onClick={onRetry}>
            重試
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◈</div>
          <p className="muted">
            {mode === "shopify_drafts" ? "尚無 Shopify 草稿" : "尚無已發布／封存商品"}
          </p>
          {mode === "shopify_drafts" ? (
            <Link className="button primary empty-state-cta" href="/drafts/new?pane=results">
              去工作檯
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          {mode === "published" ? (
            <p className="muted rec-limit-hint">
              顯示最近 {RECORDS_PUBLISHED_LIMIT} 筆；更早請用搜尋（接商品庫）
            </p>
          ) : null}
          <ul className="rec-items rec-product-list">
            {rows.map((row) => (
              <li key={row.id} className="rec-item rec-product-card">
                <span className="rec-item-text">
                  <strong>{recordsProductTitle(row)}</strong>
                  <br />
                  <span className="muted">
                    {recordsProductStatusLabel(row.status)}
                    {row.category ? ` · ${row.category}` : ""}
                    {row.ip_name ? ` · ${row.ip_name}` : ""}
                  </span>
                </span>
                {mode === "shopify_drafts" ? (
                  <button
                    type="button"
                    className="mini-btn"
                    disabled={promoteBusyId === row.id}
                    onClick={() => onPromote(row.id)}
                  >
                    {promoteBusyId === row.id ? "上架中…" : "轉正式上架"}
                  </button>
                ) : null}
                {row.shopify_admin_url ? (
                  <a
                    className="mini-btn"
                    href={row.shopify_admin_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    後台
                  </a>
                ) : null}
                <Link className="mini-btn" href={`/drafts/${row.id}`}>
                  開啟
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
