/**
 * D7-open / C5 skeleton + R4 §9 four-tab 發布紀錄 (no DB secrets).
 */

import {
  MIGRATION_027_HINT,
  batchProcessTagFromItems,
  isMissingPublishBatchesError,
  publishBatchTitle,
  shortBatchId,
  type PublishProcessTag
} from "@/lib/drafts/publishBatch";
import type {
  PublishBatch,
  PublishBatchItem,
  PublishBatchItemStatus,
  PublishBatchKind,
  PublishBatchStatus,
  PublishMode
} from "@/types/domain";

export const RECORDS_FETCH_LIMIT = 40;

/** R4 §9 four tabs */
export type PublishRecordsTab =
  | "batches"
  | "failed"
  | "shopify_drafts"
  | "published";

export const PUBLISH_RECORDS_TABS: {
  key: PublishRecordsTab;
  label: string;
}[] = [
  { key: "batches", label: "批次紀錄" },
  { key: "failed", label: "失敗重試" },
  { key: "shopify_drafts", label: "Shopify 草稿" },
  { key: "published", label: "已發布／封存" }
];

/** @deprecated R4 uses PublishRecordsTab; kept for verify-d7 mirrors */
export type PublishRecordsFilter = "all" | "has_failed";

/** Light archive list (tab 已發布／封存) */
export const RECORDS_PUBLISHED_LIMIT = 30;

export const RECORDS_PUBLISHED_STATUSES = [
  "active_published",
  "csv_ready",
  "archived"
] as const;

export const RECORDS_SHOPIFY_DRAFT_STATUS = "draft_created";

export type PublishBatchListRow = Pick<
  PublishBatch,
  | "id"
  | "kind"
  | "status"
  | "publish_mode"
  | "total_count"
  | "done_count"
  | "failed_count"
  | "created_by"
  | "created_at"
  | "completed_at"
  | "error_summary"
  | "snapshot_json"
>;

export type PublishBatchItemListRow = Pick<
  PublishBatchItem,
  | "id"
  | "batch_id"
  | "draft_id"
  | "item_status"
  | "error_message"
  | "shopify_product_id"
  | "shopify_admin_url"
  | "completed_at"
>;

export const PUBLISH_BATCH_SELECT =
  "id, kind, status, publish_mode, total_count, done_count, failed_count, created_by, created_at, completed_at, error_summary, snapshot_json";

export const PUBLISH_BATCH_ITEM_SELECT =
  "id, batch_id, draft_id, item_status, error_message, shopify_product_id, shopify_admin_url, completed_at";

export function recordsMigrationHintFromError(message: string | null | undefined): string | null {
  if (isMissingPublishBatchesError(message)) return MIGRATION_027_HINT;
  return null;
}

export function filterPublishBatches(
  rows: PublishBatchListRow[],
  filter: PublishRecordsFilter
): PublishBatchListRow[] {
  if (filter === "has_failed") {
    return rows.filter(
      (r) =>
        r.failed_count > 0 ||
        r.status === "failed" ||
        r.status === "partial_failed"
    );
  }
  return rows;
}

/** R4: batches tab shows all; failed tab only has_failed. */
export function filterBatchesForTab(
  rows: PublishBatchListRow[],
  tab: PublishRecordsTab
): PublishBatchListRow[] {
  if (tab === "failed") return filterPublishBatches(rows, "has_failed");
  if (tab === "batches") return rows;
  return [];
}

/** UX-N T65: client-side kind filter for 發布紀錄 batches／failed tabs. */
export type PublishRecordsKindFilter = "all" | PublishBatchKind;

export const BATCH_KIND_FILTERS: {
  key: PublishRecordsKindFilter;
  label: string;
}[] = [
  { key: "all", label: "全部" },
  { key: "shopify_api", label: "Shopify API" },
  { key: "showmore", label: "Showmore" },
  { key: "matrixify", label: "Matrixify" }
];

