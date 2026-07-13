/**
 * D3: pure image transform helpers (server-only).
 *
 * Import sharp ONLY from this module or API routes under /api/images/*.
 * Never import this file from client components.
 *
 * Spec (D-open Q1-A):
 * - Long edge ≤ 2048, fit: inside (no upscale past original)
 * - Default: keep aspect ratio (square optional, default false)
 * - EXIF orientation applied via rotate()
 * - Output WebP quality ≈ 82
 */

import sharp from "sharp";

/** Max long-edge pixels for product pipeline images. */
export const SHARP_MAX_LONG_EDGE = 2048;

/** WebP quality target (≈82). */
export const SHARP_WEBP_QUALITY = 82;

/** Hard cap for one sharp-batch request (one draft). */
export const SHARP_BATCH_MAX_IMAGES = 12;

export type SharpProcessOptions = {
  /** Center-cover crop to square. Default false (Q1-A: keep aspect). */
  square?: boolean;
  /** Override long-edge cap. */
  maxLongEdge?: number;
  /** Override WebP quality. */
  quality?: number;
};

export type SharpProcessResult = {
  buffer: Buffer;
  width: number;
  height: number;
  format: "webp";
  bytes: number;
};

/**
 * Transform an image buffer into pipeline WebP.
 * Does not touch network or DB — pure CPU work for unit tests / API.
 */
export async function processImageBuffer(
  input: Buffer,
  options: SharpProcessOptions = {}
): Promise<SharpProcessResult> {
  const maxLongEdge = options.maxLongEdge ?? SHARP_MAX_LONG_EDGE;
  const quality = options.quality ?? SHARP_WEBP_QUALITY;
  const square = options.square === true;

  // rotate() with no args applies EXIF orientation and strips the tag.
  let pipeline = sharp(input, { failOn: "none" }).rotate();

  if (square) {
    // Optional path: center cover → square, then clamp long edge.
    pipeline = pipeline.resize(maxLongEdge, maxLongEdge, {
      fit: "cover",
      position: "centre",
      withoutEnlargement: true
    });
  } else {
    // Q1-A default: fit inside long edge, keep aspect, never upscale.
    pipeline = pipeline.resize(maxLongEdge, maxLongEdge, {
      fit: "inside",
      withoutEnlargement: true
    });
  }

  const out = await pipeline.webp({ quality }).toBuffer({ resolveWithObject: true });

  return {
    buffer: out.data,
    width: out.info.width,
    height: out.info.height,
    format: "webp",
    bytes: out.data.length
  };
}

/** True if buffer looks like WebP (RIFF....WEBP). */
export function isWebpBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return (
    buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP"
  );
}
