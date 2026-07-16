"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { intentForSpecToggle } from "@/lib/images/processMarks";
import type { ImageProcessIntent, ImageType } from "@/types/domain";

// B1 (Mockup差異備忘 差異2): 只有主圖／詳情圖兩框。規格改表單手填欄位，不再上傳規格圖
// 做 OCR。詳情圖給 AI 讀資訊用（Vision 會轉錄圖上可見文字），不上架。
// B5: 主圖區每張縮圖可切「規格圖」＝去簡體字影像處理標記（不是 OCR）。
// P1-1: never call parent onUploadingChange inside setState updater; no router.refresh on
// upload/mark (local previews are source of truth; refresh storm wiped the form).
// P1-2: optimistic blob thumbs, per-file fail/retry, delete ×, optional seed from DB.
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

type PreviewStatus = "ready" | "uploading" | "failed";

type PreviewItem = {
  /** Stable UI key (temp-* until DB row exists). */
  clientKey: string;
  id: string | null;
  url: string;
  /** Blob URL to revoke when replaced / removed. */
  blobUrl?: string;
  sort_order: number;
  is_spec_process: boolean;
  process_intent: ImageProcessIntent | null;
  status: PreviewStatus;
  errorMessage?: string;
  /** Kept for retry after failed upload. */
  file?: File;
  imageType: ImageType;
};

export type SeedImageRow = {
  id: string;
  image_type: string;
  original_file_url: string | null;
  processed_file_url: string | null;
  sort_order: number | null;
  process_intent?: ImageProcessIntent | null;
  is_spec_process?: boolean | null;
};

