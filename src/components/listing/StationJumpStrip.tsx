"use client";

import { QuickPreviewPanel } from "@/components/listing/QuickPreviewPanel";
import type { JumpStripDraft } from "@/lib/drafts/stationJumpStrip";

/**
 * @deprecated Prefer QuickPreviewPanel (UX-B T5).
 * Thin alias kept for any residual imports.
 */
export function StationJumpStrip({
  drafts,
  excludeDraftIds
}: {
  drafts: JumpStripDraft[];
  excludeDraftIds?: readonly string[] | null;
}) {
  return (
    <QuickPreviewPanel
      drafts={drafts}
      excludeDraftIds={excludeDraftIds}
      title="各站掛件總覽"
      hint="點擊跳到對應卡片"
    />
  );
}
