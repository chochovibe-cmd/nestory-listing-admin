"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { shortScheduleDate } from "@/lib/drafts/publishSchedulePreview";
import styles from "./ScheduleCenterPreview.module.css";

type ScheduleGroup = {
  id: string;
  start_date: string;
  daily_limit: number;
  timezone: string;
  active_weekdays: number[];
  status: "active" | "paused" | "completed" | "canceled";
  total_count: number;
  completed_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
};

type ScheduleItem = {
  id: string;
  group_id: string;
  draft_id: string;
  scheduled_for: string;
  position: number;
  status: "queued" | "claimed" | "blocked" | "completed" | "failed" | "canceled";
  error_message: string | null;
  publish_batch_id: string | null;
  title: string;
  pipeline_stage: string | null;
  shopify_sync_status: string | null;
  shopify_product_id: string | null;
};

type ScheduleSafety = {
  stagingEnabled: boolean;
  executionEnabled: boolean;
};

type SchedulePayload = {
  ok?: boolean;
  groups?: ScheduleGroup[];
  items?: ScheduleItem[];
  safety?: ScheduleSafety;
  error?: string;
  hint?: string;
};

function groupStatusMeta(status: ScheduleGroup["status"]) {
  if (status === "active") return { label: "排程中", className: "schip schip--run" };
  if (status === "paused") return { label: "已暫停", className: "schip schip--idle" };
  if (status === "completed") return { label: "已完成", className: "schip schip--ok" };
  return { label: "已取消", className: "schip schip--idle" };
}

function itemStatusMeta(status: ScheduleItem["status"]) {
  if (status === "completed") return { label: "已完成", className: "schip schip--ok" };
  if (status === "failed") return { label: "失敗", className: "schip schip--error" };
  if (status === "blocked") return { label: "待處理", className: "schip schip--error" };
  if (status === "claimed") return { label: "執行中", className: "schip schip--run" };
  if (status === "canceled") return { label: "已取消", className: "schip schip--idle" };
  return { label: "等待", className: "schip schip--idle" };
}

