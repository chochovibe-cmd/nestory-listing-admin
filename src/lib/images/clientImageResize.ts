/**
 * A19: browser-side dual-size resize for product uploads.
 * - list thumb: max long edge 320
 * - vision mid: max long edge 1280
 * Falls back to original file when canvas / decode fails (honest degrade).
 */

export const LIST_THUMB_MAX_EDGE = 320;
export const VISION_MID_MAX_EDGE = 1280;

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
