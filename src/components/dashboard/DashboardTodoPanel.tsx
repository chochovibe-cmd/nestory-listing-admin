"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { showToast } from "@/components/Toast";
import { isAdmin } from "@/lib/auth/roles";
import {
  buildFunnelRows,
  computeFunnelStats,
  funnelTruncationNotice,
  prepareFunnelNavigation,
  type FunnelDraftRow,
  type FunnelRowDef
} from "@/lib/dashboard/funnelStats";
import {
  COST_DETAIL_UI_LIMIT,
  COST_DRAFT_FETCH_LIMIT,
  COST_DRAFT_SELECT_COLUMNS,
  computeCostBudgetView,
  costBudgetMigrationHint,
  formatNtd,
  formatUsd,
  type CostBudgetView,
  type CostDraftRow
} from "@/lib/dashboard/costBudgetStats";
import {
  HEALTH_DRAFT_FETCH_LIMIT,
  HEALTH_DRAFT_SELECT_COLUMNS,
  HEALTH_HISTORY_FETCH_LIMIT,
  HEALTH_HISTORY_SELECT_COLUMNS,
  computeHealthMetricsView,
  healthDraftMigrationHint,
  healthHistoryMigrationHint,
  taiwanHeatmapRange,
  taiwanLastNDaysRange,
  type HealthDraftRow,
  type HealthHistoryRow,
  type HealthMetricsView
} from "@/lib/dashboard/healthMetrics";
import {
  computeMakeQuotaView,
  makeQuotaMigrationHint,
  taiwanMonthRange,
  type MakeQuotaBatchRow,
  type MakeQuotaView
} from "@/lib/dashboard/makeQuotaStats";
import {
  TODO_DRAFT_SELECT_COLUMNS,
  TODO_FETCH_LIMIT,
  buildTodoCards,
  countTodoBuckets,
  prepareTodoNavigation,
  todoTruncationNotice,
  type TodoDraftRow
} from "@/lib/dashboard/todoBuckets";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";
import type { UserRole } from "@/types/domain";

type ScopeMode = "mine" | "all";

const BATCH_SELECT = "id, total_count, created_at, created_by";
/** Soft cap: free tier planning ≪ this even at high volume. */
const QUOTA_BATCH_FETCH_LIMIT = 500;

/**
 * E1-open + E2-open + E3-open + E4-open + E5-open:
 * 今日待辦 + 流程漏斗 + Make 額度 + 月預算成本 + 健康指標（熱圖／重做率／Tag）.
 */
