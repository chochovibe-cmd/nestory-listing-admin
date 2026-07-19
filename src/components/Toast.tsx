"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TOAST_EVENT,
  toastActionCallbacks,
  type ToastDetail,
  type ToastVariant
} from "@/lib/toast/toastEvents";

let seq = 0;

export type ShowToastOptions = {
  /** BX2: action button label (e.g. 復原) */
  actionLabel?: string;
  /** Called when action is pressed; toast dismisses after. */
  onAction?: () => void | Promise<void>;
};

/**
 * Fire-and-forget toast. Call from any client component / event handler:
 *   showToast("已儲存此版本組合", "success");
 *   showToast("上傳失敗，請重試", "error");
 *   showToast("有 2 件缺重量欄位，已略過", "warn");
 *   showToast("已核准 3 筆", "success", 10000, { actionLabel: "復原", onAction: ... });
 * Falls back to a no-op on the server (safe to call from shared helpers).
 */
export function showToast(
  message: string,
  variant: ToastVariant = "info",
  duration = 3200,
  options?: ShowToastOptions
) {
  if (typeof window === "undefined") return;
  const id = `t${Date.now()}-${seq++}`;
  if (options?.onAction && options.actionLabel) {
    toastActionCallbacks.set(id, options.onAction);
  }
  const detail: ToastDetail = {
    id,
    message,
    variant,
    duration,
    actionLabel: options?.actionLabel
  };
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }));
}

const ICON: Record<ToastVariant, string> = {
  success: "✓",
  error: "✕",
  warn: "⚠",
  info: "ℹ"
};

const LABEL: Record<ToastVariant, string> = {
  success: "成功",
  error: "錯誤",
  warn: "注意",
  info: "提示"
};

/** Mount once in RootLayout, alongside <MobileTabbar/>. */
export function ToastHost() {
  const [items, setItems] = useState<ToastDetail[]>([]);
  const timers = useRef(new Map<string, number>());

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    toastActionCallbacks.delete(id);
  }, []);

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail) return;
      setItems((prev) => [...prev, detail]);
      if (detail.duration > 0) {
        const timer = window.setTimeout(() => remove(detail.id), detail.duration);
        timers.current.set(detail.id, timer);
      }
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [remove]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => window.clearTimeout(timer));
      map.clear();
      toastActionCallbacks.clear();
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div aria-atomic="false" aria-live="polite" className="toast-host">
      {items.map((t) => (
        <div className={`toast toast--${t.variant}`} key={t.id} role="status">
          <button
            className="toast-main"
            onClick={() => remove(t.id)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                remove(t.id);
              }
            }}
            type="button"
          >
            <span aria-hidden className="toast-ic">
              {ICON[t.variant]}
            </span>
            <span className="sr-only">{LABEL[t.variant]}：</span>
            <span className="toast-msg">{t.message}</span>
          </button>
          {t.actionLabel ? (
            <button
              className="toast-action"
              onClick={() => {
                const cb = toastActionCallbacks.get(t.id);
                remove(t.id);
                if (cb) void Promise.resolve(cb());
              }}
              type="button"
            >
              {t.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
