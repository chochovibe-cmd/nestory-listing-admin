"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { imageSlotLabel, intentForSpecToggle } from "@/lib/images/processMarks";
import type { ImageProcessIntent, ImageType } from "@/types/domain";

// B1 (Mockup差異備忘 差異2): 只有主圖／詳情圖兩框。規格改表單手填欄位，不再上傳規格圖
// 做 OCR。詳情圖給 AI 讀資訊用（Vision 會轉錄圖上可見文字），不上架。
// B5: 主圖區每張縮圖可切「規格圖」＝去簡體字影像處理標記（不是 OCR）。
const zones: Array<{
  type: ImageType;
  icon: string;
  label: string;
  badgeClass: string;
  badgeText: string;
  dropTitle: string;
}> = [
  { type: "main", icon: "🖼", label: "主圖（3-5張）", badgeClass: "badge-main", badgeText: "1:1 裁切", dropTitle: "點擊或拖曳主圖" },
  { type: "detail", icon: "📋", label: "詳情圖（供 AI 讀資訊，不上架）", badgeClass: "badge-detail", badgeText: "Vision 參考", dropTitle: "點擊或拖曳詳情圖" }
];

type PreviewItem = {
  id: string;
  url: string;
  sort_order: number;
  is_spec_process: boolean;
  process_intent: ImageProcessIntent | null;
};

