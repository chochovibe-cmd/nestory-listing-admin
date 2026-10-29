"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/Toast";
import { createClient } from "@/lib/supabase/client";
import {
  copyReferenceBadgeState,
  copyReferenceCandidates,
  copyReferenceHint,
  MAX_COPY_REFERENCE_IMAGES,
  mergeCopyReferenceIds,
  parseCopyReferenceIds,
  selectCopyReferenceImages,
  toggleCopyReference,
  type CopyReferenceBadgeState,
  type CopyReferenceImageRow,
  type CopyReferenceSelection,
} from "@/lib/images/copyReference";

/**
 * 4f 文案參考圖 state for one draft (station② / station③ share it).
 * Writes product_drafts.image_flags.copy_reference_image_ids only — read-then-merge so
 * vision_status / fingerprint written by analyze-images are never clobbered; never touches
 * product_images (no 「需同步」 dirty mark) and never refreshes the page.
 */
export function useCopyReference({
  draftId,
  images,
  imageFlags,
  onImageFlagsChange,
}: {
  draftId: string;
  images: readonly CopyReferenceImageRow[];
  imageFlags: unknown;
  onImageFlagsChange: (next: Record<string, unknown>) => void;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const candidates = useMemo(() => copyReferenceCandidates(images), [images]);
  const storedIds = useMemo(() => parseCopyReferenceIds(imageFlags), [imageFlags]);
  const selection = useMemo(
    () => selectCopyReferenceImages(candidates, storedIds),
    [candidates, storedIds],
  );

  async function save(nextIds: string[], okMessage: string) {
    if (busy) return;
    setBusy(true);
    try {
      const { data: row, error: readError } = await supabase
        .from("product_drafts")
        .select("image_flags")
        .eq("id", draftId)
        .single();
      if (readError) {
        showToast(`文案參考圖儲存失敗：${readError.message}`, "error");
        return;
      }
      const next = mergeCopyReferenceIds(row?.image_flags, nextIds);
      const { error } = await supabase
        .from("product_drafts")
        .update({ image_flags: next })
        .eq("id", draftId);
      if (error) {
        showToast(`文案參考圖儲存失敗：${error.message}`, "error");
        return;
      }
      onImageFlagsChange(next);
      showToast(okMessage, nextIds.length > 0 ? "success" : "info");
    } finally {
      setBusy(false);
    }
  }

  function toggle(imageId: string) {
    const result = toggleCopyReference(candidates, storedIds, imageId);
    if (!result.ok) {
      if (result.reason === "max") {
        showToast(`文案參考最多 ${MAX_COPY_REFERENCE_IMAGES} 張，請先取消一張`, "error");
      }
      return;
    }
    void save(
      result.nextIds,
      result.nextIds.length > 0
        ? `文案參考圖已更新（${result.nextIds.length} 張）`
        : "沒有指定的圖了，改回 AI 自動挑選",
    );
  }

  function reset() {
    void save([], "已改回 AI 自動挑選");
  }

  function badgeState(imageId: string): CopyReferenceBadgeState {
    return copyReferenceBadgeState(candidates, selection, imageId);
  }

  return { busy, selection, toggle, reset, badgeState };
}

/** 4f: corner badge on a thumb — reuses .pthumb-spec-badge (位置、樣子沿用舊「規格圖」角標). */
export function CopyReferenceBadge({
  state,
  disabled = false,
  compact = false,
  onToggle,
}: {
  state: CopyReferenceBadgeState;
  disabled?: boolean;
  /** station③ 60px detail thumbs: shorter text along the bottom edge. */
  compact?: boolean;
  onToggle: () => void;
}) {
  if (state === null) return null;
  const label =
    state === "auto"
      ? "✓ 自動"
      : state === "manual"
        ? compact
          ? "✓ 參考"
          : "✓ 文案參考"
        : compact
          ? "參考"
          : "文案參考";
  const title =
    state === "auto"
      ? "AI 自動挑的文案參考圖；點一下拿掉這張，改成自己指定"
      : state === "manual"
        ? "取消文案參考"
        : "設為文案參考圖：AI 會讀這張圖上的字寫文案";
  return (
    <button
      aria-pressed={state !== "off"}
      className={`pthumb-spec-badge${state === "manual" ? " active" : ""}${state === "auto" ? " is-auto" : ""}${compact ? " is-compact" : ""}`}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      title={title}
      type="button"
    >
      {label}
    </button>
  );
}

/** 4f: one row above the thumbs — what AI reads now + 恢復自動挑選 when manual. */
export function CopyReferenceRow({
  selection,
  busy,
  onReset,
}: {
  selection: CopyReferenceSelection;
  busy: boolean;
  onReset: () => void;
}) {
  if (selection.selected.length === 0) return null;
  return (
    <div className="s2-compose-row copyref-row">
      <div className="s2-compose-copy">
        <span className="s2-compose-title">文案參考圖</span>
        <span className="s2-compose-hint">{copyReferenceHint(selection)}</span>
      </div>
      {selection.mode === "manual" ? (
        <Button disabled={busy} onClick={onReset} size="sm" type="button">
          恢復自動挑選
        </Button>
      ) : null}
    </div>
  );
}

export type CopyReferenceController = ReturnType<typeof useCopyReference>;