export function ScheduleCenterPreview() {
  const [groups, setGroups] = useState<ScheduleGroup[]>([]);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [safety, setSafety] = useState<ScheduleSafety>({
    stagingEnabled: false,
    executionEnabled: false
  });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelArmId, setCancelArmId] = useState<string | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [dryRunMessage, setDryRunMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/publish-schedules", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as SchedulePayload;
      if (!response.ok) {
        setError([payload.error, payload.hint].filter(Boolean).join(" — ") || "排程載入失敗");
        setGroups([]);
        setItems([]);
        return;
      }
      setGroups(payload.groups ?? []);
      setItems(payload.items ?? []);
      setSafety(payload.safety ?? { stagingEnabled: false, executionEnabled: false });
    } catch {
      setError("排程載入連線失敗");
      setGroups([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const itemsByGroup = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const item of items) {
      const list = map.get(item.group_id) ?? [];
      list.push(item);
      map.set(item.group_id, list);
    }
    return map;
  }, [items]);

  const summary = useMemo(() => {
    const active = groups.filter((group) => group.status === "active").length;
    const queued = items.filter((item) => item.status === "queued").length;
    const blocked = items.filter(
      (item) => item.status === "blocked" || item.status === "failed"
    ).length;
    const next = items
      .filter((item) => item.status === "queued")
      .map((item) => item.scheduled_for)
      .sort()[0] ?? null;
    return { active, queued, blocked, next };
  }, [groups, items]);

  async function mutate(
    groupId: string,
    action: "pause" | "resume" | "cancel" | "retry_blocked"
  ) {
    if (busyId) return;
    if (action === "cancel" && cancelArmId !== groupId) {
      setCancelArmId(groupId);
      return;
    }

    setBusyId(groupId);
    setCancelArmId(null);
    try {
      const response = await fetch(`/api/publish-schedules/${encodeURIComponent(groupId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error ?? "排程操作失敗", "error");
        return;
      }

      const label =
        action === "pause"
          ? "已暫停排程"
          : action === "resume"
            ? "已恢復排程"
            : action === "cancel"
              ? "已取消排程"
              : `已重新排入 ${payload.retried ?? 0} 件`;
      showToast(label, "success");
      await load();
    } catch {
      showToast("排程操作連線失敗", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function runDryRun() {
    if (dryRunBusy) return;
    setDryRunBusy(true);
    setDryRunMessage(null);
    try {
      const response = await fetch("/api/publish-schedules/dry-run", {
        cache: "no-store"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload.error ?? payload.hint ?? "Dry-run 檢查失敗";
        setDryRunMessage(message);
        showToast(message, "error");
        return;
      }
      const dueCount = Number(payload.dueCount ?? 0);
      const message =
        dueCount > 0
          ? `Dry-run：今天理論上會處理 ${dueCount} 件；本次沒有 claim，也沒有 Shopify write。`
          : "Dry-run：今天目前沒有到期排程；沒有 claim，也沒有 Shopify write。";
      setDryRunMessage(message);
      showToast(message, "info");
    } catch {
      setDryRunMessage("Dry-run 檢查連線失敗");
      showToast("Dry-run 檢查連線失敗", "error");
    } finally {
      setDryRunBusy(false);
    }
  }

  const safetySafe = !safety.stagingEnabled && !safety.executionEnabled;

  return (
    <section className={styles.wrap} aria-labelledby="schedule-center-title">
      <div className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>TEST DATA · SAFE MODE</span>
          <h2 id="schedule-center-title">📅 智慧排程上架</h2>
          <p>
            排程資料現在已接 test DB；Shopify 是否能被寫入，仍由兩個獨立安全鎖控制。
          </p>
        </div>
        <div className={styles.heroActions}>
          <Button
            size="sm"
            onClick={() => void runDryRun()}
            disabled={dryRunBusy || safety.executionEnabled}
            type="button"
          >
            {dryRunBusy ? "檢查中…" : "Dry-run 今日排程"}
          </Button>
          <Button size="sm" onClick={() => void load()} disabled={loading} type="button">
            ↻ 重新整理
          </Button>
          <Link className="nb-btn nb-btn--primary nb-btn--sm" href="/drafts/new?pane=results">
            去完成待發布選商品
          </Link>
        </div>
      </div>

      <div className={safetySafe ? styles.safetyOk : styles.safetyWarn}>
        <strong>{safetySafe ? "安全鎖正常" : "⚠ 有 Shopify 安全鎖已開啟"}</strong>
        <span>Shopify DRAFT：{safety.stagingEnabled ? "ON" : "OFF"}</span>
        <span>Shopify ACTIVE：{safety.executionEnabled ? "ON" : "OFF"}</span>
        <span>Cron：{safety.executionEnabled ? "可執行" : "DRY-RUN"}</span>
      </div>

      {dryRunMessage ? (
        <div className="notice" role="status">
          {dryRunMessage}
        </div>
      ) : null}

      <div className={styles.summary}>
        <div>
          <span>排程中</span>
          <strong>{summary.active}</strong>
        </div>
        <div>
          <span>等待上架</span>
          <strong>{summary.queued}</strong>
        </div>
        <div>
          <span>待處理／失敗</span>
          <strong>{summary.blocked}</strong>
        </div>
        <div>
          <span>下一個日期</span>
          <strong>{summary.next ? shortScheduleDate(summary.next) : "—"}</strong>
        </div>
      </div>

      {loading ? <p className="muted">載入排程中…</p> : null}

      {!loading && error ? (
        <div className="notice notice-warn">
          <strong>{error}</strong>
          <p style={{ marginTop: 8 }}>
            <Button size="sm" type="button" onClick={() => void load()}>
              重試
            </Button>
          </p>
        </div>
      ) : null}

      {!loading && !error && groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <p className="empty-state-title">還沒有測試排程</p>
          <p className="empty-state-desc">
            到「完成待發布」勾商品 → 發布／匯出 → 排程正式上架，即可建立第一批。
          </p>
          <Link className="nb-btn nb-btn--primary" href="/drafts/new?pane=results">
            去建立第一批排程
          </Link>
        </div>
      ) : null}

      {!loading && !error && groups.length > 0 ? (
        <div className={styles.groups}>
          {groups.map((group) => {
            const groupItems = itemsByGroup.get(group.id) ?? [];
            const statusMeta = groupStatusMeta(group.status);
            const failedCount = groupItems.filter(
              (item) => item.status === "blocked" || item.status === "failed"
            ).length;
            const finishDate = groupItems
              .map((item) => item.scheduled_for)
              .sort()
              .at(-1) ?? group.start_date;
            const busy = busyId === group.id;

            return (
              <article className={styles.group} key={group.id}>
                <div className={styles.groupHead}>
                  <div>
                    <div className={styles.groupTitle}>
                      <strong>
                        {shortScheduleDate(group.start_date)} 開始 · {group.daily_limit} 件／天
                      </strong>
                      <span className={statusMeta.className}>{statusMeta.label}</span>
                    </div>
                    <p>
                      共 {group.total_count} 件 · 已完成 {group.completed_count} · 失敗 {group.failed_count}
                      {" · "}預計到 {shortScheduleDate(finishDate)}
                    </p>
                  </div>
                  <div className={styles.actions}>
                    {group.status === "active" ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void mutate(group.id, "pause")}
                        type="button"
                      >
                        暫停
                      </Button>
                    ) : null}
                    {group.status === "paused" ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void mutate(group.id, "resume")}
                        type="button"
                      >
                        恢復
                      </Button>
                    ) : null}
                    {failedCount > 0 && group.status !== "canceled" ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void mutate(group.id, "retry_blocked")}
                        type="button"
                      >
                        ↻ 重試 {failedCount}
                      </Button>
                    ) : null}
                    {group.status === "active" || group.status === "paused" ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void mutate(group.id, "cancel")}
                        type="button"
                      >
                        {cancelArmId === group.id ? "再點確認取消" : "取消排程"}
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className={styles.items}>
                  {groupItems.slice(0, 12).map((item) => {
                    const meta = itemStatusMeta(item.status);
                    return (
                      <div className={styles.item} key={item.id}>
                        <span className={styles.itemDate}>{shortScheduleDate(item.scheduled_for)}</span>
                        <span className={styles.itemTitle}>{item.title}</span>
                        {item.shopify_sync_status ? (
                          <span className={styles.sync}>sync: {item.shopify_sync_status}</span>
                        ) : null}
                        <span className={meta.className}>{meta.label}</span>
                        <Link
                          className="nb-btn nb-btn--secondary nb-btn--sm"
                          href={`/drafts/${item.draft_id}`}
                        >
                          商品
                        </Link>
                        {item.error_message ? (
                          <span className={styles.errorText}>{item.error_message}</span>
                        ) : null}
                      </div>
                    );
                  })}
                  {groupItems.length > 12 ? (
                    <p className={styles.more}>還有 {groupItems.length - 12} 件未展開</p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
