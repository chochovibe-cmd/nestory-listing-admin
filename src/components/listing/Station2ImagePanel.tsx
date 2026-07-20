"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { showToast } from "@/components/Toast";
import { isGenerateDetailEnabled } from "@/lib/images/detailCompose/flags";
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

function storagePathFromUrl(url: string): string | null {
  const marker = "/product-images/";
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}

/**
 * UX-F T30: station② 主圖｜規格圖｜詳情圖 + marks + DnD sort + 補圖.
 * Spec tab = mark semantics only (no dedicated upload).
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
  /** true＝外層已有主圖／規格圖／詳情圖 tabs，隱藏內層分層 */
  hideSubtabs?: boolean;
}) {
  const supabase = createClient();
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generateDetailOn = isGenerateDetailEnabled(imageFlags);

  const list = useMemo(
    () => filterStation2SubtabImages(images, subtab),
    [images, subtab]
  );
  const canUpload = station2UploadImageType(subtab) != null;
  const showMarks = subtab === "main" || subtab === "spec";

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

  async function toggleSpec(image: ProductImage) {
    const nextOn = !image.is_spec_process;
    const patch = nextOn
      ? { is_spec_process: true, process_intent: "de_text" as const }
      : { is_spec_process: false, process_intent: null };
    setLocalMsg("");
    setBusyId(image.id);
    const { error } = await supabase.from("product_images").update(patch).eq("id", image.id);
    setBusyId(null);
    if (error) {
      setLocalMsg(`規格圖標記失敗：${error.message}`);
      showToast(`規格圖標記失敗：${error.message}`, "error");
      return;
    }
    onImagesChange(
      images.map((row) =>
        row.id === image.id
          ? { ...row, is_spec_process: patch.is_spec_process, process_intent: patch.process_intent }
          : row
      )
    );
  }

  async function removeImage(image: ProductImage) {
    setBusyId(image.id);
    setFadingIds((prev) => new Set(prev).add(image.id));
    await new Promise((r) => window.setTimeout(r, 250));
    const url = image.processed_file_url ?? image.original_file_url;
    const path = url ? storagePathFromUrl(url) : null;
    if (path) {
      await supabase.storage.from("product-images").remove([path]);
    }
    const { error } = await supabase.from("product_images").delete().eq("id", image.id);
    setBusyId(null);
    if (error) {
      setFadingIds((prev) => {
        const next = new Set(prev);
        next.delete(image.id);
        return next;
      });
      setLocalMsg(`刪除圖片失敗：${error.message}`);
      showToast(`刪除圖片失敗：${error.message}`, "error");
      return;
    }
    onImagesChange(images.filter((row) => row.id !== image.id));
    setFadingIds((prev) => {
      const next = new Set(prev);
      next.delete(image.id);
      return next;
    });
    showToast("已刪除圖片", "success");
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
     * Main/spec share image_type=main pool — rebuild full pool so sort_order
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
      inThisTab = subtab === "main" ? isMainSubtabImage : isSpecImage;
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
      let nextSort =
        existingOfType.reduce((max, img) => Math.max(max, img.sort_order ?? 0), -1) + 1;

      const added: ProductImage[] = [];
      for (const file of files) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${userId}/${draftId}/${imageType}/${crypto.randomUUID()}.${ext}`;
        const { error: storageError } = await supabase.storage
          .from("product-images")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (storageError) {
          showToast(`上傳失敗：${storageError.message}`, "error");
          continue;
        }
        const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
        const { data: row, error: insertError } = await supabase
          .from("product_images")
          .insert({
            draft_id: draftId,
            image_type: imageType,
            original_file_url: pub.publicUrl,
            processed_file_url: pub.publicUrl,
            sort_order: nextSort,
            processing_status: "uploaded",
            process_intent: null,
            is_spec_process: false,
          })
          .select("*")
          .single();
        if (insertError || !row) {
          showToast(`寫入失敗：${insertError?.message ?? "未知錯誤"}`, "error");
          continue;
        }
        added.push(row as ProductImage);
        nextSort += 1;
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
              : "詳情圖（供 AI 參考，不上架）"}
        </div>

        {list.length > 0 ? (
          /* UX-B2-P10: horizontal strip + large thumbs; tools under each card; spec = corner badge */
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
                    {/* ✕ left — avoid clash with top-right spec badge (P10) */}
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
                    {showMarks ? (
                      <button
                        type="button"
                        className={`pthumb-spec-badge${image.is_spec_process ? " active" : ""}`}
                        disabled={busyId === image.id}
                        aria-pressed={!!image.is_spec_process}
                        title={image.is_spec_process ? "取消規格圖標記" : "標示為規格圖"}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleSpec(image);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        {image.is_spec_process ? "📐 規格圖" : "規格圖"}
                      </button>
                    ) : null}
                  </div>
                  <span className="imgmark-slot-label">{slot}</span>
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
                    </span>
                  ) : (
                    <span className="muted s2-detail-hint">
                      詳情圖僅供辨識，無需標記
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted s2-img-empty">
            {subtab === "spec"
              ? "目前沒有規格圖。請到「主圖」把需要的圖標成「規格圖」。"
              : subtab === "detail"
                ? "尚無詳情圖。可用下方補圖上傳（不上架）。"
                : "尚無主圖。可用下方補圖上傳。"}
          </div>
        )}

        {canUpload ? (
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
        ) : (
          <p className="muted s2-img-spec-hint">規格圖請在主圖分頁標記，不另開上傳。</p>
        )}

        {unmarkedBlockMessage && (subtab === "main" || subtab === "spec") ? (
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
