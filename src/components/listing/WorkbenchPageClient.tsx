"use client";

import { useCallback, useMemo, useState } from "react";
import { DraftResultsPanel, type VariantPriceRow } from "@/components/listing/DraftResultsPanel";
import { QuickPreviewPanel } from "@/components/listing/QuickPreviewPanel";
import { WorkbenchMobileShell } from "@/components/listing/WorkbenchMobileShell";
import { WorkspaceInputPanel } from "@/components/listing/WorkspaceInputPanel";
import type { WorkspaceFormSeed } from "@/lib/drafts/mapDraftToWorkspaceForm";
import type { JumpStripDraft } from "@/lib/drafts/stationJumpStrip";
import type { ProductDraft, ProductImage } from "@/types/domain";

/**
 * UX-B T4/T5/T10: client assembly for workbench.
 * Holds currentDraftId so QuickPreview can exclude the draft being edited.
 * CAP-2.5: optional server seed for ?draft= pending_input.
 */
export function WorkbenchPageClient({
  userId,
  drafts,
  images,
  variants,
  initialFromServer = null,
  loadNotice = null
}: {
  userId: string;
  drafts: ProductDraft[];
  images: ProductImage[];
  variants: VariantPriceRow[];
  initialFromServer?: WorkspaceFormSeed | null;
  loadNotice?: string | null;
}) {
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(
    initialFromServer?.draftId ?? null
  );

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
        generation_status: d.generation_status,
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
        <WorkspaceInputPanel
          userId={userId}
          onDraftIdChange={onDraftIdChange}
          initialFromServer={initialFromServer}
          loadNotice={loadNotice}
        />
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
