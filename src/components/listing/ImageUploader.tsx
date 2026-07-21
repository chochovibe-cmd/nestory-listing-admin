"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  buildDualSizeBlobs,
  dualSizeExt
} from "@/lib/images/clientImageResize";
import { intentForSpecToggle } from "@/lib/images/processMarks";
import { showToast } from "@/components/Toast";
import type { ImageProcessIntent, ImageType } from "@/types/domain";

// B1 (Mockup差異備忘 差異2): 只有主圖／詳情圖兩框。規格改表單手填欄位，不再上傳規格圖
// 做 OCR。詳情圖給 AI 讀資訊用（Vision 會轉錄圖上可見文字），不上架。
// B5: 主圖區每張縮圖可切「規格圖」＝去簡體字影像處理標記（不是 OCR）。
// P1-1: never call parent onUploadingChange inside setState updater; no router.refresh on
// upload/mark (local previews are source of truth; refresh storm wiped the form).
// P1-2: optimistic blob thumbs, per-file fail/retry, delete ×, optional seed from DB.
// UX-D T20: Ctrl+V paste image into zone → same upload pipeline.
// UX-D T21: delete fail → showToast (notice kept).
// UX-D T22: HTML5 DnD reorder thumbs; persist sort_order for rows with id.
// UX-D T23: form-side mark copy is short (no long 「未標記／處理標記在核准後」nag).
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
  list_thumb_url?: string | null;
  vision_mid_url?: string | null;
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

/** UX-D T20: pull image files from paste clipboard (files or items). */
function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (fromFiles.length > 0) return fromFiles;
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  return out;
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
// UX-I T47: parent page-drop mask calls uploadMainFiles → same main pipeline.

export type ImageUploaderHandle = {
  /** Full-page / external drop → main zone only (same as dropzone upload). */
  uploadMainFiles: (files: FileList | File[] | null) => Promise<void>;
};

type ImageUploaderProps = {
  draftId?: string;
  ensureDraftId?: () => Promise<string | null>;
  userId: string;
  trackUpload?: (promise: Promise<unknown>) => void;
  onUploadingChange?: (uploading: boolean) => void;
  /** BX7: parent cost hint — count ready+uploading previews by zone. */
  onCountsChange?: (counts: { main: number; detail: number }) => void;
  /** P1-2 / 回饋 16: load existing product_images into previews (restore draft). */
  seedImages?: SeedImageRow[] | null;
};

