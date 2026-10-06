"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildSchedulePreview,
  defaultScheduleStartDate,
  shortScheduleDate
} from "@/lib/drafts/publishSchedulePreview";
import styles from "./SchedulePublishPlanner.module.css";

const WEEKDAYS = [
  { key: 1, label: "一" },
  { key: 2, label: "二" },
  { key: 3, label: "三" },
  { key: 4, label: "四" },
  { key: 5, label: "五" },
  { key: 6, label: "六" },
  { key: 0, label: "日" }
] as const;

export type SchedulePlannerValue = {
  startDate: string;
  dailyLimit: number;
  activeWeekdays: number[];
  finishDate: string | null;
  dayCount: number;
};

export function SchedulePublishPlanner({
  draftCount,
  compact = false,
  bannerText = "TEST · 只建立排程資料，不碰 Shopify",
  onChange
}: {
  draftCount: number;
  compact?: boolean;
  bannerText?: string;
  onChange?: (value: SchedulePlannerValue) => void;
}) {
  const [startDate, setStartDate] = useState(defaultScheduleStartDate);
  const [dailyLimit, setDailyLimit] = useState(20);
  const [weekdays, setWeekdays] = useState<Set<number>>(
    () => new Set(WEEKDAYS.map((day) => day.key))
  );

  const activeWeekdays = useMemo(
    () => [...weekdays].sort((a, b) => a - b),
    [weekdays]
  );

  const preview = useMemo(
    () =>
      buildSchedulePreview({
        total: draftCount,
        dailyLimit,
        startDate,
        activeWeekdays
      }),
    [activeWeekdays, draftCount, dailyLimit, startDate]
  );

  useEffect(() => {
    onChange?.({
      startDate,
      dailyLimit,
      activeWeekdays,
      finishDate: preview.finishDate,
      dayCount: preview.days.length
    });
  }, [activeWeekdays, dailyLimit, onChange, preview.days.length, preview.finishDate, startDate]);

  function toggleWeekday(day: number) {
    setWeekdays((current) => {
      const next = new Set(current);
      if (next.has(day)) {
        if (next.size === 1) return current;
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  return (
    <section className={compact ? styles.compact : styles.planner} aria-label="排程上架預覽">
      <div className={styles.previewFlag}>{bannerText}</div>

      <div className={styles.controls}>
        <label className={styles.field}>
          <span>開始日期</span>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>每日上架</span>
          <div className={styles.numberWrap}>
            <input
              type="number"
              min={1}
              max={200}
              value={dailyLimit}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) setDailyLimit(Math.min(200, Math.max(1, next)));
              }}
            />
            <span>件／天</span>
          </div>
        </label>

        <div className={styles.field}>
          <span>上架日</span>
          <div className={styles.weekdays}>
            {WEEKDAYS.map((day) => (
              <button
                key={day.key}
                className={weekdays.has(day.key) ? styles.dayActive : styles.day}
                type="button"
                aria-pressed={weekdays.has(day.key)}
                onClick={() => toggleWeekday(day.key)}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.summary}>
        <div>
          <span className={styles.summaryLabel}>已選</span>
          <strong>{draftCount} 件</strong>
        </div>
        <div>
          <span className={styles.summaryLabel}>預計</span>
          <strong>{preview.days.length} 個上架日</strong>
        </div>
        <div>
          <span className={styles.summaryLabel}>完成</span>
          <strong>{preview.finishDate ? shortScheduleDate(preview.finishDate) : "—"}</strong>
        </div>
        <div>
          <span className={styles.summaryLabel}>時區</span>
          <strong>台北 GMT+8</strong>
        </div>
      </div>

      <div className={styles.timeline}>
        {preview.days.length === 0 ? (
          <p className={styles.empty}>請至少保留一個上架日。</p>
        ) : (
          preview.days.slice(0, compact ? 6 : 10).map((day, index) => (
            <div className={styles.timelineRow} key={day.date}>
              <span className={styles.timelineIndex}>{index + 1}</span>
              <span className={styles.timelineDate}>{shortScheduleDate(day.date)}</span>
              <span className={styles.timelineCount}>{day.count} 件</span>
              <span className={styles.timelineRange}>
                第 {day.startIndex}–{day.endIndex} 件
              </span>
            </div>
          ))
        )}
        {preview.days.length > (compact ? 6 : 10) ? (
          <p className={styles.more}>後面還有 {preview.days.length - (compact ? 6 : 10)} 個上架日</p>
        ) : null}
      </div>

      <div className={styles.safety}>
        <strong>目前安全規則：</strong>
        這個環境只建立排程資料；Shopify DRAFT／ACTIVE 安全鎖預設關閉。未來放行後仍會在執行前檢查 dirty／conflict，單件失敗也不阻斷其他商品。
      </div>
    </section>
  );
}
