"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { showToast } from "@/components/Toast";
import {
  deleteProductImages,
  deleteProductImagesFailureMessage
} from "@/lib/images/deleteProductImages";
import { UPLOAD_CONCURRENCY, buildUploadBlobs } from "@/lib/images/clientImageResize";
import { runWithConcurrency } from "@/lib/images/runWithConcurrency";
import { pickShopifyMainImage } from "@/lib/images/shopifyMainImage";
import { isDescriptionDetailImagesEnabled, isGenerateDetailEnabled } from "@/lib/images/detailCompose/flags";
import {
  imageSlotLabel,
  patchForProcessIntentPick,
  PROCESS_INTENT_LABELS,
  PROCESS_INTENT_OPTIONS,
} from "@/lib/images/processMarks";
import {
  filterStation2SubtabImages,
  isDetailSubtabImage,
  isMainSubtabImage,
  isSpecImage,
  STATION2_IMAGE_SUBTABS,
  station2SubtabCount,
  station2UploadImageType,
  type Station2ImageSubtab,
} from "@/lib/images/station2ImageTabs";
import type { ImageProcessIntent, ProductImage } from "@/types/domain";

/** Merge-only write for draft image_flags.generate_detail (SYN-1 UI). */
function mergeGenerateDetailFlag(
  existing: unknown,
  enabled: boolean
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  base.generate_detail = enabled ? "true" : "false";
  return base;
}

function sortByOrder(a: ProductImage, b: ProductImage): number {
  const orderA = a.sort_order ?? 0;
  const orderB = b.sort_order ?? 0;
  if (orderA !== orderB) return orderA - orderB;
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

/**
 * UX-F T30: station② 主圖｜規格圖｜詳情圖 + marks + DnD sort + 補圖.
 * Spec tab = mark semantics only (no dedicated upload).
 * SYN-1 UI: 生成詳情圖 draft-level switch (image_f...[truncated]�成 1 張繁中詳情長圖（可關）
          </span>
        </div>
        <label className="toggle" title={generateDetailOn ? "點一下關閉" : "點一下開啟"}>
          <input
            aria-label="生成詳情圖"
            checked={generateDetailOn}
            disabled={flagBusy}
            onChange={(event) => void setGenerateDetail(event.target.checked)}
            type="checkbox"
          />
          <span className="toggle-slider" />
        </label>
      </div>

      {hideSubtabs ? null : (
        <div className="s2-img-subtabs" role="tablist" aria-label="圖片類型">
          {STATION2_IMAGE_SUBTABS.map((tab) => {
            const count = station2SubtabCount(images, tab.id);
            const active = subtab === tab.id;
            return (
              <button
                aria-selected={active}
                className={`s2-img-subtab${active ? " active" : ""}`}
                key={tab.id}
                onClick={() => setSubtab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
                {count > 0 ? <span className="s2-img-subtab-count">{count}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      <div className="rc-field s2-img-body" role="tabpanel">
        <div className="rc-label">
          {subtab === "main"
            ? "主圖標記與排序（拖曳縮圖可改順序）"
            : subtab === "spec"
              ? "規格圖（在主圖標「規格圖」後會出現在此）"
              : isDescriptionDetailImagesEnabled(imageFlags)
                ? "詳情圖（會放進商品描述，也給 AI 讀字；開關在審核卡「圖片」分頁）"
                : "詳情圖（這件設定不放進商品描述，只給 AI 讀字）"}
        </div>

        {subtab === "main" && shopifyMainIsSpec ? (
          <div className="price-soft-warn">
            ⚠ 目前排第一的是規格圖，Shopify 會用它當主圖；想換就在要的那張按「設為主圖」。
          </div>
        ) : null}

        {list.length > 0 ? (
          /* UX-B2-P10: horizontal strip + large thumbs; tools under each card; spec = corner badge */
          <div className="imgmark-list imgmark-strip">
        ...[truncated]