function storagePathFromPublicUrl(publicUrl: string): string | null {
  const marker = "/product-images/";
  const idx = publicUrl.indexOf(marker);
  if (idx < 0) return null;
  const rest = publicUrl.slice(idx + marker.length);
  const path = rest.split("?")[0] ?? "";
  return path ? decodeURIComponent(path) : null;
}

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
  onUploadingChange,
  seedImages
}: {
  draftId?: string;
  ensureDraftId?: () => Promise<string | null>;
  userId: string;
  trackUpload?: (promise: Promise<unknown>) => void;
  onUploadingChange?: (uploading: boolean) => void;
  /** P1-2 / 回饋 16: load existing product_images into previews (restore draft). */
  seedImages?: SeedImageRow[] | null;
}) {
  const supabase = createClient();
  const [previews, setPreviews] = useState<Record<string, PreviewItem[]>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [message, setMessage] = useState("");
  const [markError, setMarkError] = useState("");
  const [seedApplied, setSeedApplied] = useState(false);

  // P1-1: notify parent outside render / setState updater.
  useEffect(() => {
    onUploadingChange?.(uploadingCount > 0);
  }, [uploadingCount, onUploadingChange]);

  // P1-2: hydrate from server rows once (restore / detail).
  useEffect(() => {
    if (seedApplied || !seedImages?.length) return;
    const next: Record<string, PreviewItem[]> = { main: [], detail: [] };
    for (const row of seedImages) {
      const type = row.image_type === "detail" ? "detail" : "main";
      if (row.image_type !== "main" && row.image_type !== "detail") continue;
      const url = (row.processed_file_url || row.original_file_url || "").trim();
      if (!url) continue;
      const item: PreviewItem = {
        clientKey: row.id,
        id: row.id,
        url,
        sort_order: row.sort_order ?? 0,
        is_spec_process: Boolean(row.is_spec_process),
        process_intent: (row.process_intent as ImageProcessIntent | null) ?? null,
        status: "ready",
        imageType: type
      };
      next[type] = [...(next[type] ?? []), item];
    }
    for (const type of ["main", "detail"] as const) {
      next[type] = (next[type] ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
    }
    setPreviews(next);
    setSeedApplied(true);
  }, [seedImages, seedApplied]);

  function beginUpload() {
    setUploadingCount((current) => current + 1);
  }

  function endUpload() {
    setUploadingCount((current) => Math.max(0, current - 1));
  }

  function patchPreview(clientKey: string, imageType: ImageType, patch: Partial<PreviewItem>) {
    setPreviews((current) => {
      const list = current[imageType] ?? [];
      return {
        ...current,
        [imageType]: list.map((row) => (row.clientKey === clientKey ? { ...row, ...patch } : row))
      };
    });
  }

  function removePreviewLocal(clientKey: string, imageType: ImageType) {
    setPreviews((current) => {
      const list = current[imageType] ?? [];
      const target = list.find((r) => r.clientKey === clientKey);
      if (target?.blobUrl) {
        try {
          URL.revokeObjectURL(target.blobUrl);
        } catch {
          /* ignore */
        }
      }
      return {
        ...current,
        [imageType]: list.filter((r) => r.clientKey !== clientKey)
      };
    });
  }

  async function uploadOneFile(params: {
    type: ImageType;
    file: File;
    clientKey: string;
    sortOrder: number;
    resolvedDraftId: string;
    blobUrl: string;
  }) {
    const { type, file, clientKey, sortOrder, resolvedDraftId, blobUrl } = params;
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${userId}/${resolvedDraftId}/${type}/${crypto.randomUUID()}.${ext}`;

    const { error: storageError } = await supabase.storage.from("product-images").upload(path, file, {
      contentType: file.type,
      upsert: false
    });

    if (storageError) {
      patchPreview(clientKey, type, {
        status: "failed",
        errorMessage: storageError.message,
        file
      });
      setMessage(`上傳失敗：${storageError.message}`);
      return;
    }

    const { data } = supabase.storage.from("product-images").getPublicUrl(path);

    const { data: row, error: insertError } = await supabase
      .from("product_images")
      .insert({
        draft_id: resolvedDraftId,
        image_type: type,
        original_file_url: data.publicUrl,
        processed_file_url: data.publicUrl,
        sort_order: sortOrder,
        processing_status: "uploaded"
      })
      .select("id, original_file_url, processed_file_url, sort_order, process_intent, is_spec_process")
      .single();

    if (insertError || !row) {
      const msg = insertError?.message ?? "未知錯誤";
      patchPreview(clientKey, type, {
        status: "failed",
        errorMessage: `寫入資料庫失敗：${msg}`,
        file
      });
      setMessage(`圖片檔案已上傳，但寫入資料庫失敗：${msg}`);
      return;
    }

    const publicUrl = (row.processed_file_url ?? row.original_file_url ?? data.publicUrl) as string;
    patchPreview(clientKey, type, {
      id: row.id as string,
      url: publicUrl,
      sort_order: (row.sort_order as number) ?? sortOrder,
      is_spec_process: Boolean(row.is_spec_process),
      process_intent: (row.process_intent as ImageProcessIntent | null) ?? null,
      status: "ready",
      errorMessage: undefined,
      file: undefined,
      blobUrl: undefined
    });
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      /* ignore */
    }
  }

  async function uploadFiles(type: ImageType, fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    setMessage(`上傳 ${type === "main" ? "主圖" : "詳情圖"} 中…`);
    setMarkError("");

    const startIndex = previews[type]?.length ?? 0;
    const pending: PreviewItem[] = files.map((file, index) => {
      const blobUrl = URL.createObjectURL(file);
      return {
        clientKey: `temp-${crypto.randomUUID()}`,
        id: null,
        url: blobUrl,
        blobUrl,
        sort_order: startIndex + index,
        is_spec_process: false,
        process_intent: null,
        status: "uploading" as const,
        file,
        imageType: type
      };
    });

    setPreviews((current) => ({
      ...current,
      [type]: [...(current[type] ?? []), ...pending]
    }));

    beginUpload();
    const task = (async () => {
      const resolvedDraftId = draftId ?? (ensureDraftId ? await ensureDraftId() : null);
      if (!resolvedDraftId) {
        for (const item of pending) {
          patchPreview(item.clientKey, type, {
            status: "failed",
            errorMessage: "無法建立商品草稿"
          });
        }
        setMessage("無法建立商品草稿，圖片尚未上傳，請稍後再試。");
        return;
      }

      // Parallel per-file; one failure does not block others.
      await Promise.all(
        pending.map((item) =>
          uploadOneFile({
            type,
            file: item.file!,
            clientKey: item.clientKey,
            sortOrder: item.sort_order,
            resolvedDraftId,
            blobUrl: item.blobUrl!
          })
        )
      );

      setMessage("圖片已寫入資料庫");
    })();

    trackUpload?.(task);
    try {
      await task;
    } finally {
      endUpload();
    }
  }

  async function retryUpload(item: PreviewItem) {
    if (!item.file || item.status !== "failed") return;
    const type = item.imageType;
    setMarkError("");
    patchPreview(item.clientKey, type, { status: "uploading", errorMessage: undefined });
    beginUpload();
    const task = (async () => {
      const resolvedDraftId = draftId ?? (ensureDraftId ? await ensureDraftId() : null);
      if (!resolvedDraftId) {
        patchPreview(item.clientKey, type, {
          status: "failed",
          errorMessage: "無法建立商品草稿"
        });
        return;
      }
      const blobUrl = item.blobUrl ?? item.url;
      await uploadOneFile({
        type,
        file: item.file!,
        clientKey: item.clientKey,
        sortOrder: item.sort_order,
        resolvedDraftId,
        blobUrl
      });
    })();
    trackUpload?.(task);
    try {
      await task;
    } finally {
      endUpload();
    }
  }

  async function deleteImage(item: PreviewItem) {
    setMarkError("");
    if (!item.id) {
      removePreviewLocal(item.clientKey, item.imageType);
      return;
    }

    // Best-effort storage remove first (path derived from public URL).
    const path = storagePathFromPublicUrl(item.url);
    if (path) {
      await supabase.storage.from("product-images").remove([path]).catch(() => null);
    }

    const { error } = await supabase.from("product_images").delete().eq("id", item.id);
    if (error) {
      setMarkError(`刪除失敗：${error.message}`);
      return;
    }
    removePreviewLocal(item.clientKey, item.imageType);
    setMessage("已刪除圖片");
  }

  // B5: 規格圖 toggle on main-zone thumbs. Writes via existing product_images
  // update RLS (owner of unpublished draft / reviewer) — same path as delete.
  // P1-1: no router.refresh — local previews updated in place.
  async function toggleSpecMark(item: PreviewItem) {
    if (!item.id || item.status !== "ready") return;
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
        row.clientKey === item.clientKey
          ? { ...row, is_spec_process: next.is_spec_process, process_intent: next.process_intent }
          : row
      );
      return { ...current, main };
    });
  }

  const mainItems = previews.main ?? [];

  return (
    <div className="drop-grid">
      {zones.map((zone) => {
        const items = previews[zone.type] ?? [];
        const count = items.length;
        const readyCount = items.filter((i) => i.status === "ready").length;
        return (
          <div className="upload-section" key={zone.type}>
            <div className="upload-section-label">
              <span>
                {zone.icon} {zone.label}
              </span>
              <span className={`upload-type-badge ${zone.badgeClass}`}>{zone.badgeText}</span>
            </div>
            <label
              className={`dropzone${count > 0 ? " has-files" : ""}${dragging === zone.type ? " dragover" : ""}`}
              onDragLeave={() => setDragging(null)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(zone.type);
              }}
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
                <div className={`dz-status${readyCount > 0 ? " ready" : ""}`}>
                  {readyCount > 0 ? `✓ 已上傳 ${readyCount} 張` : count > 0 ? `處理中 ${count} 張` : ""}
                </div>
              </div>
            </label>
            {count > 0 ? (
              <div className="pthumb-strip">
                {items.map((item, index) => {
                  const isMainZone = zone.type === "main";
                  const isFirstMain = isMainZone && index === 0 && item.status === "ready";
                  return (
                    <div
                      className={`pthumb${isFirstMain ? " is-main" : ""}${item.status === "failed" ? " pthumb-failed" : ""}`}
                      key={item.clientKey}
                    >
                      <span className="pthumb-img-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={zone.label} className="thumb pthumb-img" src={item.url} />
                        {isFirstMain ? <span className="pthumb-badge">主圖</span> : null}
                        {item.status === "uploading" ? (
                          <span className="pthumb-status-overlay">上傳中…</span>
                        ) : null}
                        {item.status === "failed" ? (
                          <span className="pthumb-status-overlay pthumb-status-fail">失敗</span>
                        ) : null}
                        <button
                          aria-label="刪除此圖"
                          className="thumb-remove"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void deleteImage(item);
                          }}
                          type="button"
                        >
                          ×
                        </button>
                      </span>
                      {item.status === "failed" ? (
                        <button
                          className="img-mark-btn"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void retryUpload(item);
                          }}
                          type="button"
                        >
                          重試
                        </button>
                      ) : null}
                      {isMainZone && item.status === "ready" ? (
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
      {/* R2: process marks only on station② card; form only keeps 規格圖 toggle.
          Default keep is written at station① 核准 (Q2-A). */}
      {mainItems.length > 0 ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          處理標記（保留／簡轉繁／去字／重生）在文案核准後的「圖片審核」卡片設定；此處可標規格圖。
        </div>
      ) : null}
      {markError ? (
        <div className="img-mark-warn" role="alert">
          {markError}
        </div>
      ) : null}
      {uploadingCount > 0 ? (
        <div className="notice">⟳ 圖片背景上傳中…（可繼續填寫，生成前會自動等它傳完）</div>
      ) : null}
      {message ? <div className="notice">{message}</div> : null}
    </div>
  );
}
