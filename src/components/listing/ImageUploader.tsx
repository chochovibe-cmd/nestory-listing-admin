"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ImageType } from "@/types/domain";

const zones: Array<{ type: ImageType; label: string; hint: string }> = [
  { type: "main", label: "主圖", hint: "Shopify 主圖，後續會裁切 / 補白成 1:1" },
  { type: "detail", label: "詳情圖", hint: "今天先上傳與預覽，後續處理簡轉繁 / 去字" },
  { type: "spec", label: "規格圖", hint: "今天先保存，後續給扣哥 Skill 做 OCR 與整理" }
];

export function ImageUploader({ draftId, userId }: { draftId: string; userId: string }) {
  const supabase = createClient();
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");

  async function uploadFiles(type: ImageType, fileList: FileList | null) {
    if (!fileList?.length) return;
    setMessage(`上傳 ${type} 圖片中...`);
    const urls: string[] = [];

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
        sort_order: index,
        processing_status: "uploaded"
      });
    }

    setPreviews((current) => ({ ...current, [type]: [...(current[type] ?? []), ...urls] }));
    setMessage("圖片已寫入資料庫");
  }

  return (
    <div className="drop-grid">
      {zones.map((zone) => (
        <label className="drop-zone" key={zone.type}>
          <strong>{zone.label}</strong>
          <p className="muted">{zone.hint}</p>
          <input
            accept="image/*"
            multiple
            onChange={(event) => uploadFiles(zone.type, event.currentTarget.files)}
            type="file"
          />
          <div className="thumbs">
            {(previews[zone.type] ?? []).map((src) => (
              <img alt={zone.label} key={src} src={src} />
            ))}
          </div>
        </label>
      ))}
      {message ? <div className="notice">{message}</div> : null}
    </div>
  );
}
