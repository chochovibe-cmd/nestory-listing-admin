"use client";

import { useState } from "react";
import { CollapsibleSection } from "@/components/listing/CollapsibleSection";
import { Button } from "@/components/ui/Button";
import { pickShopifyMainImage } from "@/lib/images/shopifyMainImage";
import { pickDescriptionDetailRows } from "@/lib/images/descriptionDetailRows";
import type { ExcludedDetailImage } from "@/lib/import/captureSharedImages";
import {
  imageSlotLabel,
  PROCESS_INTENT_LABELS,
  PROCESS_INTENT_OPTIONS
} from "@/lib/images/processMarks";
import type { ImageProcessIntent, ProductImage } from "@/types/domain";

/** S2: 站③ 圖片分頁（可檢視／標記）— 從 ResultCard 展開區拆出。站② 仍用 Station2ImagePanel。 */
export function ResultCardImagesPanel({
  descriptionImagesBusy,
  descriptionImagesOn,
  imageMarks,
  pipelineImages,
  fadingImageIds,
  unmarkedImages,
  unmarkedBlockMessage,
  excludedDetailImages,
  restoreImageBusyIndex,
  restoreImageDisabledReason,
  onRestoreExcludedImage,
  onRemoveImage,
  onSetProcessIntent,
  onToggleDescriptionImages,
  onToggleSpec
}: {
  descriptionImagesBusy: boolean;
  descriptionImagesOn: boolean;
  imageMarks: ProductImage[];
  pipelineImages: ProductImage[];
  fadingImageIds: Set<string>;
  unmarkedImages: ProductImage[];
  unmarkedBlockMessage: string | null;
  excludedDetailImages: ExcludedDetailImage[];
  restoreImageBusyIndex: number | null;
  restoreImageDisabledReason: string | null;
  onRestoreExcludedImage: (index: number) => void;
  onRemoveImage: (image: ProductImage) => void;
  onSetProcessIntent: (image: ProductImage, intent: ImageProcessIntent) => void;
  onToggleDescriptionImages: (enabled: boolean) => void;
  onToggleSpec: (image: ProductImage) => void;
}) {
  const [excludedOpen, setExcludedOpen] = useState(false);

  if (imageMarks.length === 0) {
    return (
      <div className="rc-tabpanel" role="tabpanel">
        <div className="muted">尚無商品圖。</div>
      </div>
    );
  }

  const shopifyMainId = pickShopifyMainImage(imageMarks)?.id ?? null;
  // 4e: same...[truncated]