export const ImageUploader = forwardRef<ImageUploaderHandle, ImageUploaderProps>(function ImageUploader(
  {
    draftId,
    ensureDraftId,
    userId,
    trackUpload,
    onUploadingChange,
    onCountsChange,
    seedImages
  },
  ref
) {
  const supabase = createClient();
  const [previews, setPreviews] = useState<Record<string, PreviewItem[]>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [message, setMessage] = useState("");
  const [markError, setMarkError] = useState("");
  const [seedApplied, setSeedApplied] = useState(false);
  /** UX-D T22: HTML5 DnD source thumb */
  const [reorderDrag, setReorderDrag] = useState<{ type: ImageType; clientKey: string } | null>(null);
  const [reorderOverKey, setReorderOverKey] = useState<string | null>(null);
  /** UX-H T49: soft-remove fade before drop from strip */
  const [fadingKeys, setFadingKeys] = useState<Set<string>>(() => new Set());

  // Latest previews for in-flight upload to pick current sort_order after local reorder (T22).
  const previewsRef = useRef(previews);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  // P1-1: notify parent outside render / setState updater.
  useEffect(() => {
    onUploadingChange?.(uploadingCount > 0);
  }, [uploadingCount, onUploadingChange]);

  // BX7: live main/detail counts for generate cost hint
  useEffect(() => {
    onCountsChange?.({
      main: (previews.main ?? []).length,
      detail: (previews.detail ?? []).length
    });
  }, [previews, onCountsChange]);

  // P1-2: hydrate from server rows once (restore / detail).
  useEffect(() => {
    if (seedApplied || !seedImages?.length) return;
    const next: Record<string, PreviewItem[]> = { main: [], detail: [] };
    for (const row of seedImages) {
      const type = row.image_type === "detail" ? "detail" : "main";
      if (row.image_type !== "main" && row.image_type !== "detail") continue;
      const url = (
        row.list_thumb_url ||
        row.processed_file_url ||
        row.original_file_url ||
        ""
      ).trim();
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

  function currentSortOrder(clientKey: string, imageType: ImageType, fallback: number): number {
    const list = previewsRef.current[imageType] ?? [];
    const row = list.find((r) => r.clientKey === clientKey);
    return row?.sort_order ?? fallback;
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
    const baseId = crypto.randomUUID();
    const origExt = file.name.split(".").pop() || "jpg";
    const origPath = `${userId}/${resolvedDraftId}/${type}/${baseId}-orig.${origExt}`;

    // A19: resize mid/thumb in browser while original path is ready
    const dual = await buildDualSizeBlobs(file);
    const midExt = dualSizeExt(dual.mid, file);
    const thumbExt = dualSizeExt(dual.thumb, file);
    const midPath = dual.mid
      ? `${userId}/${resolvedDraftId}/${type}/${baseId}-1280.${midExt}`
      : null;
    const thumbPath = dual.thumb
      ? `${userId}/${resolvedDraftId}/${type}/${baseId}-320.${thumbExt}`
      : null;

    // Upload mid first (Vision can use it sooner), then thumb + original in parallel.
    let midUrl: string | null = null;
    let thumbUrl: string | null = null;

    if (midPath && dual.mid) {
      const { error: midErr } = await supabase.storage
        .from("product-images")
        .upload(midPath, dual.mid, {
          contentType: dual.mid.type || "image/jpeg",
          upsert: false
        });
      if (!midErr) {
        midUrl = supabase.storage.from("product-images").getPublicUrl(midPath).data.publicUrl;
      }
    }

    if (thumbPath && dual.thumb) {
      const { error: thumbErr } = await supabase.storage
        .from("product-images")
        .upload(thumbPath, dual.thumb, {
          contentType: dual.thumb.type || "image/jpeg",
          upsert: false
        });
      if (!thumbErr) {
        thumbUrl = supabase.storage.from("product-images").getPublicUrl(thumbPath).data
          .publicUrl;
      }
    }

    const { error: storageError } = await supabase.storage
      .from("product-images")
      .upload(origPath, file, {
        contentType: file.type || "image/jpeg",
        upsert: false
      });

    if (storageError) {
      // Best-effort cleanup of derivatives already uploaded
      const toRemove = [midPath, thumbPath].filter(Boolean) as string[];
      if (toRemove.length) {
        await supabase.storage.from("product-images").remove(toRemove).catch(() => null);
      }
      patchPreview(clientKey, type, {
        status: "failed",
        errorMessage: storageError.message,
        file
      });
      // UX-I T55: op fail → toast (thumb already shows 失敗)
      const msg = `上傳失敗：${storageError.message}`;
      setMessage(msg);
      showToast(msg, "error");
      return;
    }

    const { data } = supabase.storage.from("product-images").getPublicUrl(origPath);
    const originalUrl = data.publicUrl;

    // T22: if user reordered while uploading, write the live local sort_order.
    const liveSort = currentSortOrder(clientKey, type, sortOrder);

    // Prefer writing dual-size columns; if migration 039 not applied, fall back without them.
    const baseInsert = {
      draft_id: resolvedDraftId,
      image_type: type,
      original_file_url: originalUrl,
      processed_file_url: originalUrl,
      sort_order: liveSort,
      processing_status: "uploaded" as const
    };

    let row: Record<string, unknown> | null = null;
    let insertError: { message: string } | null = null;

    const withDual = {
      ...baseInsert,
      list_thumb_url: thumbUrl,
      vision_mid_url: midUrl
    };

    const first = await supabase
      .from("product_images")
      .insert(withDual)
      .select(
        "id, original_file_url, processed_file_url, list_thumb_url, vision_mid_url, sort_order, process_intent, is_spec_process"
      )
      .single();

    if (first.error) {
      const msg = first.error.message ?? "";
      const missingCols =
        /list_thumb_url|vision_mid_url|column/i.test(msg) ||
        /schema cache/i.test(msg);
      if (missingCols) {
        const second = await supabase
          .from("product_images")
          .insert(baseInsert)
          .select(
            "id, original_file_url, processed_file_url, sort_order, process_intent, is_spec_process"
          )
          .single();
        row = (second.data as Record<string, unknown> | null) ?? null;
        insertError = second.error;
        if (!second.error) {
          // Keep derivative files even if DB can't store URLs yet — still serve via original.
          midUrl = null;
          thumbUrl = null;
        }
      } else {
        insertError = first.error;
      }
    } else {
      row = (first.data as Record<string, unknown> | null) ?? null;
    }

    if (insertError || !row) {
      const msg = insertError?.message ?? "未知錯誤";
      const full = `圖片檔案已上傳，但寫入資料庫失敗：${msg}`;
      patchPreview(clientKey, type, {
        status: "failed",
        errorMessage: `寫入資料庫失敗：${msg}`,
        file
      });
      setMessage(full);
      showToast(full, "error");
      return;
    }

    const listUrl =
      (typeof row.list_thumb_url === "string" && row.list_thumb_url) ||
      thumbUrl ||
      (row.processed_file_url as string | null) ||
      (row.original_file_url as string | null) ||
      originalUrl;

    patchPreview(clientKey, type, {
      id: row.id as string,
      url: listUrl as string,
      sort_order: (row.sort_order as number) ?? liveSort,
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

  async function uploadFiles(type: ImageType, fileList: FileList | File[] | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/") || !f.type);
    // Accept empty type (some OS clipboard) only if file looks like image by name, else filter image/*
    const imageFiles = files.filter((f) => !f.type || f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setMessage(`上傳 ${type === "main" ? "主圖" : "詳情圖"} 中…`);
    setMarkError("");

    const startIndex = previews[type]?.length ?? 0;
    const pending: PreviewItem[] = imageFiles.map((file, index) => {
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
        const msg = "無法建立商品草稿，圖片尚未上傳，請稍後再試。";
        setMessage(msg);
        showToast(msg, "error");
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

      // UX-A T24: transient success → toast (do not pin form height)
      setMessage("");
      showToast("圖片已寫入資料庫", "success");
    })();

    trackUpload?.(task);
    try {
      await task;
    } finally {
      endUpload();
    }
  }

  const uploadFilesRef = useRef(uploadFiles);
  uploadFilesRef.current = uploadFiles;

  useImperativeHandle(ref, () => ({
    uploadMainFiles: (files) => uploadFilesRef.current("main", files)
  }));

  function handleZonePaste(type: ImageType, event: ClipboardEvent) {
    const images = imageFilesFromClipboard(event.clipboardData);
    if (images.length === 0) return; // plain text → do not intercept
    event.preventDefault();
    event.stopPropagation();
    void uploadFiles(type, images);
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
        sortOrder: currentSortOrder(item.clientKey, type, item.sort_order),
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
    // UX-H T49: brief fade before remove (display only)
    setFadingKeys((prev) => new Set(prev).add(item.clientKey));
    await new Promise((r) => window.setTimeout(r, 250));

    if (!item.id) {
      removePreviewLocal(item.clientKey, item.imageType);
      setFadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(item.clientKey);
        return next;
      });
      return;
    }

    // Best-effort storage remove first (path derived from public URL).
    const path = storagePathFromPublicUrl(item.url);
    if (path) {
      await supabase.storage.from("product-images").remove([path]).catch(() => null);
    }

    const { error } = await supabase.from("product_images").delete().eq("id", item.id);
    if (error) {
      const msg = `刪除失敗：${error.message}`;
      setMarkError(msg);
      // UX-D T21: strengthen delete-fail feedback
      showToast(msg, "error");
      setFadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(item.clientKey);
        return next;
      });
      return;
    }
    removePreviewLocal(item.clientKey, item.imageType);
    setFadingKeys((prev) => {
      const next = new Set(prev);
      next.delete(item.clientKey);
      return next;
    });
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
      const msg = `標記失敗：${error.message}`;
      setMarkError(msg);
      showToast(msg, "error");
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

  /** UX-D T22: reorder list locally, reindex sort_order, persist rows with id. */
  async function applyReorder(type: ImageType, fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    const list = [...(previewsRef.current[type] ?? [])];
    const fromIdx = list.findIndex((r) => r.clientKey === fromKey);
    const toIdx = list.findIndex((r) => r.clientKey === toKey);
    if (fromIdx < 0 || toIdx < 0) return;

    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    const reindexed = list.map((item, index) => ({ ...item, sort_order: index }));

    setPreviews((current) => ({ ...current, [type]: reindexed }));

    const withIds = reindexed.filter((item) => item.id);
    if (withIds.length === 0) return;

    const results = await Promise.all(
      withIds.map((item) =>
        supabase.from("product_images").update({ sort_order: item.sort_order }).eq("id", item.id!)
      )
    );
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      const msg = `排序儲存失敗：${firstErr.message}`;
      setMarkError(msg);
      showToast(msg, "error");
    }
  }

  const mainItems = previews.main ?? [];

  return (
    <div className="drop-grid">
      {zones.map((zone) => {
        const items = previews[zone.type] ?? [];
        const count = items.length;
        const readyCount = items.filter((i) => i.status === "ready").length;
        return (
          <div
            className="upload-section"
            key={zone.type}
            onPaste={(event) => handleZonePaste(zone.type, event)}
          >
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
                void uploadFiles(zone.type, event.dataTransfer.files);
              }}
              onPaste={(event) => handleZonePaste(zone.type, event)}
              tabIndex={0}
            >
              <input
                accept="image/*"
                multiple
                onChange={(event) => void uploadFiles(zone.type, event.currentTarget.files)}
                type="file"
              />
              <div className="dz-icon">{zone.icon}</div>
              <div className="dz-text">
                <div className="dz-title">{zone.dropTitle}</div>
                <div className="dz-hint muted">可 Ctrl+V 貼上</div>
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
                  const isDragging = reorderDrag?.clientKey === item.clientKey;
                  const isOver = reorderOverKey === item.clientKey && reorderDrag?.clientKey !== item.clientKey;
                  return (
                    <div
                      className={`pthumb${isFirstMain ? " is-main" : ""}${item.status === "failed" ? " pthumb-failed" : ""}${isDragging ? " pthumb-dragging" : ""}${isOver ? " pthumb-drag-over" : ""}${fadingKeys.has(item.clientKey) ? " is-fading" : ""}`}
                      draggable
                      key={item.clientKey}
                      onDragEnd={() => {
                        setReorderDrag(null);
                        setReorderOverKey(null);
                      }}
                      onDragLeave={() => {
                        setReorderOverKey((cur) => (cur === item.clientKey ? null : cur));
                      }}
                      onDragOver={(event) => {
                        if (!reorderDrag || reorderDrag.type !== zone.type) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setReorderOverKey(item.clientKey);
                      }}
                      onDragStart={(event) => {
                        // Avoid starting file-drop on the label while reordering thumbs.
                        event.stopPropagation();
                        event.dataTransfer.effectAllowed = "move";
                        try {
                          event.dataTransfer.setData("text/plain", item.clientKey);
                        } catch {
                          /* ignore */
                        }
                        setReorderDrag({ type: zone.type, clientKey: item.clientKey });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const fromKey = reorderDrag?.clientKey;
                        const fromType = reorderDrag?.type;
                        setReorderDrag(null);
                        setReorderOverKey(null);
                        if (!fromKey || fromType !== zone.type) return;
                        void applyReorder(zone.type, fromKey, item.clientKey);
                      }}
                    >
                      <span className="pthumb-img-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={zone.label} className="thumb pthumb-img" src={item.url} />
                        {isFirstMain ? <span className="pthumb-badge">主圖</span> : null}
                        {/* UX-B2-P10: 規格圖 → corner badge (same language as station②) */}
                        {isMainZone && item.status === "ready" ? (
                          <button
                            type="button"
                            aria-pressed={item.is_spec_process}
                            className={`pthumb-spec-badge${item.is_spec_process ? " active" : ""}`}
                            title={item.is_spec_process ? "取消規格圖標記" : "標示為規格圖"}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void toggleSpecMark(item);
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                          >
                            {item.is_spec_process ? "📐 規格圖" : "規格圖"}
                          </button>
                        ) : null}
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
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
      {/* UX-D T23: short form-side tip only; process-intent hard gate stays at station ② / B5. */}
      {mainItems.length > 0 ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          主圖右上角可標規格圖
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
});
