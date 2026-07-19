/**
 * BX2 + UX-BTN S1: undo helpers for 核准／標圖分流／封存.
 * Uses existing return-stage + batch archive APIs (no new routes).
 *
 * Toast 顯示秒數依動作嚴重度分級（見 UNDO_TOAST_MS）——
 * 可乾淨復原的維持 10s；送工廠為 best-effort，多給一點時間按「復原」。
 * 真正發布到 Shopify 不提供 toast 復原（走站③二次確認／modal）。
 */

export type UndoKind = "approve" | "station2" | "archive";

/**
 * Undo toast 自動消失毫秒數（嚴重度分級）。
 * 卡內「封存復原」倒數也必須用同一組數字，避免 toast 還在但卡內已過期。
 */
export const UNDO_TOAST_MS = {
  /** 核准文案 → 可乾淨 return-stage */
  approve: 10_000,
  /** 軟封存 → 可乾淨 unarchive */
  archive: 10_000,
  /** 標圖 → 待發布（全 keep） */
  station2Ready: 10_000,
  /** 送生圖工廠 — best-effort；多 5 秒給人按復原 */
  station2Factory: 15_000
} as const;

export type UndoToastKind = keyof typeof UNDO_TOAST_MS;

export function undoToastDuration(kind: UndoToastKind): number {
  return UNDO_TOAST_MS[kind];
}

/** Undo copy approve → back to 站① (needs_revision / copy_review). */
export async function undoApproveDrafts(draftIds: string[]): Promise<{
  ok: boolean;
  message: string;
}> {
  const ids = uniqueIds(draftIds);
  if (!ids.length) return { ok: false, message: "沒有可復原的草稿" };
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      const res = await fetch(`/api/drafts/${id}/return-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "copy_review",
          comment: "Toast 復原核准"
        })
      });
      if (res.ok) ok += 1;
      else fail += 1;
    } catch {
      fail += 1;
    }
  }
  if (ok === 0) return { ok: false, message: "復原核准失敗" };
  return {
    ok: true,
    message:
      fail > 0
        ? `已復原 ${ok} 筆核准（${fail} 筆失敗）→ 回審文案`
        : `已復原 ${ok} 筆核准 → 回審文案`
  };
}

/**
 * Undo 站② 分流（待發布／送工廠）→ back to image_review.
 * Best-effort: 若工廠已深處理，卡片會回標圖站但佇列可能仍殘留。
 */
export async function undoStation2Drafts(draftIds: string[]): Promise<{
  ok: boolean;
  message: string;
}> {
  const ids = uniqueIds(draftIds);
  if (!ids.length) return { ok: false, message: "沒有可復原的草稿" };
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      const res = await fetch(`/api/drafts/${id}/return-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "image_review",
          comment: "Toast 復原標圖分流"
        })
      });
      if (res.ok) ok += 1;
      else fail += 1;
    } catch {
      fail += 1;
    }
  }
  if (ok === 0) return { ok: false, message: "復原標圖分流失敗" };
  return {
    ok: true,
    message:
      fail > 0
        ? `已復原 ${ok} 筆分流（${fail} 筆失敗）→ 回標圖`
        : `已復原 ${ok} 筆分流 → 回標圖`
  };
}

/** Undo soft-archive via existing batch archive API. */
export async function undoArchiveDrafts(draftIds: string[]): Promise<{
  ok: boolean;
  message: string;
}> {
  const ids = uniqueIds(draftIds);
  if (!ids.length) return { ok: false, message: "沒有可復原的草稿" };
  try {
    const res = await fetch("/api/drafts/batch/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds: ids, action: "unarchive" })
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      restoredCount?: number;
    };
    if (!res.ok) {
      return { ok: false, message: payload.error ?? "解除封存失敗" };
    }
    return {
      ok: true,
      message:
        typeof payload.message === "string"
          ? payload.message
          : `已復原封存 ${payload.restoredCount ?? ids.length} 筆`
    };
  } catch {
    return { ok: false, message: "復原封存連線失敗" };
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
}
