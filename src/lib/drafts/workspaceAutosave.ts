/**
 * B13: form autosave to localStorage (debounce at call site).
 *
 * Known limitation (by design, not a bug): when the same browser has multiple
 * tabs open on 新增商品, the last write wins. Single-operator workflow is fine.
 *
 * Continuous listing (light reset) clears this key after successful generate so
 * a refresh does not re-prompt restore with the previous item's title.
 */

export const WORKSPACE_AUTOSAVE_KEY = "nestory:workspace-draft-v1";
export const WORKSPACE_AUTOSAVE_VERSION = 1;
/** Snapshots older than this are discarded without showing the restore bar. */
export const WORKSPACE_AUTOSAVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type WorkspaceAutosaveSnapshot = {
  version: number;
  savedAt: string; // ISO
  draftId: string | null;
  title: string;
  source: string;
  price: string;
  costCurrency: string;
  taobaoUrl: string;
  note: string;
  specText: string;
  /** D10: multi-line YouTube URLs (one per line); optional. */
  videoUrlsText: string;
  saleStatus: string;
  inventoryUnlimited: boolean;
  inventoryQuantity: string;
  inventoryOpen: boolean;
  tone: string;
  copyLength: string;
  useWebSearch: boolean;
  priceMode: string;
  manualPricingEnabled: boolean;
  manualCompareAtPrice: string;
  manualSellPrice: string;
  profitDriven: boolean;
  targetProfitInput: string;
  variantDimensions: Array<{ name: string }>;
  variants: Array<{
    optionValues: [string, string, string];
    cost: string;
    sellPrice: string;
    compareAt: string;
    priceLocked: boolean;
    qty: string;
    sku: string;
    imageId: string | null;
    sortOrder: number;
  }>;
};

export type WorkspaceAutosaveLoadResult =
  | { kind: "empty" }
  | { kind: "expired"; cleared: true }
  | { kind: "invalid"; cleared: true }
  | { kind: "ready"; snapshot: WorkspaceAutosaveSnapshot };

/** True when there is something worth restoring (not an empty form shell). */
export function shouldPersistWorkspaceAutosave(
  input: Pick<
    WorkspaceAutosaveSnapshot,
    | "draftId"
    | "title"
    | "price"
    | "taobaoUrl"
    | "note"
    | "specText"
    | "videoUrlsText"
    | "variants"
    | "manualSellPrice"
    | "manualCompareAtPrice"
    | "targetProfitInput"
  >
): boolean {
  if (input.draftId) return true;
  if (input.title.trim()) return true;
  if (input.price.trim()) return true;
  if (input.taobaoUrl.trim()) return true;
  if (input.note.trim()) return true;
  if (input.specText.trim()) return true;
  if ((input.videoUrlsText ?? "").trim()) return true;
  if (input.manualSellPrice.trim() || input.manualCompareAtPrice.trim()) return true;
  if (input.targetProfitInput.trim()) return true;
  if (input.variants.some((row) => row.optionValues.some((v) => v.trim()) || row.cost.trim())) {
    return true;
  }
  return false;
}