export function filterBatchesByKind(
  rows: PublishBatchListRow[],
  kindFilter: PublishRecordsKindFilter
): PublishBatchListRow[] {
  if (kindFilter === "all") return rows;
  return rows.filter((r) => r.kind === kindFilter);
}

export function parseRecordsTab(
  raw: string | null | undefined
): PublishRecordsTab {
  if (
    raw === "batches" ||
    raw === "failed" ||
    raw === "shopify_drafts" ||
    raw === "published"
  ) {
    return raw;
  }
  return "batches";
}

export function batchCardTitle(row: Pick<PublishBatchListRow, "publish_mode" | "kind">): string {
  const mode = (row.publish_mode === "active" ? "active" : "draft") as PublishMode;
  return publishBatchTitle(mode);
}

export function batchMetaLine(row: PublishBatchListRow, operatorLabel?: string | null): string {
  const short = shortBatchId(row.id);
  const when = formatRecordsTime(row.completed_at || row.created_at);
  const who = operatorLabel?.trim() || null;
  const count = `${row.total_count} 件`;
  return who
    ? `#${short} · ${when} · ${who} · ${count}`
    : `#${short} · ${when} · ${count}`;
}

export function formatRecordsTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch {
    return "—";
  }
}

export function batchStatusSchip(
  status: PublishBatchStatus
): { className: string; label: string } {
  switch (status) {
    case "completed":
      return { className: "schip schip--ok", label: "全部成功" };
    case "partial_failed":
      return { className: "schip schip--warn", label: "部分失敗" };
    case "failed":
      return { className: "schip schip--error", label: "失敗" };
    case "processing":
      return { className: "schip schip--run", label: "處理中" };
    case "queued":
    default:
      return { className: "schip schip--idle", label: "排隊中" };
  }
}

export function itemStatusDotClass(status: PublishBatchItemStatus): string {
  if (status === "done") return "rec-dot rec-dot--ok";
  if (status === "failed") return "rec-dot rec-dot--ng";
  if (status === "skipped") return "rec-dot rec-dot--skip";
  if (status === "processing") return "rec-dot rec-dot--run";
  return "rec-dot";
}

export function itemLineText(
  item: PublishBatchItemListRow,
  titleFromSnapshot?: string | null
): string {
  const title = (titleFromSnapshot || "未命名草稿").trim() || "未命名草稿";
  if (item.item_status === "done") {
    const idPart = item.shopify_product_id
      ? ` → Shopify ${shortShopifyId(item.shopify_product_id)}`
      : "";
    return `${title}${idPart}`;
  }
  if (item.item_status === "failed") {
    const reason = item.error_message?.trim() || "未知錯誤";
    return `${title} — ${reason}`;
  }
  if (item.item_status === "skipped") {
    return `${title} — ${item.error_message?.trim() || "已略過"}`;
  }
  return `${title}（${item.item_status}）`;
}

export function shortShopifyId(productId: string): string {
  // gid://shopify/Product/123 → #123
  const m = productId.match(/(\d+)\s*$/);
  if (m) return `#${m[1]}`;
  if (productId === "mock-product-id") return "#mock";
  return productId.length > 16 ? `${productId.slice(0, 14)}…` : productId;
}

export function snapshotTitleMap(snapshotJson: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(snapshotJson)) return map;
  for (const row of snapshotJson) {
    if (!row || typeof row !== "object") continue;
    const o = row as { draftId?: unknown; title?: unknown };
    if (typeof o.draftId === "string") {
      map.set(o.draftId, typeof o.title === "string" ? o.title : "未命名草稿");
    }
  }
  return map;
}

/** R4 Q3-A: only explicit processTag; never invent for old snapshots. */
export function snapshotProcessTagMap(
  snapshotJson: unknown
): Map<string, PublishProcessTag> {
  const map = new Map<string, PublishProcessTag>();
  if (!Array.isArray(snapshotJson)) return map;
  for (const row of snapshotJson) {
    if (!row || typeof row !== "object") continue;
    const o = row as { draftId?: unknown; processTag?: unknown };
    if (typeof o.draftId !== "string") continue;
    if (o.processTag === "含生圖" || o.processTag === "原圖直發") {
      map.set(o.draftId, o.processTag);
    }
  }
  return map;
}

