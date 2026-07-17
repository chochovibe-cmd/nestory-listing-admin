/**
 * UX-F T29: workbench → 生圖工廠 bridge (client-only classify).
 * Reuses imageReview queue kinds; no ETA, no new API.
 */

import {
  classifyReviewQueueItem,
  pickReviewThumbUrl,
  reviewDisplayTitle,
  type ImageReviewQueueKind,
} from "@/lib/images/imageReview";
import type { ProductDraft, ProductImage } from "@/types/domain";

export type FactoryBridgeKind = ImageReviewQueueKind;

export type FactoryBridgeItem = {
  draftId: string;
  kind: FactoryBridgeKind;
  title: string;
  thumbUrl: string | null;
};

export type FactoryBridgeSummary = {
  processing: number;
  pendingReview: number;
  failed: number;
  items: FactoryBridgeItem[];
};

const KIND_ORDER: Record<FactoryBridgeKind, number> = {
  failed: 0,
  pending_review: 1,
  processing: 2,
};

export function factoryBridgeChipMeta(kind: FactoryBridgeKind): {
  className: string;
  label: string;
} {
  if (kind === "processing") {
    return { className: "schip schip--run", label: "排隊中" };
  }
  if (kind === "failed") {
    return { className: "schip schip--error", label: "失敗" };
  }
  return { className: "schip schip--warn", label: "待驗" };
}

/** Build CTA / mini-card href. section=pending only when supported. */
export function factoryBridgeHref(kind?: FactoryBridgeKind | null, draftId?: string): string {
  const hash = draftId ? `#ir-card-${draftId}` : "";
  if (kind === "pending_review") {
    return `/review?section=pending${hash}`;
  }
  return `/review${hash}`;
}

/**
 * Summarize workbench drafts that are truly enrolled in the image pipeline.
 * N=M=K=0 → empty items (caller hides strip).
 */
export function buildFactoryBridgeSummary(
  drafts: Array<
    Pick<
      ProductDraft,
      | "id"
      | "status"
      | "image_status"
      | "image_flags"
      | "current_image_batch_id"
      | "title_zh"
      | "taobao_title"
      | "original_title"
    >
  >,
  imagesByDraft: Map<string, ProductImage[]>
): FactoryBridgeSummary {
  const items: FactoryBridgeItem[] = [];
  let processing = 0;
  let pendingReview = 0;
  let failed = 0;

  for (const draft of drafts) {
    if (draft.status === "archived") continue;
    const kind = classifyReviewQueueItem({
      status: draft.status,
      image_status: draft.image_status,
      image_flags: draft.image_flags,
      current_image_batch_id: draft.current_image_batch_id,
    });
    if (!kind) continue;

    if (kind === "processing") processing += 1;
    else if (kind === "failed") failed += 1;
    else pendingReview += 1;

    const images = imagesByDraft.get(draft.id) ?? [];
    items.push({
      draftId: draft.id,
      kind,
      title: reviewDisplayTitle(draft),
      thumbUrl: pickReviewThumbUrl(images),
    });
  }

  items.sort((a, b) => {
    const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (ko !== 0) return ko;
    return a.title.localeCompare(b.title, "zh-Hant");
  });

  return { processing, pendingReview, failed, items };
}

/** Human summary line:「排隊 1 · 待驗 2 · 失敗 1」— omit zero segments. */
export function formatFactoryBridgeSummaryLine(summary: FactoryBridgeSummary): string {
  const parts: string[] = [];
  if (summary.processing > 0) parts.push(`排隊 ${summary.processing}`);
  if (summary.pendingReview > 0) parts.push(`待驗 ${summary.pendingReview}`);
  if (summary.failed > 0) parts.push(`失敗 ${summary.failed}`);
  return parts.join(" · ");
}