// B1: images are now selected in the form BEFORE the draft is generated and
// uploaded in the background while the operator keeps filling in the rest.
// The draft row may not exist yet on first drop, so the new-draft flow passes
// `ensureDraftId()` (idempotent -- first call creates the minimal draft, later
// calls return the same id) instead of a fixed `draftId`. The existing-draft
// detail page still passes a plain `draftId` (a Server Component can't hand a
// function to a Client Component). Each upload promise is handed back through
// `trackUpload` so the parent can await outstanding uploads before it calls
// analyze-images/generate, and `onUploadingChange` drives the parent's
// "圖片還在上傳" gate on the generate button.
export function ImageUploader({
  draftId,
  ensureDraftId,
  userId,
  trackUpload,
  onUploadingChange
}: {
  draftId?: string;
  ensureDraftId?: () => Promise<string | null>;
  userId: string;
  trackUpload?: (promise: Promise<unknown>) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [previews, setPreviews] = useState<Record<string, PreviewItem[]>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [message, setMessage] = useState("");
  const [markError, setMarkError] = useState("");

  function beginUpload() {
    setUploadingCount((current) => {
      const next = current + 1;
      if (current === 0) onUploadingChange?.(true);
      return next;
    });
  }

  function endUpload() {
    setUploadingCount((current) => {
      const next = Math.max(0, current - 1);
      if (next === 0) onUploadingChange?.(false);
      return next;
    });
  }

  async function uploadFiles(type: ImageType, fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    setMessage(`上傳 ${type} 圖片中...`);
    setMarkError("");
    beginUpload();

    const task = (async () => {
      // Existing-draft page passes draftId directly; the new-draft flow creates
      // it lazily on the first upload (concurrent drops resolve to the same id
      // because ensureDraftId is idempotent).
      const resolvedDraftId = draftId ?? (ensureDraftId ? await ensureDraftId() : null);
      if (!resolvedDraftId) {
        setMessage("無法建立商品草稿，圖片尚未上傳，請稍後再試。");
        return;
      }

      const added: PreviewItem[] = [];
      const startIndex = previews[type]?.length ?? 0;

      for (const [index, file] of files.entries()) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${userId}/${resolvedDraftId}/${type}/${crypto.randomUUID()}.${ext}`;
        const { error: storageError } = await supabase.storage.from("product-images").upload(path, file, {
          contentType: file.type,
          upsert: false
        });

        if (storageError) {
          setMessage(`上傳失敗：${storageError.message}`);
          return;
        }

        const { data } = supabase.storage.from("product-images").getPublicUrl(path);

        // Default blank marks (process_intent null, is_spec_process false) —
        // DB defaults cover this; we select the row back so the 規格圖 toggle
        // can update by id without a full page reload.
        const { data: row, error: insertError } = await supabase
          .from("product_images")
          .insert({
            draft_id: resolvedDraftId,
            image_type: type,
            original_file_url: data.publicUrl,
            processed_file_url: data.publicUrl,
            sort_order: startIndex + index,
            processing_status: "uploaded"
          })
          .select("id, original_file_url, processed_file_url, sort_order, process_intent, is_spec_process")
          .single();

        if (insertError || !row) {
          setMessage(`圖片檔案已上傳，但寫入資料庫失敗：${insertError?.message ?? "未知錯誤"}`);
          return;
        }

        added.push({
          id: row.id as string,
          url: (row.processed_file_url ?? row.original_file_url ?? data.publicUrl) as string,
          sort_order: (row.sort_order as number) ?? startIndex + index,
          is_spec_process: Boolean(row.is_spec_process),
          process_intent: (row.process_intent as ImageProcessIntent | null) ?? null
        });
      }

      setPreviews((current) => ({
        ...current,
        [type]: [...(current[type] ?? []), ...added]
      }));
      setMessage("圖片已寫入資料庫");
      router.refresh();
    })();

    trackUpload?.(task);
    try {
      await task;
    } finally {
      endUpload();
    }
  }

  // B5: 規格圖 toggle on main-zone thumbs. Writes via existing product_images
  // update RLS (owner of unpublished draft / reviewer) — same path as delete.
  async function toggleSpecMark(item: PreviewItem) {
    const next = intentForSpecToggle(!item.is_spec_process);
    setMarkError("");
    const { error } = await supabase
      .from("product_images")
      .update({
        is_spec_process: next.is_spec_process,
        process_intent: next.process_intent
      })
      .eq("id", item.id);

    if (error) {
      setMarkError(`標記失敗：${error.message}`);
      return;
    }

    setPreviews((current) => {
      const main = (current.main ?? []).map((row) =>
        row.id === item.id
          ? { ...row, is_spec_process: next.is_spec_process, process_intent: next.process_intent }
          : row
      );
      return { ...current, main };
    });
    router.refresh();
  }

  const mainItems = previews.main ?? [];
  // Local-session unmarked count for main images only (form-side hint).
  const unmarkedMain = mainItems.filter((item) => item.process_intent == null);
  const formUnmarkedLabels = unmarkedMain.map((item) => {
    const position = mainItems.findIndex((row) => row.id === item.id) + 1;
    return imageSlotLabel(
      { image_type: "main", is_spec_process: item.is_spec_process },
      position
    );
  });

  return (
    <div className="drop-grid">
      {zones.map((zone) => {
        const items = previews[zone.type] ?? [];
        const count = items.length;
        return (
          <div className="upload-section" key={zone.type}>
            <div className="upload-section-label">
              <span>{zone.icon} {zone.label}</span>
              <span className={`upload-type-badge ${zone.badgeClass}`}>{zone.badgeText}</span>
            </div>
            <label
              className={`dropzone${count > 0 ? " has-files" : ""}${dragging === zone.type ? " dragover" : ""}`}
              onDragLeave={() => setDragging(null)}
              onDragOver={(event) => { event.preventDefault(); setDragging(zone.type); }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(null);
                uploadFiles(zone.type, event.dataTransfer.files);
              }}
            >
              <input
                accept="image/*"
                multiple
                onChange={(event) => uploadFiles(zone.type, event.currentTarget.files)}
                type="file"
              />
              <div className="dz-icon">{zone.icon}</div>
              <div className="dz-text">
                <div className="dz-title">{zone.dropTitle}</div>
                <div className={`dz-status${count > 0 ? " ready" : ""}`}>
                  {count > 0 ? `✓ 已上傳 ${count} 張` : ""}
                </div>
              </div>
            </label>
            {count > 0 ? (
              <div className="pthumb-strip">
                {items.map((item, index) => {
                  const isMainZone = zone.type === "main";
                  const isFirstMain = isMainZone && index === 0;
                  return (
                    <div className={`pthumb${isFirstMain ? " is-main" : ""}`} key={item.id}>
                      <span className="pthumb-img-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={zone.label} className="thumb pthumb-img" src={item.url} />
                        {isFirstMain ? <span className="pthumb-badge">主圖</span> : null}
                      </span>
                      {isMainZone ? (
                        <button
                          aria-pressed={item.is_spec_process}
                          className={`img-mark-btn${item.is_spec_process ? " active" : ""}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void toggleSpecMark(item);
                          }}
                          type="button"
                        >
                          {item.is_spec_process ? "✓ 規格圖" : "規格圖"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
      {mainItems.length > 0 && unmarkedMain.length > 0 ? (
        <div className="img-mark-warn" role="status">
          ⚠ 還有 {unmarkedMain.length} 張商品圖未標記：{formUnmarkedLabels.join("、")}
          （送圖前請在右側卡片選處理方式；規格圖＝去簡體字）
        </div>
      ) : null}
      {markError ? <div className="img-mark-warn" role="alert">{markError}</div> : null}
      {uploadingCount > 0 ? <div className="notice">⟳ 圖片背景上傳中…（可繼續填寫，生成前會自動等它傳完）</div> : null}
      {message ? <div className="notice">{message}</div> : null}
    </div>
  );
}
