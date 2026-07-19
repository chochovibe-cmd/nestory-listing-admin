/**
 * BX2: 10s undo helpers for 核准／標圖分流／封存.
 * Uses existing return-stage + batch archive APIs (no new routes).
 */

export type UndoKind = "approve" | "station2" | "archive";

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
          comment: "10秒內復原核准"
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
          comment: "10秒內復原標圖分流"
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
