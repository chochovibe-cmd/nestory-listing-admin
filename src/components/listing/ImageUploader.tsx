"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ImageType } from "@/types/domain";

const zones: Array<{
  type: ImageType;
  icon: string;
  label: string;
  badgeClass: string;
  badgeText: string;
  dropTitle: string;
}> = [
  { type: "main", icon: "🖼", label: "主圖（3-5張）", badgeClass: "badge-main", badgeText: "1:1 裁切", dropTitle: "點擊或拖曳主圖" },
  { type: "detail", icon: "📋", label: "詳情圖", badgeClass: "badge-detail", badgeText: "800px", dropTitle: "點擊或拖曳詳情圖" },
  { type: "spec", icon: "📐", label: "規格圖", badgeClass: "badge-spec", badgeText: "OCR", dropTitle: "點擊或拖曳規格圖" }
];

export function ImageUploader({ draftId, userId }: { draftId: string; userId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function uploadFiles(type: ImageType, fileList: FileList | null) {
    if (!fileList?.length) return;
    setMessage(`上傳 ${type} 圖片中...`);
    const urls: string[] = [];
    const startIndex = previews[type]?.length ?? 0;

    for (const [index, file] of Array.from(fileList).entries()) {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${draftId}/${type}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, {
        contentType: file.type,
        upsert: false
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      urls.push(data.publicUrl);

      await supabase.from("product_images").insert({
        draft_id: draftId,
        image_type: type,
        original_file_url: data.publicUrl,
        processed_file_url: data.publicUrl,
        sort_order: startIndex + index,
        processing_status: "uploaded"
      });
    }

    setPreviews((current) => ({ ...current, [type]: [...(current[type] ?? []), ...urls] }));
    setMessage("圖片已寫入資料庫");
    router.refresh();
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
      {message ? <div className="notice">{message}</div> : null}
    </div>
  );
}
