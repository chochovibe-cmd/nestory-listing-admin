"use client";

/** UX-AF T146: brand-aligned global error boundary (App Router error.tsx). */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="empty-state" style={{ padding: "48px 24px" }}>
      <div className="empty-icon" aria-hidden>
        ⚠️
      </div>
      <p className="empty-state-title">發生了預期外的錯誤</p>
      <p className="empty-state-desc">
        {error.message || "系統暫時無法處理這個請求"}
      </p>
      <button className="button" onClick={() => reset()} type="button">
        重新載入
      </button>
    </div>
  );
}