export function DashboardTodoPanel() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [scope, setScope] = useState<ScopeMode>("mine");
  const [rows, setRows] = useState<TodoDraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // E3: separate team-wide batch fetch (Q2-A; not tied to todo scope)
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [imageBatches, setImageBatches] = useState<MakeQuotaBatchRow[]>([]);
  const [publishBatches, setPublishBatches] = useState<MakeQuotaBatchRow[]>([]);
  const [quotaTableHint, setQuotaTableHint] = useState<string | null>(null);
  const [quotaFetchError, setQuotaFetchError] = useState<string | null>(null);

  // E4: separate cost fetch by copy_generated_at (Q1-A / Q2-A; not E1 scope)
  const [costLoading, setCostLoading] = useState(true);
  const [costRows, setCostRows] = useState<CostDraftRow[]>([]);
  const [costTableHint, setCostTableHint] = useState<string | null>(null);
  const [costFetchError, setCostFetchError] = useState<string | null>(null);
  const [costDetailOpen, setCostDetailOpen] = useState(true);

  // E5: team-wide health (Q6-A; not E1 scope)
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthDrafts, setHealthDrafts] = useState<HealthDraftRow[]>([]);
  const [healthHistory, setHealthHistory] = useState<HealthHistoryRow[]>([]);
  const [healthDraftHint, setHealthDraftHint] = useState<string | null>(null);
  const [healthHistoryHint, setHealthHistoryHint] = useState<string | null>(null);
  const [healthDraftError, setHealthDraftError] = useState<string | null>(null);
  const [healthHistoryError, setHealthHistoryError] = useState<string | null>(null);

  const admin = isAdmin(role);

  const load = useCallback(async () => {
    if (!hasSupabaseBrowserEnv()) {
      setError("需要設定 Supabase 才能使用儀表板");
      setRows([]);
      setLoading(false);
      setQuotaLoading(false);
      setCostLoading(false);
      setHealthLoading(false);
      setRoleReady(true);
      return;
    }

    setLoading(true);
    setQuotaLoading(true);
    setCostLoading(true);
    setHealthLoading(true);
    setError(null);
    setQuotaFetchError(null);
    setQuotaTableHint(null);
    setCostFetchError(null);
    setCostTableHint(null);
    setHealthDraftHint(null);
    setHealthHistoryHint(null);
    setHealthDraftError(null);
    setHealthHistoryError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser();

      if (userError) {
        // UX-I T55: transient auth error → toast + panel notice
        showToast(userError.message, "error");
        setError(userError.message);
        setRows([]);
        setRoleReady(true);
        setQuotaLoading(false);
        setCostLoading(false);
        setHealthLoading(false);
        return;
      }
      if (!user) {
        // Blocking: page notice only
        setError("請先登入");
        setRows([]);
        setRole(null);
        setRoleReady(true);
        setQuotaLoading(false);
        setCostLoading(false);
        setHealthLoading(false);
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
        .from("product_drafts")
        .select(TODO_DRAFT_SELECT_COLUMNS)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(TODO_FETCH_LIMIT);

      // Operator: always own (RLS also enforces). Admin: scope 我的/全部.
      // Reviewer: RLS 可見全部，無下拉 → 預設全部.
      const useMine =
        nextRole === "operator" || (isAdmin(nextRole) && scope === "mine");
      if (useMine) {
        query = query.eq("created_by", user.id);
      }

      const { data, error: draftError } = await query;
      if (draftError) {
        showToast(`儀表板載入失敗：${draftError.message}`, "error");
        setError(draftError.message);
        setRows([]);
      } else {
        setRows((data ?? []) as TodoDraftRow[]);
      }

      // E3 Q2-A: always team-wide (no created_by); Taiwan month server filter
      const month = taiwanMonthRange();
      // E5: heatmap needs ~8 weeks of copy_generated_at; rates use 30d (subset)
      const heatRange = taiwanHeatmapRange();
      const rateRange = taiwanLastNDaysRange(30);
      const healthDraftStart =
        Date.parse(heatRange.startIso) <= Date.parse(rateRange.startIso)
          ? heatRange.startIso
          : rateRange.startIso;
      const healthDraftEnd =
        Date.parse(heatRange.endIso) >= Date.parse(rateRange.endIso)
          ? heatRange.endIso
          : rateRange.endIso;

      const [imgRes, pubRes, costRes, healthDraftRes, healthHistRes] =
        await Promise.all([
          supabase
            .from("image_batches")
            .select(BATCH_SELECT)
            .gte("created_at", month.startIso)
            .lt("created_at", month.endIso)
            .order("created_at", { ascending: false })
            .limit(QUOTA_BATCH_FETCH_LIMIT),
          supabase
            .from("publish_batches")
            .select(BATCH_SELECT)
            .gte("created_at", month.startIso)
            .lt("created_at", month.endIso)
            .order("created_at", { ascending: false })
            .limit(QUOTA_BATCH_FETCH_LIMIT),
          // E4 Q1-A: copy_generated_at month; Q2-A no created_by (team intent; RLS may still limit)
          supabase
            .from("product_drafts")
            .select(COST_DRAFT_SELECT_COLUMNS)
            .not("copy_generated_at", "is", null)
            .gte("copy_generated_at", month.startIso)
            .lt("copy_generated_at", month.endIso)
            .order("copy_generated_at", { ascending: false })
            .limit(COST_DRAFT_FETCH_LIMIT),
          // E5 Q1-A / Q6-A: team-wide drafts for heatmap + tag health
          supabase
            .from("product_drafts")
            .select(HEALTH_DRAFT_SELECT_COLUMNS)
            .not("copy_generated_at", "is", null)
            .gte("copy_generated_at", healthDraftStart)
            .lt("copy_generated_at", healthDraftEnd)
            .order("copy_generated_at", { ascending: false })
            .limit(HEALTH_DRAFT_FETCH_LIMIT),
          // E5 Q3-A: generation_history for rework rate (30d)
          supabase
            .from("generation_history")
            .select(HEALTH_HISTORY_SELECT_COLUMNS)
            .gte("created_at", rateRange.startIso)
            .lt("created_at", rateRange.endIso)
            .order("created_at", { ascending: false })
            .limit(HEALTH_HISTORY_FETCH_LIMIT)
        ]);

      const imgErr = imgRes.error?.message ?? null;
      const pubErr = pubRes.error?.message ?? null;
      const hint = makeQuotaMigrationHint(imgErr, pubErr);
      setQuotaTableHint(hint);

      if (hint) {
        setImageBatches([]);
        setPublishBatches([]);
      } else if (imgErr || pubErr) {
        // Non-migration errors: still use whatever succeeded
        setQuotaFetchError(imgErr || pubErr);
        setImageBatches((imgRes.data ?? []) as MakeQuotaBatchRow[]);
        setPublishBatches((pubRes.data ?? []) as MakeQuotaBatchRow[]);
      } else {
        setImageBatches((imgRes.data ?? []) as MakeQuotaBatchRow[]);
        setPublishBatches((pubRes.data ?? []) as MakeQuotaBatchRow[]);
      }

      const costErr = costRes.error?.message ?? null;
      const costHint = costBudgetMigrationHint(costErr);
      setCostTableHint(costHint);
      if (costHint) {
        setCostRows([]);
      } else if (costErr) {
        setCostFetchError(costErr);
        setCostRows([]);
      } else {
        setCostRows((costRes.data ?? []) as CostDraftRow[]);
      }

      // E5 drafts
      const hdErr = healthDraftRes.error?.message ?? null;
      const hdHint = healthDraftMigrationHint(hdErr);
      setHealthDraftHint(hdHint);
      if (hdHint) {
        setHealthDrafts([]);
      } else if (hdErr) {
        setHealthDraftError(hdErr);
        setHealthDrafts([]);
      } else {
        setHealthDrafts((healthDraftRes.data ?? []) as HealthDraftRow[]);
      }

      // E5 history
      const hhErr = healthHistRes.error?.message ?? null;
      const hhHint = healthHistoryMigrationHint(hhErr);
      setHealthHistoryHint(hhHint);
      if (hhHint) {
        setHealthHistory([]);
      } else if (hhErr) {
        setHealthHistoryError(hhErr);
        setHealthHistory([]);
      } else {
        setHealthHistory((healthHistRes.data ?? []) as HealthHistoryRow[]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(msg, "error");
      setError(msg);
      setRows([]);
    } finally {
      setLoading(false);
      setQuotaLoading(false);
      setCostLoading(false);
      setHealthLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => countTodoBuckets(rows, TODO_FETCH_LIMIT), [rows]);
  const cards = useMemo(() => buildTodoCards(counts), [counts]);
  /** UX-AB T85: all todo buckets zero → empty-state instead of four zero cards */
  const todoAllEmpty = useMemo(
    () =>
      counts.copy_review === 0 &&
      counts.image_review === 0 &&
      counts.failed === 0 &&
      counts.ready_to_publish === 0,
    [counts]
  );
  const truncNote = useMemo(() => todoTruncationNotice(counts), [counts]);

  const funnelStats = useMemo(
    () => computeFunnelStats(rows as FunnelDraftRow[], TODO_FETCH_LIMIT),
    [rows]
  );
  const funnelRows = useMemo(() => buildFunnelRows(funnelStats), [funnelStats]);
  const funnelTrunc = useMemo(
    () => funnelTruncationNotice(funnelStats, TODO_FETCH_LIMIT),
    [funnelStats]
  );

  const quotaView: MakeQuotaView | null = useMemo(() => {
    if (quotaTableHint) return null;
    return computeMakeQuotaView({
      imageBatches,
      publishBatches
    });
  }, [imageBatches, publishBatches, quotaTableHint]);

  const costView: CostBudgetView | null = useMemo(() => {
    if (costTableHint) return null;
    return computeCostBudgetView({
      rows: costRows,
      visibilityPartial: role === "operator"
    });
  }, [costRows, costTableHint, role]);

  const healthView: HealthMetricsView | null = useMemo(() => {
    // Still compute partial views even if one source failed (heatmap/tag from drafts, rework from history)
    if (healthDraftHint && healthHistoryHint) return null;
    return computeHealthMetricsView({
      drafts: healthDraftHint ? [] : healthDrafts,
      historyRows: healthHistoryHint ? [] : healthHistory,
      visibilityPartial: role === "operator"
    });
  }, [
    healthDrafts,
    healthHistory,
    healthDraftHint,
    healthHistoryHint,
    role
  ]);

  function onCardClick(card: (typeof cards)[number], e: MouseEvent<HTMLAnchorElement>) {
    // Allow modified-click / middle-click / new tab to skip storage write
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    const href = prepareTodoNavigation(
      card,
      typeof window !== "undefined" ? window.sessionStorage : null
    );
    window.location.assign(href);
  }

  function onFunnelClick(row: FunnelRowDef, e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    const href = prepareFunnelNavigation(
      row,
      typeof window !== "undefined" ? window.sessionStorage : null
    );
    window.location.assign(href);
  }

  const mainRows = funnelRows.filter((r) => r.kind === "main");
  const sideRows = funnelRows.filter((r) => r.kind === "side");
  const imageRow = funnelRows.find((r) => r.kind === "image");

  return (
    <main className="container">
      <div className="dash-page">
        <div className="ir-page-header dash-header">
          <div className="ir-title-row">
            <h1>📈 儀表板</h1>
            <span className="ir-sub">待辦 · 漏斗 · 成本</span>
          </div>
          {roleReady && admin ? (
            <div className="ir-scope">
              <label className="sr-only" htmlFor="dash-scope">
                範圍
              </label>
              <select
                id="dash-scope"
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
        <p className="muted dash-page-disclaimer" role="note">
          額度與 AI 成本為系統估算，非 Make／信用卡帳單；健康指標亦非 SEO 分數
        </p>

        <section className="panel dash-todo-panel" aria-labelledby="dash-todo-title">
          <div className="panel-header">
            <h2 id="dash-todo-title">今日待辦</h2>
            <span className="dash-todo-hint">積壓待辦 · 不限今天</span>
          </div>
          <div className="panel-body dash-todo-body">
            {loading ? (
              <div className="dash-skel-todo" role="status" aria-label="載入中">
                <div className="skeleton dash-skel-card" />
                <div className="skeleton dash-skel-card" />
                <div className="skeleton dash-skel-card" />
              </div>
            ) : error ? (
              <p className="dash-todo-status dash-todo-error" role="alert">
                {error}
              </p>
            ) : todoAllEmpty ? (
              /* UX-AB T85: unified empty-state when no backlog */
              <div className="empty-state">
                <div className="empty-icon" aria-hidden>
                  ✅
                </div>
                <p className="empty-state-title">今日待辦已清空</p>
                <p className="empty-state-desc">太棒了，沒有待處理項目</p>
              </div>
            ) : (
              <>
                {truncNote ? (
                  <p className="dash-todo-trunc" role="status">
                    {truncNote}
                  </p>
                ) : null}
                <div className="dash-todo-grid" role="list">
                  {cards.map((card) => (
                    <Link
                      key={card.key}
                      href={card.href}
                      className="dash-todo-card"
                      role="listitem"
                      onClick={(e) => onCardClick(card, e)}
                    >
                      <div className="dash-todo-card-top">
                        <span className="dash-todo-label">{card.label}</span>
                        <span className={card.schipClass}>{card.schipLabel}</span>
                      </div>
                      <div className="dash-todo-count" aria-label={`${card.count} 件`}>
                        {card.count}
                        <span className="dash-todo-unit">件</span>
                      </div>
                      {card.sub ? <p className="dash-todo-sub">{card.sub}</p> : null}
                      <span className="dash-todo-action">{card.action} →</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        {/* E2-open: 流程漏斗 — below E1; same loading/error/scope */}
        <section
          className="panel dash-funnel-panel"
          aria-labelledby="dash-funnel-title"
        >
          <div className="panel-header">
            <h2 id="dash-funnel-title">流程漏斗</h2>
            <span className="dash-todo-hint">現況積壓 · 上限 {TODO_FETCH_LIMIT}</span>
          </div>
          <div className="panel-body dash-funnel-body">
            {loading ? (
              <div className="dash-skel-funnel" role="status" aria-label="載入中">
                {[100, 85, 70, 55, 40].map((w) => (
                  <div
                    key={w}
                    className="skeleton dash-skel-funnel-bar"
                    style={{ width: `${w}%` }}
                  />
                ))}
              </div>
            ) : error ? (
              <p className="dash-todo-status dash-todo-error" role="alert">
                {error}
              </p>
            ) : (
              <>
                {funnelTrunc ? (
                  <p className="dash-todo-trunc" role="status">
                    {funnelTrunc}
                  </p>
                ) : null}

                <div className="dash-funnel-group" role="list" aria-label="主幹階段">
                  {mainRows.map((row) => (
                    <FunnelRowLink key={row.key} row={row} onClick={onFunnelClick} />
                  ))}
                </div>

                <p className="dash-funnel-section-label">側翼（不進主幹）</p>
                <div className="dash-funnel-group" role="list" aria-label="側翼階段">
                  {sideRows.map((row) => (
                    <FunnelRowLink key={row.key} row={row} onClick={onFunnelClick} />
                  ))}
                </div>

                {imageRow ? (
                  <>
                    <p className="dash-funnel-section-label">圖審副列（可與主幹重疊）</p>
                    <div className="dash-funnel-group" role="list" aria-label="圖片待審">
                      <FunnelRowLink row={imageRow} onClick={onFunnelClick} />
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* E3+E4: BX-P 桌機並排，減少「估算」標語重複（頁頂 disclaimer 已說明） */}
        <div className="dash-metrics-grid">
        {/* E3-open: Make 額度 — below E2; team-wide (Q2-A), not scope */}
        <section
          className="panel dash-quota-panel"
          aria-labelledby="dash-quota-title"
        >
          <div className="panel-header">
            <h2 id="dash-quota-title">Make 額度</h2>
          </div>
          <div className="panel-body dash-quota-body">
            {quotaLoading ? (
              <div
                className="skeleton dash-skel-block dash-skel-quota"
                role="status"
                aria-label="載入中"
              />
            ) : quotaTableHint ? (
              <p className="dash-todo-status dash-todo-error" role="alert">
                {quotaTableHint}
              </p>
            ) : quotaFetchError && !quotaView ? (
              <p className="dash-todo-status dash-todo-error" role="alert">
                {quotaFetchError}
              </p>
            ) : quotaView ? (
              <>
                {quotaFetchError ? (
                  <p className="dash-todo-trunc" role="status">
                    部分資料讀取失敗：{quotaFetchError}
                  </p>
                ) : null}
                <div className="dash-quota-card">
                  <div className="dash-quota-card-top">
                    <span className="dash-quota-label">本月操作</span>
                    {quotaView.warn ? (
                      <span className="schip schip--warn">接近上限</span>
                    ) : null}
                  </div>
                  <div
                    className="dash-quota-value"
                    aria-label={`本月估算 ${quotaView.used} 操作，上限 ${quotaView.limit}`}
                  >
                    {quotaView.used}
                    <span className="dash-quota-sep">／</span>
                    {quotaView.limit}
                  </div>
                  <p className="dash-quota-remain">
                    剩餘{" "}
                    <strong>{quotaView.remaining}</strong>
                    {" · "}
                    已用約 {Math.round(quotaView.usedRatio * 100)}%
                  </p>
                  <div
                    className="dash-quota-bar-track"
                    role="progressbar"
                    aria-valuenow={quotaView.barPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="額度使用比例"
                  >
                    <i
                      className={
                        quotaView.warn
                          ? "dash-quota-bar-fill dash-quota-bar-fill--warn"
                          : "dash-quota-bar-fill"
                      }
                      style={{ width: `${quotaView.barPct}%` }}
                    />
                  </div>
                  <p className="dash-quota-sub">{quotaView.subHint}</p>
                  <p className="dash-quota-detail">
                    送圖 {quotaView.imageBatchCount} 批（{quotaView.imageItemCount}{" "}
                    件）· 發布 {quotaView.publishBatchCount} 批（
                    {quotaView.publishItemCount} 件）
                  </p>
                  {quotaView.warnText ? (
                    <p className="dash-quota-warn" role="status">
                      {quotaView.warnText}
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="dash-todo-status">—</p>
            )}
          </div>
        </section>

        {/* E4-open: 月預算＋AI 成本 — team-wide intent (Q2-A), not scope */}
        <section
          className="panel dash-quota-panel dash-cost-panel"
          aria-labelledby="dash-cost-title"
        >
          <div className="panel-header">
            <h2 id="dash-cost-title">月預算 · AI 成本</h2>
          </div>
          <div className="panel-body dash-quota-body">
            {costLoading ? (
              <div
                className="skeleton dash-skel-block dash-skel-cost"
                role="status"
                aria-label="載入中"
              />
            ) : costTableHint ? (
              <p className="dash-todo-status dash-todo-error" role="alert">
                {costTableHint}
              </p>
            ) : costFetchError && !costView ? (
              <p className="dash-todo-status dash-todo-error" role="alert">
                {costFetchError}
              </p>
            ) : costView ? (
              <>
                {costFetchError ? (
                  <p className="dash-todo-trunc" role="status">
                    部分資料讀取失敗：{costFetchError}
                  </p>
                ) : null}
                {costView.truncationNote ? (
                  <p className="dash-todo-trunc" role="status">
                    {costView.truncationNote}
                  </p>
                ) : null}
                <div className="dash-quota-card">
                  <div className="dash-quota-card-top">
                    <span className="dash-quota-label">本月合計</span>
                    {costView.warn ? (
                      <span className="schip schip--warn">接近預算</span>
                    ) : null}
                  </div>
                  <div
                    className="dash-quota-value"
                    aria-label={`本月約 ${formatNtd(costView.totalNtd)}，預算 ${formatNtd(costView.budgetNtd)}`}
                  >
                    {formatNtd(costView.totalNtd)}
                    <span className="dash-quota-sep">／</span>
                    {formatNtd(costView.budgetNtd)}
                  </div>
                  <p className="dash-quota-remain">
                    剩餘{" "}
                    <strong>{formatNtd(costView.remainingNtd)}</strong>
                    {" · "}
                    已用約 {Math.round(costView.usedRatio * 100)}%
                    {" · "}
                    <span className="dash-cost-usd">
                      {formatUsd(costView.totalUsd)} USD
                    </span>
                  </p>
                  <div
                    className="dash-quota-bar-track"
                    role="progressbar"
                    aria-valuenow={costView.barPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="月預算使用比例"
                  >
                    <i
                      className={
                        costView.warn
                          ? "dash-quota-bar-fill dash-quota-bar-fill--warn"
                          : "dash-quota-bar-fill"
                      }
                      style={{ width: `${costView.barPct}%` }}
                    />
                  </div>
                  <p className="dash-quota-sub">{costView.subHint}</p>
                  <p className="dash-quota-detail">
                    有成本 {costView.withCostCount} 件
                    {costView.missingCostCount > 0
                      ? ` · 缺成本 ${costView.missingCostCount} 件（未計 $0）`
                      : null}
                  </p>
                  {costView.emptyText ? (
                    <p className="dash-todo-status" role="status">
                      {costView.emptyText}
                    </p>
                  ) : null}
                  {costView.warnText ? (
                    <p className="dash-quota-warn" role="status">
                      {costView.warnText}
                    </p>
                  ) : null}

                  {costView.detailTotal > 0 ? (
                    <div className="dash-cost-detail">
                      <button
                        type="button"
                        className="dash-cost-detail-toggle"
                        aria-expanded={costDetailOpen}
                        onClick={() => setCostDetailOpen((o) => !o)}
                      >
                        {costDetailOpen ? "收合" : "展開"}明細 · 本月有成本{" "}
                        {costView.detailTotal} 件
                        {costView.detailTotal > COST_DETAIL_UI_LIMIT
                          ? `（顯示前 ${COST_DETAIL_UI_LIMIT}）`
                          : null}
                      </button>
                      {costDetailOpen ? (
                        <ul className="dash-cost-list" role="list">
                          {costView.detailItems.map((item) => (
                            <li key={item.id}>
                              <Link
                                href={item.href}
                                className="dash-cost-row"
                              >
                                <span className="dash-cost-row-title">
                                  {item.title}
                                </span>
                                <span className="dash-cost-row-meta">
                                  <span className="dash-cost-row-amt">
                                    {formatUsd(item.costUsd)}
                                    <span className="dash-cost-row-ntd">
                                      {" "}
                                      · 約 {formatNtd(item.costNtd)}
                                    </span>
                                  </span>
                                  {item.model ? (
                                    <span className="dash-cost-row-model">
                                      {item.model}
                                    </span>
                                  ) : null}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="dash-todo-status">—</p>
            )}
          </div>
        </section>
        </div>{/* /.dash-metrics-grid */}

        {/* E5-open: 健康指標 — below E4; team-wide (Q6-A) */}
        <section
          className="panel dash-quota-panel dash-health-panel"
          aria-labelledby="dash-health-title"
        >
          <div className="panel-header">
            <h2 id="dash-health-title">健康指標</h2>
            <span className="dash-todo-hint">生成熱圖 · 重做率 · Tag 提醒</span>
          </div>
          <div className="panel-body dash-quota-body">
            {healthLoading ? (
              <div className="dash-skel-health" role="status" aria-label="載入中">
                <div className="skeleton dash-skel-health-cell" />
                <div className="skeleton dash-skel-health-cell" />
                <div className="skeleton dash-skel-health-cell" />
                <div className="skeleton dash-skel-health-cell" />
              </div>
            ) : healthDraftHint && healthHistoryHint ? (
              <p className="dash-todo-status dash-todo-error" role="alert">
                {healthDraftHint}
                <br />
                {healthHistoryHint}
              </p>
            ) : healthView ? (
              <>
                {healthDraftHint ? (
                  <p className="dash-todo-trunc" role="status">
                    {healthDraftHint}
                  </p>
                ) : null}
                {healthHistoryHint ? (
                  <p className="dash-todo-trunc" role="status">
                    {healthHistoryHint}
                  </p>
                ) : null}
                {healthDraftError ? (
                  <p className="dash-todo-trunc" role="status">
                    草稿資料讀取失敗：{healthDraftError}
                  </p>
                ) : null}
                {healthHistoryError ? (
                  <p className="dash-todo-trunc" role="status">
                    版本紀錄讀取失敗：{healthHistoryError}
                  </p>
                ) : null}

                {/* Rates row */}
                <div className="dash-health-rates" role="list">
                  <div className="dash-quota-card dash-health-rate-card" role="listitem">
                    <div className="dash-quota-card-top">
                      <span className="dash-quota-label">文案重做率</span>
                      <span className="schip schip--idle">近 30 日</span>
                    </div>
                    <div
                      className="dash-quota-value"
                      aria-label={
                        healthView.rework.ratePct === null
                          ? "文案重做率無資料"
                          : `文案重做率 ${healthView.rework.ratePct}%`
                      }
                    >
                      {healthView.rework.displayLabel}
                    </div>
                    {healthView.rework.ratePct !== null ? (
                      <p className="dash-quota-remain">
                        {healthView.rework.numerator}／
                        {healthView.rework.denominator} 件有版本紀錄
                        {healthView.rework.denominator > 0 ? (
                          <>
                            {" · "}
                            AI 二次 {healthView.rework.aiSecondaryCount}
                            {" · "}
                            僅手動 {healthView.rework.manualOnlyCount}
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    <p className="dash-quota-honesty">
                      {healthView.rework.honestyLabel}
                    </p>
                    <p className="dash-quota-sub">{healthView.rework.subHint}</p>
                    {healthView.rework.emptyText ? (
                      <p className="dash-todo-status" role="status">
                        {healthView.rework.emptyText}
                      </p>
                    ) : null}
                    {healthView.rework.truncationNote ? (
                      <p className="dash-todo-trunc" role="status">
                        {healthView.rework.truncationNote}
                      </p>
                    ) : null}
                  </div>

                  <div className="dash-quota-card dash-health-rate-card" role="listitem">
                    <div className="dash-quota-card-top">
                      <span className="dash-quota-label">Tag 提醒率</span>
                      <span className="schip schip--idle">近 30 日</span>
                    </div>
                    <div
                      className="dash-quota-value"
                      aria-label={
                        healthView.tagHealth.ratePct === null
                          ? "Tag 提醒率無資料"
                          : `Tag 提醒率 ${healthView.tagHealth.ratePct}%`
                      }
                    >
                      {healthView.tagHealth.displayLabel}
                    </div>
                    {healthView.tagHealth.ratePct !== null ? (
                      <p className="dash-quota-remain">
                        {healthView.tagHealth.numerator}／
                        {healthView.tagHealth.denominator} 件有生成時間
                        {" · "}
                        需修改 {healthView.tagHealth.needsRevisionCount}
                        {" · "}
                        Tag 空 {healthView.tagHealth.emptyTagsCount}
                      </p>
                    ) : null}
                    <p className="dash-quota-honesty">
                      {healthView.tagHealth.honestyLabel}
                    </p>
                    <p className="dash-quota-sub">{healthView.tagHealth.subHint}</p>
                    {healthView.tagHealth.emptyText ? (
                      <p className="dash-todo-status" role="status">
                        {healthView.tagHealth.emptyText}
                      </p>
                    ) : null}
                    {healthView.tagHealth.truncationNote ? (
                      <p className="dash-todo-trunc" role="status">
                        {healthView.tagHealth.truncationNote}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Heatmap */}
                <div className="dash-quota-card dash-heat-card">
                  <div className="dash-quota-card-top">
                    <span className="dash-quota-label">生成日曆</span>
                    <span className="schip schip--idle">近 8 週</span>
                  </div>
                  <p className="dash-quota-honesty">
                    {healthView.heatmap.honestyLabel}
                  </p>
                  <p className="dash-quota-sub">{healthView.heatmap.subHint}</p>
                  {healthDraftHint ? (
                    <p className="dash-todo-status" role="status">
                      —
                    </p>
                  ) : (
                    <>
                      <div
                        className="dash-heat-grid"
                        role="img"
                        aria-label={`近 8 週生成熱圖，合計 ${healthView.heatmap.totalCount} 件`}
                      >
                        <div className="dash-heat-ydays" aria-hidden="true">
                          <span>一</span>
                          <span>三</span>
                          <span>五</span>
                          <span>日</span>
                        </div>
                        <div className="dash-heat-cells">
                          {healthView.heatmap.cells.map((cell) => (
                            <i
                              key={cell.dayKey}
                              className={`dash-heat-cell dash-heat-cell--l${cell.level}${
                                cell.isFuture ? " dash-heat-cell--future" : ""
                              }`}
                              title={cell.title}
                              aria-label={cell.title}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="dash-heat-legend" aria-hidden="true">
                        <span>少</span>
                        <i className="dash-heat-cell dash-heat-cell--l0" />
                        <i className="dash-heat-cell dash-heat-cell--l1" />
                        <i className="dash-heat-cell dash-heat-cell--l2" />
                        <i className="dash-heat-cell dash-heat-cell--l3" />
                        <span>多</span>
                      </div>
                      <p className="dash-quota-detail">
                        合計 {healthView.heatmap.totalCount} 件 · 有生成{" "}
                        {healthView.heatmap.daysWithActivity} 天
                      </p>
                      {healthView.heatmap.emptyText ? (
                        <p className="dash-todo-status" role="status">
                          {healthView.heatmap.emptyText}
                        </p>
                      ) : null}
                      {healthView.heatmap.truncationNote ? (
                        <p className="dash-todo-trunc" role="status">
                          {healthView.heatmap.truncationNote}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="dash-todo-status">—</p>
            )}
          </div>
        </section>

        <p className="dash-later-note">
          AI 顧問 → 後續版本（E6）
        </p>
      </div>
    </main>
  );
}

function FunnelRowLink({
  row,
  onClick
}: {
  row: FunnelRowDef;
  onClick: (row: FunnelRowDef, e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={row.href}
      className={`dash-funnel-row dash-funnel-row--${row.kind}`}
      role="listitem"
      onClick={(e) => onClick(row, e)}
    >
      <div className="dash-funnel-row-top">
        <span className="dash-funnel-label">{row.label}</span>
        <span className={row.schipClass}>{row.schipLabel}</span>
      </div>
      <div
        className="dash-funnel-bar-track"
        aria-hidden="true"
      >
        <i
          className="dash-funnel-bar-fill"
          style={{ width: `${row.barPct}%` }}
        />
      </div>
      <div className="dash-funnel-row-meta">
        <span className="dash-funnel-count" aria-label={`${row.count} 件`}>
          {row.count}
          <span className="dash-todo-unit">件</span>
        </span>
        <span className="dash-funnel-dwell" title="平均停留（缺可靠時間戳顯示 —）">
          平均停留 {row.dwellLabel}
        </span>
      </div>
      {row.sub ? <p className="dash-todo-sub">{row.sub}</p> : null}
    </Link>
  );
}
