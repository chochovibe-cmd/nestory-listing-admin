/**
 * D7-open / C5 skeleton: pure helpers for 發布紀錄 page (no DB secrets).
 */

import {
  MIGRATION_027_HINT,
  isMissingPublishBatchesError,
  publishBatchTitle,
  shortBatchId
} from "@/lib/drafts/publishBatch";
import type {
  PublishBatch,
  PublishBatchItem,
  PublishBatchItemStatus,
  PublishBatchStatus,
  PublishMode
} from "@/types/domain";

export const RECORDS_FETCH_LIMIT = 40;

export type PublishRecordsFilter = "all" | "has_failed";

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
