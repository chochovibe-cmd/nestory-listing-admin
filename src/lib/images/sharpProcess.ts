/**
 * D3: pure image transform helpers (server-only).
 *
 * Import sharp ONLY from this module or API routes under /api/images/*.
 * Never import this file from client components.
 *
 * Spec (D-open Q1-A):
 * - Long edge ≤ 2048, fit: inside (no upscale past original)
 * - Default: keep aspect ratio (square optional, default false)
 * - SHOP-LISTING: squareMode "blur-extend" pads non-square images to a square canvas
 *   with a blurred, cover-cropped copy of the image as background
 * - EXIF orientation applied via rotate()
 * - Output WebP quality ≈ 82
 */

import sharp from "sharp";

/** Max long-edge pixels for product pipeline images. */
export const SHARP_MAX_LONG_EDGE = 2048;

/** WebP quality target (≈82). */
export const SHARP_WEBP_QUALITY = 82;

/** Width/height difference (relative to the long edge) still treated as already square. */
export const SQUARE_TOLERANCE = 0.02;

/** blur sigma = max(8, round(canvasSize / this)). */
export const SQUARE_BLUR_SIGMA_DIVISOR = 40;

/** Hard cap for one sharp-batch request (one draft). */
export const SHARP_BATCH_MAX_IMAGES = 12;

export type SquareMode = "none" | "cover" | "blur-extend";

export type SharpProcessOptions = {
  /**
   * Square handling. "none" (default) keeps aspect; "cover" center-crops to square;
   * "blur-extend" pads to a square with a blurred copy of the image (no crop of the subject).
   * Takes precedence over the legacy `square` flag when given.
   */
  squareMode?: SquareMode;
  /** Legacy: center-cover crop to square. `square: true` === `squareMode: "cover"`. */
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
  const squareMode: SquareMode = options.squareMode ?? (options.square === true ? "cover" : "none");

  if (squareMode === "blur-extend") {
    return processBlurExtend(input, maxLongEdge, quality);
  }

  // rotate() with no args applies EXIF orientation and strips the tag.
  let pipeline = sharp(input, { failOn: "none" }).rotate();

  if (squareMode === "cover") {
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

/**
 * blur-extend: non-square image → square canvas whose background is a blurred,
 * cover-cropped copy of the image and whose foreground is the whole image (inside).
 * Near-square images (within SQUARE_TOLERANCE) take the plain inside-resize path.
 */
async function processBlurExtend(
  input: Buffer,
  maxLongEdge: number,
  quality: number
): Promise<SharpProcessResult> {
  // Orientation-corrected pixels first, so EXIF width/height swaps cannot skew the maths.
  // Raw output keeps this intermediate step lossless; clamping to the long-edge cap first
  // keeps the raw buffer small for huge sources (an 8000px RGBA raw would be ~256MB).
  const rotated = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(maxLongEdge, maxLongEdge, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = rotated.info;
  const rawInput = { raw: { width: w, height: h, channels } } as const;

  if (Math.abs(w - h) / Math.max(w, h) <= SQUARE_TOLERANCE) {
    const out = await sharp(rotated.data, rawInput)
      .resize(maxLongEdge, maxLongEdge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: out.data,
      width: out.info.width,
      height: out.info.height,
      format: "webp",
      bytes: out.data.length
    };
  }

  const size = Math.min(maxLongEdge, Math.max(w, h));
  const base = () => {
    const img = sharp(rotated.data, rawInput);
    return (channels === 2 || channels === 4) ? img.flatten({ background: "#ffffff" }) : img;
  };

  const background = await base()
    .resize(size, size, { fit: "cover", position: "centre" })
    .blur(Math.max(8, Math.round(size / SQUARE_BLUR_SIGMA_DIVISOR)))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const foreground = await base()
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = await sharp(background.data, {
    raw: {
      width: background.info.width,
      height: background.info.height,
      channels: background.info.channels
    }
  })
    .composite([
      {
        input: foreground.data,
        raw: {
          width: foreground.info.width,
          height: foreground.info.height,
          channels: foreground.info.channels
        },
        gravity: "centre"
      }
    ])
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });

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
