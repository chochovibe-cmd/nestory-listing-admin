"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { showToast } from "@/components/Toast";
import {
  CopyReferenceBadge,
  CopyReferenceRow,
  useCopyReference,
} from "@/components/listing/CopyReferenceControls";
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
 * UX-F T30: station② 主圖｜詳情圖 + marks + DnD sort + 補圖.
 * 4f: 規格圖 tab/badge removed; corner badge = 文案參考 (image_flags.copy_reference_image_ids).
 * SYN-1 UI: 生成詳情圖 draft-level switch (image_flags.generate_detail, default on).
 */
export function Station2ImagePanel({
  draftId,
  images,
  onImagesChange,
  unmarkedBlockMessage,
  imageFlags,
  onImageFlagsChange,
  /** 由 ResultCard 的 rc-tabs 控制時傳入；不傳則面板內自管 */
  subtab: subtabProp,
  onSubtabChange,
  hideSubtabs = false,
}: {
  draftId: string;
  images: ProductImage[];
  onImagesChange: (next: ProductImage[]) => void;
  unmarkedBlockMessage?: string | null;
  /** Draft-level image_flags (generate_detail lives here). */
  imageFlags?: unknown;
  onImageFlagsChange?: (next: Record<string, unknown>) => void;
  subtab?: Station2ImageSubtab;
  onSubtabChange?: (tab: Station2ImageSubtab) => void;
  /** true＝外層已有主圖／詳情圖 tabs，隱藏內層分層 */
  hideSubtabs?: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [subtabLocal, setSubtabLocal] = useState<Station2ImageSubtab>("main");
  const subtab = subtabProp ?? subtabLocal;
  const setSubtab = (tab: Station2ImageSubtab) => {
    if (onSubtabChange) onSubtabChange(tab);
    if (subtabProp == null) setSubtabLocal(tab);
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [flagBusy, setFlagBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** UX-H T49: soft-remove fade */
  const [fadingIds, setFadingIds] = useState<Set<string>>(() => new Set());
  /** IMAGE-INTEGRITY: variant-bound image ✕ needs a second click (arm, auto-disarm ~6s). */
  const [deleteArm, setDeleteArm] = useState<{ id: string; count: number } | null>(null);
  const deleteArmTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (deleteArmTimerRef.current != null) window.clearTimeout(deleteArmTimerRef.current);
    },
    []
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generateDetailOn = isGenerateDetailEnabled(imageFlags);

  const list = useMemo(
    () => filterStation2SubtabImages(images, subtab),
    [images, subtab]
  );
  const showMarks = subtab === "main";
  const shopifyMainId = pickShopifyMainImage(images)?.id ?? null;
  const copyRef = useCopyReference({
    draftId,
    images,
    imageFlags,
    onImageFlagsChange: (next) => onImageFlagsChange?.(next),
  });

  async function setProcessIntent(image: ProductImage, intent: ImageProcessIntent) {
    const patch = patchForProcessIntentPick(intent, image.is_spec_process);
    setLocalMsg("");
    setBusyId(image.id);
    const { error } = await supabase
      .from("product_images")
      .update({
        process_intent: patch.process_intent,
        is_spec_process: patch.is_spec_process,
      })
      .eq("id", image.id);
    setBusyId(null);
    if (error) {
      setLocalMsg(`標記失敗：${error.message}`);
      showToast(`標記失敗：${error.message}`, "error");
      return;
    }
    onImagesChange(
      images.map((row) =>
        row.id === image.id
          ? { ...row, process_intent: patch.process_intent, is_spec_process: patch.is_spec_process }
          : row
      )
    );
  }

  function clearDeleteArm() {
    if (deleteArmTimerRef.current != null) {
      window.clearTimeout(deleteArmTimerRef.current);
      deleteArmTimerRef.current = null;
    }
    setDeleteArm(null);
  }

  function armDelete(id: string, count: number) {
    if (deleteArmTimerRef.current != null) window.clearTimeout(deleteArmTimerRef.current);
    setDeleteArm({ id, count });
    deleteArmTimerRef.current = window.setTimeout(() => {
      deleteArmTimerRef.current = null;
      setDeleteArm(null);
    }, 6000);
  }

  // IMAGE-INTEGRITY: delete goes through deleteProductImages (unbind -> DB -> Storage).
  async function removeImage(image: ProductImage) {
    if (busyId === image.id) return;
    const armed = deleteArm?.id === image.id;
    setBusyId(image.id);
    const promptVariantBound = (count: number) => {
      armDelete(image.id, count);
      showToast(
        `這是款式圖，綁定 ${count} 個款式。再按一次 ✕ 會先解除這些款式的圖片綁定，再刪除圖片。`,
        "warn",
        6000
      );
    };
    const unfade = () =>
      setFadingIds((prev) => {
        const next = new Set(prev);
        next.delete(image.id);
        return next;
      });

    clearDeleteArm();

    setFadingIds((prev) => new Set(prev).add(image.id));
    // The helper itself refuses a variant-bound image (blockedByVariants) unless armed, and the
    // 250ms fade runs alongside the delete instead of before it. Storage cleanup is left to the background.
    const [result] = await Promise.all([
      deleteProductImages(supabase, [image.id], { unbindVariants: armed, backgroundStorageCleanup: true }),
      new Promise((r) => window.setTimeout(r, 250))
    ]);
    setBusyId(null);

    if (result.blockedByVariants?.length) {
      // First click on a variant-bound image -- ask again (armed second click unbinds).
      unfade();
      promptVariantBound(result.blockedByVariants.reduce((sum, row) => sum + row.count, 0));
      return;
    }
    if (!result.ok || !result.deletedIds.includes(image.id)) {
      unfade();
      const msg = `刪除圖片失敗：${deleteProductImagesFailureMessage(result)}`;
      setLocalMsg(msg);
      showToast(msg, "error");
      return;
    }
    onImagesChange(images.filter((row) => row.id !== image.id));
    unfade();
    const unboundCount = result.unboundVariantIds.length;
    showToast(
      unboundCount > 0 ? `已刪除圖片，並解除 ${unboundCount} 個款式的圖片綁定` : "已刪除圖片",
      "success"
    );
    // Parent holds the variant rows (image_id) -- refresh so they drop the unbound image.
    if (unboundCount > 0) router.refresh();
  }

  async function applyReorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const fromIdx = list.findIndex((r) => r.id === fromId);
    const toIdx = list.findIndex((r) => r.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;

    const nextTab = [...list];
    const [moved] = nextTab.splice(fromIdx, 1);
    nextTab.splice(toIdx, 0, moved);
    const tabQueue = [...nextTab];

    /**
     * Main tab shares the image_type=main/variant/spec pool — rebuild full pool so sort_order
     * stays unique: keep other-group slots, fill this tab’s new order.
     * Detail pool is independent.
     */
    let pool: ProductImage[];
    let inThisTab: (img: ProductImage) => boolean;
    if (subtab === "detail") {
      pool = images.filter(isDetailSubtabImage).slice().sort(sortByOrder);
      inThisTab = isDetailSubtabImage;
    } else {
      pool = images
        .filter((img) => img.image_type === "main" || img.image_type === "variant" || img.image_type === "spec")
        .slice()
        .sort(sortByOrder);
      inThisTab = isMainSubtabImage;
    }

    const rebuilt: ProductImage[] = [];
    for (const slot of pool) {
      if (inThisTab(slot)) {
        const next = tabQueue.shift();
        if (next) rebuilt.push(next);
      } else {
        rebuilt.push(slot);
      }
    }
    while (tabQueue.length) {
      const rest = tabQueue.shift();
      if (rest) rebuilt.push(rest);
    }

    const reindexed = rebuilt.map((item, index) => ({ ...item, sort_order: index }));
    const byId = new Map(reindexed.map((r) => [r.id, r]));
    const nextAll = images.map((row) => {
      const hit = byId.get(row.id);
      return hit ? { ...row, sort_order: hit.sort_order } : row;
    });
    onImagesChange(nextAll);

    const results = await Promise.all(
      reindexed.map((item) =>
        supabase.from("product_images").update({ sort_order: item.sort_order }).eq("id", item.id)
      )
    );
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      const msg = `排序儲存失敗：${firstErr.message}`;
      setLocalMsg(msg);
      showToast(msg, "error");
    }
  }

  async function makeShopifyMain(imageId: string) {
    const pool = images
      .filter(
        (img) =>
          img.image_type === "main" ||
          img.image_type === "variant" ||
          img.image_type === "spec",
      )
      .slice()
      .sort(sortByOrder);
    const selectedIndex = pool.findIndex((item) => item.id === imageId);
    if (selectedIndex < 0) return;

    const [selected] = pool.splice(selectedIndex, 1);
    const rebuilt = [selected, ...pool];
    const reindexed = rebuilt.map((item, index) => ({ ...item, sort_order: index }));
    const byId = new Map(reindexed.map((row) => [row.id, row]));
    const nextAll = images.map((row) => {
      const hit = byId.get(row.id);
      return hit ? { ...row, sort_order: hit.sort_order } : row;
    });
    onImagesChange(nextAll);

    const results = await Promise.all(
      reindexed.map((item) =>
        supabase.from("product_images").update({ sort_order: item.sort_order }).eq("id", item.id)
      )
    );
    const firstErr = results.find((result) => result.error)?.error;
    if (firstErr) {
      const msg = `排序儲存失敗：${firstErr.message}`;
      setLocalMsg(msg);
      showToast(msg, "error");
      return;
    }
    showToast("已設為 Shopify 主圖", "success");
  }

  async function setGenerateDetail(enabled: boolean) {
    if (flagBusy) return;
    setFlagBusy(true);
    setLocalMsg("");
    const nextFlags = mergeGenerateDetailFlag(imageFlags, enabled);
    const { error } = await supabase
      .from("product_drafts")
      .update({ image_flags: nextFlags })
      .eq("id", draftId);
    setFlagBusy(false);
    if (error) {
      const msg = `生成詳情圖開關儲存失敗：${error.message}`;
      setLocalMsg(msg);
      showToast(msg, "error");
      return;
    }
    onImageFlagsChange?.(nextFlags);
    showToast(
      enabled
        ? "已開啟生成詳情圖（標圖通過後會合成 1 張）"
        : "已關閉生成詳情圖（此商品不會合成詳情圖）",
      "success"
    );
  }

  async function uploadFiles(fileList: FileList | null) {
    const imageType = station2UploadImageType(subtab);
    if (!imageType || !fileList?.length) return;

    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      showToast("請選擇圖片檔", "error");
      return;
    }

    setUploading(true);
    setLocalMsg("");
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) {
        showToast("請先登入再補圖", "error");
        return;
      }

      const existingOfType = images.filter((img) =>
        imageType === "main"
          ? img.image_type === "main" || img.image_type === "variant"
          : img.image_type === "detail"
      );
      // SHOP-LISTING: sort_order is fixed by file order before the uploads run in parallel.
      const baseSort =
        existingOfType.reduce((max, img) => Math.max(max, img.sort_order ?? 0), -1) + 1;

      const settled = await runWithConcurrency(files, UPLOAD_CONCURRENCY, async (file, index) => {
        // Browser-side shrink (≤2048 WebP); mid/thumb are not uploaded here.
        const blobs = await buildUploadBlobs(file);
        const path = `${userId}/${draftId}/${imageType}/${crypto.randomUUID()}.${blobs.uploadExt}`;
        const { error: storageError } = await supabase.storage
          .from("product-images")
          .upload(path, blobs.upload, { contentType: blobs.uploadContentType, upsert: false });
        if (storageError) {
          showToast(`上傳失敗：${storageError.message}`, "error");
          return null;
        }
        const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
        const { data: row, error: insertError } = await supabase
          .from("product_images")
          .insert({
            draft_id: draftId,
            image_type: imageType,
            original_file_url: pub.publicUrl,
            processed_file_url: pub.publicUrl,
            sort_order: baseSort + index,
            processing_status: "uploaded",
            process_intent: null,
            is_spec_process: false,
          })
          .select("*")
          .single();
        if (insertError || !row) {
          showToast(`寫入失敗：${insertError?.message ?? "未知錯誤"}`, "error");
          return null;
        }
        return row as ProductImage;
      });
      // Keep original file order; failed files are skipped.
      const added: ProductImage[] = [];
      for (const result of settled) {
        if (result.status === "fulfilled" && result.value) added.push(result.value);
      }
      if (added.length) {
        onImagesChange([...images, ...added]);
        showToast(`已補 ${added.length} 張${imageType === "main" ? "主圖" : "詳情圖"}`, "success");
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="s2-img-panel">
      {/* SYN-1: per-draft 生成詳情圖 — default ON; writes image_flags.generate_detail */}
      <div className="s2-compose-row">
        <div className="s2-compose-copy">
          <span className="s2-compose-title">生成詳情圖</span>
          <span className="s2-compose-hint">
            預設開啟：標圖通過後合成 1 張繁中詳情長圖（可關）
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

      {/* 4f: 文案參考圖 — AI 先自動挑，老闆可點圖右上角改選 */}
      <CopyReferenceRow busy={copyRef.busy} onReset={copyRef.reset} selection={copyRef.selection} />

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
            : isDescriptionDetailImagesEnabled(imageFlags)
              ? "詳情圖（會放進商品描述，也給 AI 讀字；開關在審核卡「圖片」分頁）"
              : "詳情圖（這件設定不放進商品描述，只給 AI 讀字）"}
        </div>

        {list.length > 0 ? (
          /* UX-B2-P10: horizontal strip + large thumbs; tools under each card; 4f 文案參考 = corner badge */
          <div className="imgmark-list imgmark-strip">
            {list.map((image, index) => {
              const src =
                image.processed_file_url ??
                image.original_file_url ??
                image.generated_file_url ??
                "";
              const slot = imageSlotLabel(image, index + 1);
              const isDragging = dragId === image.id;
              const isOver = overId === image.id && dragId !== image.id;
              return (
                <div
                  className={`imgmark-row s2-img-row pthumb-card${isDragging ? " is-dragging" : ""}${isOver ? " is-drag-over" : ""}${fadingIds.has(image.id) ? " is-fading" : ""}`}
                  draggable
                  key={image.id}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    if (dragId && dragId !== image.id) setOverId(image.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDragStart={(event) => {
                    setDragId(image.id);
                    event.dataTransfer.effectAllowed = "move";
                    try {
                      event.dataTransfer.setData("text/plain", image.id);
                    } catch {
                      /* ignore */
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = dragId ?? event.dataTransfer.getData("text/plain");
                    setDragId(null);
                    setOverId(null);
                    if (from) void applyReorder(from, image.id);
                  }}
                >
                  <div className="thumb-wrap s2-img-thumb-wrap" title="拖曳排序">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={image.alt_text ?? slot} className="imgmark-thumb" src={src} />
                    {/* ✕ left — avoid clash with top-right 文案參考 badge (P10) */}
                    <button
                      className="thumb-remove s2-thumb-remove"
                      disabled={busyId === image.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeImage(image);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      title="移除這張圖片"
                      type="button"
                    >
                      ✕
                    </button>
                    <CopyReferenceBadge
                      disabled={copyRef.busy || busyId === image.id}
                      onToggle={() => copyRef.toggle(image.id)}
                      state={copyRef.badgeState(image.id)}
                    />
                  </div>
                  <span className="imgmark-slot-label">
                    {subtab === "main" && image.id === shopifyMainId ? "⭐ Shopify 主圖" : slot}
                  </span>
                  {showMarks ? (
                    <span className="imgmark-btns pthumb-tools">
                      {PROCESS_INTENT_OPTIONS.map((intent) => (
                        <button
                          aria-pressed={image.process_intent === intent}
                          className={`img-mark-btn${image.process_intent === intent ? " active" : ""}`}
                          disabled={busyId === image.id}
                          key={intent}
                          onClick={(e) => {
                            e.stopPropagation();
                            void setProcessIntent(image, intent);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          type="button"
                        >
                          {image.process_intent === intent
                            ? `✓ ${PROCESS_INTENT_LABELS[intent]}`
                            : PROCESS_INTENT_LABELS[intent]}
                        </button>
                      ))}
                      {subtab === "main" && image.id !== shopifyMainId ? (
                        <button
                          className="img-mark-btn"
                          disabled={busyId === image.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void makeShopifyMain(image.id);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          title="移到第一張，Shopify 會用這張當主圖"
                          type="button"
                        >
                          設為主圖
                        </button>
                      ) : null}
                    </span>
                  ) : (
                    <span className="muted s2-detail-hint">
                      詳情圖不用標處理方式
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted s2-img-empty">
            {subtab === "detail"
              ? "尚無詳情圖。可用下方補圖上傳。"
              : "尚無主圖。可用下方補圖上傳。"}
          </div>
        )}

        <div className="s2-img-upload">
          <input
            accept="image/*"
            className="sr-only"
            multiple
            onChange={(event) => void uploadFiles(event.currentTarget.files)}
            ref={fileInputRef}
            type="file"
          />
          <Button
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            {uploading ? "上傳中…" : subtab === "main" ? "＋ 補主圖" : "＋ 補詳情圖"}
          </Button>
        </div>

        {unmarkedBlockMessage && subtab === "main" ? (
          <div className="img-mark-warn" role="status">
            {unmarkedBlockMessage}
          </div>
        ) : null}
        {localMsg ? (
          <div className="img-mark-warn" role="status">
            {localMsg}
          </div>
        ) : null}
      </div>
    </div>
  );
}
