"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GENERATION_QUEUE_KICK_EVENT } from "@/components/listing/GenerationQueueRunner";

type QueueOverviewItem = {
  runId: string;
  draftId: string;
  status: "pending" | "processing" | "failed";
  title: string;
  jobKind: "full" | "regen_full" | "regen_field";
  regenField: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type QueueOverviewPayload = {
  ok?: boolean;
  counts?: {
    pending?: number;
    processing?: number;
    failed?: number;
  };
  items?: QueueOverviewItem[];
  error?: string;
};

const POLL_MS = 6_000;

function jobLabel(item: QueueOverviewItem): string {
  if (item.jobKind === "regen_field") return "單欄重生";
  if (item.jobKind === "regen_full") return "重新生成";
  return "新商品";
}

function statusLabel(status: QueueOverviewItem["status"]): string {
  if (status === "processing") return "生成中";
  if (status === "failed") return "失敗";
  return "排隊中";
}

function timeLabel(item: QueueOverviewItem): string {
  const raw = item.startedAt || item.completedAt || item.createdAt;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function statusTone(status: QueueOverviewItem["status"]): string {
  if (status === "processing") return "var(--lime, #b7f34a)";
  if (status === "failed") return "#ffe7e7";
  return "#f3f0e8";
}

/**
 * OBS-QUEUE: read-only status center backed by generation_runs.
 * It does not claim, retry, cancel, or otherwise mutate queue jobs.
 */
export function GenerationQueueOverview() {
  const [payload, setPayload] = useState<QueueOverviewPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/generation-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "overview" }),
        cache: "no-store"
      });
      const next = (await response.json().catch(() => ({}))) as QueueOverviewPayload;
      if (!response.ok) {
        setLoadError(typeof next.error === "string" ? next.error : "佇列狀態讀取失敗");
        return;
      }
      setPayload(next);
      setLoadError(null);
    } catch {
      setLoadError("佇列狀態讀取失敗");
    }
  }, []);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);

    const onKick = () => {
      void refresh();
    };
    window.addEventListener(GENERATION_QUEUE_KICK_EVENT, onKick);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(GENERATION_QUEUE_KICK_EVENT, onKick);
    };
  }, [refresh]);

  const items = payload?.items ?? [];
  const counts = {
    pending: payload?.counts?.pending ?? 0,
    processing: payload?.counts?.processing ?? 0,
    failed: payload?.counts?.failed ?? 0
  };
  const visibleItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const rank = { processing: 0, pending: 1, failed: 2 } as const;
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      }),
    [items]
  );

  return (
    <section className="panel queue-strip" aria-label="生成排隊狀態">
      <div className="queue-strip-head">
        <span className="qtitle">生成排隊狀態</span>
        <span className="queue-hint">從資料庫即時還原</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 8,
          marginBottom: 10
        }}
      >
        {[
          ["排隊中", counts.pending],
          ["生成中", counts.processing],
          ["失敗", counts.failed]
        ].map(([label, count]) => (
          <div
            key={String(label)}
            style={{
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 10,
              padding: "9px 10px",
              minWidth: 0
            }}
          >
            <div className="muted" style={{ fontSize: 11 }}>
              {label}
            </div>
            <strong style={{ fontSize: 18 }}>{count}</strong>
          </div>
        ))}
      </div>

      {loadError ? (
        <div className="price-soft-warn" role="status">
          {loadError}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          目前沒有排隊、生成中或尚未處理的失敗工作。
        </div>
      ) : (
        <div style={{ display: "grid", gap: 7 }}>
          {visibleItems.map((item) => (
            <div
              key={item.runId}
              style={{
                display: "grid",
                gap: 4,
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 10,
                padding: "9px 10px",
                background: statusTone(item.status)
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8
                }}
              >
                <strong
                  title={item.title}
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {item.title}
                </strong>
                <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                  {statusLabel(item.status)}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {jobLabel(item)}
                {timeLabel(item) ? ` · ${timeLabel(item)}` : ""}
              </div>
              {item.status === "failed" && item.error ? (
                <div
                  className="price-soft-warn"
                  title={item.error}
                  style={{
                    fontSize: 11,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {item.error}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