/** Batch card badge; null when snapshot has no processTag (pre-R4). */
export function batchProcessTagLabel(
  snapshotJson: unknown
): PublishProcessTag | null {
  if (!Array.isArray(snapshotJson)) return null;
  const tags: Array<PublishProcessTag | null> = [];
  for (const row of snapshotJson) {
    if (!row || typeof row !== "object") continue;
    const o = row as { processTag?: unknown };
    if (o.processTag === "含生圖" || o.processTag === "原圖直發") {
      tags.push(o.processTag);
    } else {
      tags.push(null);
    }
  }
  // If every entry lacks processTag → honest null (Q3-A, no fallback)
  if (tags.length === 0 || tags.every((t) => t == null)) return null;
  return batchProcessTagFromItems(tags);
}

/** Flat failed rows for 失敗重試 tab (Q6-A). */
export type FlatFailedRecordItem = {
  batchId: string;
  batchCreatedAt: string;
  draftId: string;
  title: string;
  errorMessage: string;
  processTag: PublishProcessTag | null;
  itemId: string;
};

export function flattenFailedItems(
  batches: PublishBatchListRow[],
  itemsByBatch: Record<string, PublishBatchItemListRow[]>
): FlatFailedRecordItem[] {
  const out: FlatFailedRecordItem[] = [];
  for (const batch of batches) {
    const items = itemsByBatch[batch.id] ?? [];
    const titles = snapshotTitleMap(batch.snapshot_json);
    const tags = snapshotProcessTagMap(batch.snapshot_json);
    for (const item of items) {
      if (item.item_status !== "failed") continue;
      out.push({
        batchId: batch.id,
        batchCreatedAt: batch.created_at,
        draftId: item.draft_id,
        title: titles.get(item.draft_id) || "未命名草稿",
        errorMessage: item.error_message?.trim() || "未知錯誤",
        processTag: tags.get(item.draft_id) ?? null,
        itemId: item.id
      });
    }
  }
  out.sort((a, b) =>
    (b.batchCreatedAt || "").localeCompare(a.batchCreatedAt || "")
  );
  return out;
}

export type RecordsProductRow = {
  id: string;
  title_zh: string | null;
  taobao_title: string | null;
  original_title: string | null;
  status: string;
  category: string | null;
  ip_name: string | null;
  character_name: string | null;
  shopify_product_id: string | null;
  shopify_admin_url: string | null;
  published_at: string | null;
  updated_at: string | null;
  created_at: string;
  thumb_url?: string | null;
};

export function recordsProductTitle(row: RecordsProductRow): string {
  return (
    row.title_zh?.trim() ||
    row.taobao_title?.trim() ||
    row.original_title?.trim() ||
    "未命名"
  );
}

export function recordsProductStatusLabel(status: string): string {
  if (status === "active_published") return "已上架";
  if (status === "draft_created") return "Shopify 草稿";
  if (status === "csv_ready") return "CSV 已備妥";
  if (status === "archived") return "已封存";
  return status;
}

export const RECORDS_PRODUCT_SELECT =
  "id, title_zh, taobao_title, original_title, status, category, ip_name, character_name, shopify_product_id, shopify_admin_url, published_at, updated_at, created_at";

/** Failed draft ids for Q3 A-lite re-run (new batch). */
export function failedDraftIdsFromItems(items: PublishBatchItemListRow[]): string[] {
  return items
    .filter((i) => i.item_status === "failed")
    .map((i) => i.draft_id);
}

export function canRetryFailedBatch(row: PublishBatchListRow, items?: PublishBatchItemListRow[]): boolean {
  if (row.failed_count > 0) return true;
  if (items?.some((i) => i.item_status === "failed")) return true;
  return row.status === "failed" || row.status === "partial_failed";
}