export function isWorkspaceAutosaveExpired(
  savedAt: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = WORKSPACE_AUTOSAVE_MAX_AGE_MS
): boolean {
  const t = Date.parse(savedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > maxAgeMs;
}

/**
 * Human-readable age for the restore bar, from real savedAt.
 * e.g. 「約 3 分鐘前」「約 2 小時前」「約 1 天前」
 */
export function formatAutosaveAgeLabel(
  savedAt: string,
  nowMs: number = Date.now()
): string {
  const t = Date.parse(savedAt);
  if (Number.isNaN(t)) return "稍早";
  const diffMs = Math.max(0, nowMs - t);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `約 ${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `約 ${hours} 小時前`;
  const days = Math.floor(hours / 24);
  return `約 ${days} 天前`;
}

export function parseWorkspaceAutosave(raw: string | null): WorkspaceAutosaveSnapshot | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<WorkspaceAutosaveSnapshot>;
    if (!data || data.version !== WORKSPACE_AUTOSAVE_VERSION) return null;
    if (typeof data.savedAt !== "string" || !data.savedAt) return null;
    if (typeof data.title !== "string") return null;
    return data as WorkspaceAutosaveSnapshot;
  } catch {
    return null;
  }
}

export function buildWorkspaceAutosaveSnapshot(
  fields: Omit<WorkspaceAutosaveSnapshot, "version" | "savedAt">,
  savedAt: string = new Date().toISOString()
): WorkspaceAutosaveSnapshot {
  return {
    version: WORKSPACE_AUTOSAVE_VERSION,
    savedAt,
    ...fields
  };
}

/**
 * Normalize a loaded snapshot into plain form field values.
 * Used by restore so UI always applies the same shape localStorage wrote
 * (defensive against partial / older keys).
 */
export function formFieldsFromAutosaveSnapshot(snap: WorkspaceAutosaveSnapshot): {
  draftId: string | null;
  title: string;
  source: string;
  price: string;
  costCurrency: string;
  taobaoUrl: string;
  note: string;
  specText: string;
  videoUrlsText: string;
  saleStatus: string;
  inventoryUnlimited: boolean;
  inventoryQuantity: string;
  inventoryOpen: boolean;
  tone: string;
  copyLength: string;
  useWebSearch: boolean;
  priceMode: string;
  manualPricingEnabled: boolean;
  manualCompareAtPrice: string;
  manualSellPrice: string;
  profitDriven: boolean;
  targetProfitInput: string;
  variantDimensions: Array<{ name: string }>;
  variants: WorkspaceAutosaveSnapshot["variants"];
} {
  return {
    draftId: typeof snap.draftId === "string" && snap.draftId ? snap.draftId : null,
    title: typeof snap.title === "string" ? snap.title : "",
    source: typeof snap.source === "string" ? snap.source : "",
    price: typeof snap.price === "string" ? snap.price : snap.price != null ? String(snap.price) : "",
    costCurrency: snap.costCurrency === "TWD" ? "TWD" : "CNY",
    taobaoUrl: typeof snap.taobaoUrl === "string" ? snap.taobaoUrl : "",
    note: typeof snap.note === "string" ? snap.note : "",
    specText: typeof snap.specText === "string" ? snap.specText : "",
    videoUrlsText: typeof snap.videoUrlsText === "string" ? snap.videoUrlsText : "",
    saleStatus: typeof snap.saleStatus === "string" ? snap.saleStatus : "",
    inventoryUnlimited: snap.inventoryUnlimited !== false,
    inventoryQuantity: typeof snap.inventoryQuantity === "string" ? snap.inventoryQuantity : "",
    inventoryOpen: Boolean(snap.inventoryOpen),
    tone: typeof snap.tone === "string" ? snap.tone : "",
    copyLength: typeof snap.copyLength === "string" ? snap.copyLength : "標準",
    useWebSearch: snap.useWebSearch !== false,
    priceMode: snap.priceMode === "single" ? "single" : "sale",
    manualPricingEnabled: Boolean(snap.manualPricingEnabled),
    manualCompareAtPrice:
      typeof snap.manualCompareAtPrice === "string" ? snap.manualCompareAtPrice : "",
    manualSellPrice: typeof snap.manualSellPrice === "string" ? snap.manualSellPrice : "",
    profitDriven: Boolean(snap.profitDriven),
    targetProfitInput: typeof snap.targetProfitInput === "string" ? snap.targetProfitInput : "",
    variantDimensions: Array.isArray(snap.variantDimensions)
      ? snap.variantDimensions.map((d) => ({ name: String(d?.name ?? "") }))
      : [],
    variants: Array.isArray(snap.variants)
      ? snap.variants.map((row, i) => ({
          optionValues: [
            String(row?.optionValues?.[0] ?? ""),
            String(row?.optionValues?.[1] ?? ""),
            String(row?.optionValues?.[2] ?? "")
          ] as [string, string, string],
          cost: String(row?.cost ?? ""),
          sellPrice: String(row?.sellPrice ?? ""),
          compareAt: String(row?.compareAt ?? ""),
          priceLocked: Boolean(row?.priceLocked),
          qty: String(row?.qty ?? ""),
          sku: String(row?.sku ?? ""),
          imageId: row?.imageId ?? null,
          sortOrder: typeof row?.sortOrder === "number" ? row.sortOrder : i
        }))
      : []
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadWorkspaceAutosave(
  storage: StorageLike | null,
  nowMs: number = Date.now()
): WorkspaceAutosaveLoadResult {
  if (!storage) return { kind: "empty" };
  let raw: string | null;
  try {
    raw = storage.getItem(WORKSPACE_AUTOSAVE_KEY);
  } catch {
    return { kind: "empty" };
  }
  if (!raw) return { kind: "empty" };
  const snapshot = parseWorkspaceAutosave(raw);
  if (!snapshot) {
    try {
      storage.removeItem(WORKSPACE_AUTOSAVE_KEY);
    } catch {
      /* ignore */
    }
    return { kind: "invalid", cleared: true };
  }
  if (isWorkspaceAutosaveExpired(snapshot.savedAt, nowMs)) {
    try {
      storage.removeItem(WORKSPACE_AUTOSAVE_KEY);
    } catch {
      /* ignore */
    }
    return { kind: "expired", cleared: true };
  }
  if (!shouldPersistWorkspaceAutosave(snapshot)) {
    try {
      storage.removeItem(WORKSPACE_AUTOSAVE_KEY);
    } catch {
      /* ignore */
    }
    return { kind: "empty" };
  }
  return { kind: "ready", snapshot };
}

export function writeWorkspaceAutosave(
  storage: StorageLike | null,
  snapshot: WorkspaceAutosaveSnapshot
): void {
  if (!storage) return;
  if (!shouldPersistWorkspaceAutosave(snapshot)) {
    clearWorkspaceAutosave(storage);
    return;
  }
  try {
    storage.setItem(WORKSPACE_AUTOSAVE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function clearWorkspaceAutosave(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(WORKSPACE_AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}
