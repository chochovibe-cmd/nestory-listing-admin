/**
 * R3 station③: multi-select publish/export prefs + leave-queue rules (pure).
 */

export type Station3ShopifyChoice = "none" | "draft" | "active";

export type Station3PublishSelection = {
  shopify: Station3ShopifyChoice;
  matrixify: boolean;
  showmore: boolean;
};

export const STATION3_PREFS_KEY = "nestory_station3_publish_prefs";

export const DEFAULT_STATION3_SELECTION: Station3PublishSelection = {
  shopify: "draft",
  matrixify: false,
  showmore: false
};

export function countSelectedActions(sel: Station3PublishSelection): number {
  let n = 0;
  if (sel.shopify !== "none") n += 1;
  if (sel.matrixify) n += 1;
  if (sel.showmore) n += 1;
  return n;
}

export function hasAnyAction(sel: Station3PublishSelection): boolean {
  return countSelectedActions(sel) > 0;
}

/** Q1: only one of draft/active; CSV free combo. */
export function isValidStation3Selection(sel: Station3PublishSelection): boolean {
  if (sel.shopify !== "none" && sel.shopify !== "draft" && sel.shopify !== "active") {
    return false;
  }
  return hasAnyAction(sel);
}

/**
 * Q2/Q3 leave-queue:
 * - CSV-only success → leave
 * - API success (+ optional CSV) → leave
 * - API fail (even if CSV downloaded) → stay
 */
export function shouldLeaveQueue(input: {
  selection: Station3PublishSelection;
  apiSucceeded: boolean | null;
  csvSucceeded: boolean | null;
}): boolean {
  const wantsApi = input.selection.shopify !== "none";
  const wantsCsv = input.selection.matrixify || input.selection.showmore;

  if (wantsApi) {
    if (input.apiSucceeded !== true) return false;
    if (wantsCsv && input.csvSucceeded === false) return false;
    return true;
  }
  // CSV-only
  return input.csvSucceeded === true;
}

export function formatStation3ResultMessage(input: {
  selection: Station3PublishSelection;
  apiSucceeded: boolean | null;
  apiMessage?: string;
  csvSucceeded: boolean | null;
  csvNote?: string;
  leftQueue: boolean;
}): string {
  const parts: string[] = [];
  const wantsApi = input.selection.shopify !== "none";
  const wantsCsv = input.selection.matrixify || input.selection.showmore;

  if (wantsApi) {
    if (input.apiSucceeded === true) {
      parts.push(
        input.selection.shopify === "active"
          ? "Shopify 已正式上架"
          : "Shopify 草稿已建立"
      );
    } else if (input.apiSucceeded === false) {
      parts.push(`Shopify 失敗：${input.apiMessage || "未知錯誤"}`);
    }
  }

  if (wantsCsv) {
    if (input.csvSucceeded === true) {
      parts.push(input.csvNote || "CSV 已下載");
    } else if (input.csvSucceeded === false) {
      parts.push(`CSV 失敗：${input.csvNote || "未知錯誤"}`);
    }
  }

  if (input.leftQueue) {
    parts.push("已離開工作佇列；之後可在商品庫找到。");
  } else if (wantsApi && input.apiSucceeded === false && input.csvSucceeded === true) {
    parts.push("卡片仍留在完成待發布（API 失敗；CSV 已下載可手動用）。");
  } else if (!input.leftQueue && parts.length) {
    parts.push("卡片仍在佇列。");
  }

  return parts.join(" ");
}

export function readStoredStation3Selection(): Station3PublishSelection {
  if (typeof window === "undefined") return { ...DEFAULT_STATION3_SELECTION };
  try {
    const raw = window.localStorage.getItem(STATION3_PREFS_KEY);
    if (!raw) return { ...DEFAULT_STATION3_SELECTION };
    const parsed = JSON.parse(raw) as Partial<Station3PublishSelection>;
    const shopify: Station3ShopifyChoice =
      parsed.shopify === "none" || parsed.shopify === "draft" || parsed.shopify === "active"
        ? parsed.shopify
        : DEFAULT_STATION3_SELECTION.shopify;
    return {
      shopify,
      matrixify: Boolean(parsed.matrixify),
      showmore: Boolean(parsed.showmore)
    };
  } catch {
    return { ...DEFAULT_STATION3_SELECTION };
  }
}

export function writeStoredStation3Selection(sel: Station3PublishSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATION3_PREFS_KEY, JSON.stringify(sel));
  } catch {
    // ignore quota
  }
}

/** Single-select reminder copy (回饋 36). */
export const STATION3_SINGLE_ACTION_REMINDER =
  "完成後卡片會離開佇列，要不要同時匯出其他格式？（可返回加勾 Matrixify／Showmore）";
