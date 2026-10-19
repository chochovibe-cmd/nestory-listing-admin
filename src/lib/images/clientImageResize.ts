/**
 * A19: browser-side dual-size resize for product uploads.
 * - list thumb: max long edge 320
 * - vision mid: max long edge 1280
 * - SHOP-LISTING: upload copy shrunk to max long edge 2048 WebP (buildUploadBlobs)
 * Falls back to original file when canvas / decode fails (honest degrade).
 */

export const LIST_THUMB_MAX_EDGE = 320;
export const VISION_MID_MAX_EDGE = 1280;

/** SHOP-LISTING: long edge of the copy that is uploaded as the "original". */
export const UPLOAD_MAX_EDGE = 2048;
export const UPLOAD_WEBP_QUALITY = 0.9;
/** JPEG/WebP files at or under this size (and within maxEdge) are uploaded untouched. */
export const UPLOAD_PASSTHROUGH_MAX_BYTES = 800 * 1024;
/** How many images are uploaded at the same time. */
export const UPLOAD_CONCURRENCY = 4;

export type DualSizeBlobs = {
  /** Always the original File (unchanged). */
  original: File;
  /** ~1280 long-edge JPEG/WebP; null if resize failed. */
  mid: Blob | null;
  /** ~320 long-edge JPEG/WebP; null if resize failed. */
  thumb: Blob | null;
};

function pickOutputType(file: File): { type: string; quality: number; ext: string } {
  // Prefer webp when browser supports; jpeg otherwise. Keep png only if source is png
  // and we want lossless — for product photos jpeg/webp is enough and much smaller.
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    if (canvas.toDataURL("image/webp").startsWith("data:image/webp")) {
      return { type: "image/webp", quality: 0.82, ext: "webp" };
    }
  }
  if (file.type === "image/png") {
    return { type: "image/jpeg", quality: 0.88, ext: "jpg" };
  }
  return { type: "image/jpeg", quality: 0.85, ext: "jpg" };
}

/**
 * Resize image File so the longer edge ≤ maxEdge (never upscales).
 * Returns null on any failure (caller keeps using original).
 */
export async function resizeImageToMaxEdge(
  file: File,
  maxEdge: number,
  options?: { quality?: number; type?: string }
): Promise<Blob | null> {
  if (typeof window === "undefined") return null;
  if (!file.type.startsWith("image/") && file.type !== "") return null;
  if (maxEdge < 16) return null;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const w = bitmap.width;
      const h = bitmap.height;
      if (!w || !h) return null;

      const longEdge = Math.max(w, h);
      // Already small enough → still re-encode lightly for consistent format, or skip
      const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
      const outW = Math.max(1, Math.round(w * scale));
      const outH = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, outW, outH);

      const picked = pickOutputType(file);
      const type = options?.type ?? picked.type;
      const quality = options?.quality ?? picked.quality;

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), type, quality);
      });
      return blob;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** Build mid (1280) + thumb (320) in parallel; never throws. */
export async function buildDualSizeBlobs(file: File): Promise<DualSizeBlobs> {
  const [mid, thumb] = await Promise.all([
    resizeImageToMaxEdge(file, VISION_MID_MAX_EDGE),
    resizeImageToMaxEdge(file, LIST_THUMB_MAX_EDGE)
  ]);
  return { original: file, mid, thumb };
}

export function dualSizeExt(blob: Blob | null, fallbackFile: File): string {
  if (blob?.type === "image/webp") return "webp";
  if (blob?.type === "image/jpeg") return "jpg";
  if (blob?.type === "image/png") return "png";
  const fromName = fallbackFile.name.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  return "jpg";
}

/**
 * Pure decision: can this file be uploaded as-is (no re-encode)?
 * Only small jpeg/webp files within maxEdge qualify.
 */
export function decideUploadPassthrough(input: {
  type: string;
  size: number;
  longEdge: number;
  maxEdge: number;
}): boolean {
  const isJpegOrWebp = input.type === "image/jpeg" || input.type === "image/webp";
  return (
    isJpegOrWebp &&
    input.longEdge <= input.maxEdge &&
    input.size <= UPLOAD_PASSTHROUGH_MAX_BYTES
  );
}

export type UploadBlobs = {
  /** 要上傳當「原檔」的 blob（多半是 2048 WebP；不需縮時就是原 File） */
  upload: Blob;
  uploadExt: string;
  uploadContentType: string;
  shrunk: boolean;
  /** 1280 long edge, same as buildDualSizeBlobs. */
  mid: Blob | null;
  /** 320 long edge, same as buildDualSizeBlobs. */
  thumb: Blob | null;
};

function canEncodeWebp(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

async function encodeBitmap(
  bitmap: ImageBitmap,
  maxEdge: number,
  type: string,
  quality: number
): Promise<Blob | null> {
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    const longEdge = Math.max(w, h);
    const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), type, quality);
    });
  } catch {
    return null;
  }
}

function fileExt(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5 && fromName !== file.name.toLowerCase()) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

function passthroughUpload(file: File, mid: Blob | null, thumb: Blob | null): UploadBlobs {
  return {
    upload: file,
    uploadExt: fileExt(file),
    uploadContentType: file.type || "image/jpeg",
    shrunk: false,
    mid,
    thumb
  };
}

/**
 * SHOP-LISTING: decode the file once and build the upload copy (≤ maxEdge WebP)
 * plus the 1280 / 320 derivatives. Never throws; every failure degrades to the
 * original File (shrunk=false) and null mid/thumb.
 */
export async function buildUploadBlobs(
  file: File,
  options?: { maxEdge?: number }
): Promise<UploadBlobs> {
  const maxEdge = options?.maxEdge ?? UPLOAD_MAX_EDGE;
  const fallback = () => passthroughUpload(file, null, null);

  try {
    if (typeof window === "undefined") return fallback();
    if (!file.type.startsWith("image/") && file.type !== "") return fallback();

    const bitmap = await createImageBitmap(file);
    try {
      const w = bitmap.width;
      const h = bitmap.height;
      if (!w || !h) return fallback();

      const webpOk = canEncodeWebp();
      const picked = pickOutputType(file);
      const [mid, thumb] = await Promise.all([
        encodeBitmap(bitmap, VISION_MID_MAX_EDGE, picked.type, picked.quality),
        encodeBitmap(bitmap, LIST_THUMB_MAX_EDGE, picked.type, picked.quality)
      ]);

      if (file.type === "image/gif" || !webpOk) return passthroughUpload(file, mid, thumb);
      if (
        decideUploadPassthrough({
          type: file.type,
          size: file.size,
          longEdge: Math.max(w, h),
          maxEdge
        })
      ) {
        return passthroughUpload(file, mid, thumb);
      }

      const shrunkBlob = await encodeBitmap(bitmap, maxEdge, "image/webp", UPLOAD_WEBP_QUALITY);
      if (!shrunkBlob || shrunkBlob.type !== "image/webp" || shrunkBlob.size >= file.size) {
        return passthroughUpload(file, mid, thumb);
      }
      return {
        upload: shrunkBlob,
        uploadExt: "webp",
        uploadContentType: shrunkBlob.type || "image/webp",
        shrunk: true,
        mid,
        thumb
      };
    } finally {
      bitmap.close();
    }
  } catch {
    return fallback();
  }
}
