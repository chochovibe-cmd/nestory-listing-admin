"use client";

import { useCallback, useMemo, useState } from "react";
import { DraftResultsPanel, type VariantPriceRow } from "@/components/listing/DraftResultsPanel";
import { QuickPreviewPanel } from "@/components/listing/QuickPreviewPanel";
import { WorkbenchMobileShell } from "@/components/listing/WorkbenchMobileShell";
import { WorkspaceInputPanel } from "@/components/listing/WorkspaceInputPanel";
import type { JumpStripDraft } from "@/lib/drafts/stationJumpStrip";
import type { ProductDraft, ProductImage } from "@/types/domain";

/**
 * UX-B T4/T5/T10: client assembly for workbench.
 * Holds currentDraftId so QuickPreview can exclude the draft being edited.
 */
export function WorkbenchPageClient({
  userId,
  drafts,
  images,
  variants
}: {
  userId: string;
  drafts: ProductDraft[];
  images: ProductImage[];
  variants: VariantPriceRow[];
}) {
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);

  const onDraftIdChange = useCallback((id: string | null) => {
    setCurrentDraftId(id);
  }, []);

  const jumpDrafts: JumpStripDraft[] = useMemo(
    () =>
      drafts.map((d) => ({
        id: d.id,
        title_zh: d.title_zh,
        taobao_title: d.taobao_title,
        original_title: d.original_title,
        status: d.status,
        pipeline_stage: d.pipeline_stage,
        shopify_product_id: d.shopify_product_id,
        created_at: d.created_at,
        updated_at: d.updated_at
      })),
    [drafts]
  );

  const excludeDraftIds = useMemo(
    () => (currentDraftId ? [currentDraftId] : []),
    [currentDraftId]
  );

  return (
    <WorkbenchMobileShell
      input={
        <WorkspaceInputPanel userId={userId} onDraftIdChange={onDraftIdChange} />
      }
      quickPreview={
        <QuickPreviewPanel drafts={jumpDrafts} excludeDraftIds={excludeDraftIds} />
      }
      results={
        <DraftResultsPanel drafts={drafts} images={images} variants={variants} />
      }
    />
  );
}
