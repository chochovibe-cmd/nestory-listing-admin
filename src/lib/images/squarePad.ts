import sharp from "sharp";
import { SHARP_MAX_LONG_EDGE, SHARP_WEBP_QUALITY } from "@/lib/images/sharpProcess";

export type SquarePadBackground = "cream" | "white" | "black";

const BACKGROUNDS: Record<SquarePadBackground, { r: number; g: number; b: number; alpha: number }> = {
  cream: { r: 250, g: 248, b: 243, alpha: 1 },
  white: { r: 255, g: 255, b: 255, alpha: 1 },
  black: { r: 18, g: 18, b: 18, alpha: 1 }
};

export async function padImageToSquare(
  input: Buffer,
  options: {
    background?: SquarePadBackground;
    maxSize?: number;
    quality?: number;
  } = {}
): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
}> {
  const maxSize = Math.max(256, Math.min(options.maxSize ?? SHARP_MAX_LONG_EDGE, SHARP_MAX_LONG_EDGE));
  const quality = Math.max(50, Math.min(options.quality ?? SHARP_WEBP_QUALITY, 95));
  const background = BACKGROUNDS[options.background ?? "cream"];

  const normalized = await sharp(input, { failOn: "none" }).rotate().toBuffer();
  const meta = await sharp(normalized).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("Unable to read image dimensions.");

  const longest = Math.max(width, height);
  const target = Math.min(longest, maxSize);
  const scale = longest > target ? target / longest : 1;
  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));

  const resized = await sharp(normalized)
    .resize(resizedWidth, resizedHeight, {
      fit: "fill",
      withoutEnlargement: true
    })
    .webp({ quality })
    .toBuffer();

  const out = await sharp({
    create: {
      width: target,
      height: target,
      channels: 4,
      background
    }
  })
    .composite([{ input: resized, gravity: "centre" }])
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: out.data,
    width: out.info.width,
    height: out.info.height,
    bytes: out.data.length
  };
}
