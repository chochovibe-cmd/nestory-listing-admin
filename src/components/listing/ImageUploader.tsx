"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ImageType } from "@/types/domain";

// B1 (Mockup差異備忘 差異2): 只有主圖／詳情圖兩框。規格改表單手填欄位，不再上傳規格圖
// 做 OCR。詳情圖給 AI 讀資訊用（Vision 會轉錄圖上可見文字），不上架。
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
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [message, setMessage] = useState("");

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

      const urls: string[] = [];
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

        const { error: insertError } = await supabase.from("product_images").insert({
          draft_id: resolvedDraftId,
          image_type: type,
          original_file_url: data.publicUrl,
          processed_file_url: data.publicUrl,
          sort_order: startIndex + index,
          processing_status: "uploaded"
        });

        if (insertError) {
          setMessage(`圖片檔案已上傳，但寫入資料庫失敗：${insertError.message}`);
          return;
        }

        urls.push(data.publicUrl);
      }

      setPreviews((current) => ({ ...current, [type]: [...(current[type] ?? []), ...urls] }));
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

  return (
    <div className="drop-grid">
      {zones.map((zone) => {
        const count = previews[zone.type]?.length ?? 0;
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
              <div className="thumb-strip">
                {previews[zone.type].map((src) => (
                  <img alt={zone.label} className="thumb" key={src} src={src} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {uploadingCount > 0 ? <div className="notice">⟳ 圖片背景上傳中…（可繼續填寫，生成前會自動等它傳完）</div> : null}
      {message ? <div className="notice">{message}</div> : null}
    </div>
  );
}
