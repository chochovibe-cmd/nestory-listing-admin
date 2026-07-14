"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { isAdmin } from "@/lib/auth/roles";
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

/**
 * E1-open: dashboard 今日待辦卡（session + RLS）.
 * Q3-A admin 預設我的；operator 只看自己；0 件仍顯示四卡。
 */
export function DashboardTodoPanel() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [scope, setScope] = useState<ScopeMode>("mine");
  const [rows, setRows] = useState<TodoDraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const admin = isAdmin(role);

  const load = useCallback(async () => {
    if (!hasSupabaseBrowserEnv()) {
      setError("需要設定 Supabase 才能使用儀表板");
      setRows([]);
      setLoading(false);
      setRoleReady(true);
      return;
    }

    setLoading(true);
    setError(null);

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
        setError(draftError.message);
        setRows([]);
        return;
      }

      setRows((data ?? []) as TodoDraftRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => countTodoBuckets(rows, TODO_FETCH_LIMIT), [rows]);
  const cards = useMemo(() => buildTodoCards(counts), [counts]);
  const truncNote = useMemo(() => todoTruncationNotice(counts), [counts]);

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

  return (
    <main className="container">
      <div className="dash-page">
        <div className="ir-page-header dash-header">
          <div className="ir-title-row">
            <h1>📈 儀表板</h1>
            <span className="ir-sub">初版 · 待辦優先 · GSC／銷售後期接</span>
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

        <section className="panel dash-todo-panel" aria-labelledby="dash-todo-title">
          <div className="panel-header">
            <h2 id="dash-todo-title">今日待辦</h2>
            <span className="dash-todo-hint">積壓待辦 · 不限今天</span>
          </div>
          <div className="panel-body dash-todo-body">
            {loading ? (
              <p className="dash-todo-status">載入中…</p>
            ) : error ? (
              <p className="dash-todo-status dash-todo-error" role="alert">
                {error}
              </p>
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

        <p className="dash-later-note">
          上架數／流程漏斗／成本明細／AI 顧問 → 後續版本（E2–E6）
        </p>
      </div>
    </main>
  );
}
