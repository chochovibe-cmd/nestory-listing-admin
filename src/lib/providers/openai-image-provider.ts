/**
 * D4: OpenAI Images API (generate + edit).
 *
 * - de_text  → POST /v1/images/edits (inpainting-style text removal prompt)
 * - regenerate → POST /v1/images/generations (title + image_description)
 *
 * Env (all optional except OPENAI_API_KEY via process):
 *   OPENAI_IMAGE_MODEL          default gpt-image-1
 *   OPENAI_IMAGE_SIZE           default 1024x1024
 *   OPENAI_IMAGE_QUALITY        default medium (gpt-image-1)
 *   OPENAI_IMAGE_EDIT_SUPPORTED true|false — force edit capability; default inferred from model
 *
 * Models that cannot edit (e.g. dall-e-3) → de_text fails honestly.
 * Never invents fake image bytes/URLs.
 */

import { fetchServerImage } from "@/lib/images/fetchServerImage";
import type { ImageProvider, ImageProviderInput, ImageProviderOutput } from "@/lib/providers/image";

const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_SIZE = "1024x1024";
const DEFAULT_QUALITY = "medium";

/** Models known NOT to support /v1/images/edits. */
const EDIT_UNSUPPORTED_MODELS = new Set(["dall-e-3", "dall-e-3-hd"]);

export function getOpenAiImageModel(): string {
  return (process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

export function getOpenAiImageSize(): string {
  return (process.env.OPENAI_IMAGE_SIZE || DEFAULT_SIZE).trim() || DEFAULT_SIZE;
}

export function getOpenAiImageQuality(): string {
  return (process.env.OPENAI_IMAGE_QUALITY || DEFAULT_QUALITY).trim() || DEFAULT_QUALITY;
}

/**
 * Whether the configured model can run de_text via images/edits.
 * OPENAI_IMAGE_EDIT_SUPPORTED=false|0 forces off; true|1 forces on.
 */
export function modelSupportsImageEdit(model?: string): boolean {
  const flag = process.env.OPENAI_IMAGE_EDIT_SUPPORTED?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return false;
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  const m = (model || getOpenAiImageModel()).trim().toLowerCase();
  return !EDIT_UNSUPPORTED_MODELS.has(m);
}

export function buildDeTextPrompt(extra?: string | null): string {
  const base =
    "Remove all on-image text overlays, watermarks, Chinese simplified characters, " +
    "promotional badges, and price stickers. Keep the product itself, colors, shape, " +
    "and composition unchanged. Do not add new logos or text. Photorealistic product photo.";
  const extraTrim = extra?.trim();
  return extraTrim ? `${base} Additional note: ${extraTrim.slice(0, 200)}` : base;
}

/**
 * SYN-1: convert on-image Simplified Chinese → Traditional (Taiwan), leave rest unchanged.
 */
export function buildToTradPrompt(extra?: string | null): string {
  const base =
    "Convert ALL Simplified Chinese characters on this product image to Traditional Chinese " +
    "(Taiwan 繁體中文). Keep every other visual element unchanged: product shape, colors, " +
    "layout, logos, photos, and composition. Do not remove text — only convert 简体→繁體. " +
    "Do not add new badges, watermarks, or decorative text. Photorealistic product photo.";
  const extraTrim = extra?.trim();
  return extraTrim ? `${base} Additional note: ${extraTrim.slice(0, 200)}` : base;
}

/**
 * Q5-A: regenerate uses title + image_description; empty description → still try with warning.
 */
export function buildRegeneratePrompt(input: {
  title?: string | null;
  imageDescription?: string | null;
  prompt?: string | null;
}): { prompt: string; warning?: string } {
  if (input.prompt?.trim()) {
    return { prompt: input.prompt.trim().slice(0, 3200) };
  }

  const title = input.title?.trim() || "";
  const desc = input.imageDescription?.trim() || "";
  const parts: string[] = [
    "Create a clean e-commerce product photo for a Taiwan anime merchandise store (潮巢 Nestory).",
    "White or soft studio background, centered product, no Chinese simplified text overlays, no watermarks, no price tags.",
    "Photorealistic, high detail, square-friendly composition."
  ];

  if (title) parts.push(`Product title: ${title.slice(0, 200)}`);
  if (desc) parts.push(`Visual description: ${desc.slice(0, 1200)}`);

  let warning: string | undefined;
  if (!desc && !title) {
    warning = "regenerate: missing title and image_description; using generic product prompt";
  } else if (!desc) {
    warning = "regenerate: empty image_description; used title only (Q5-A)";
  }

  return { prompt: parts.join("\n").slice(0, 3200), warning };
}

/** Rough USD estimate for logging only (not billing). Env can override unit costs later. */
export function estimateImageCostUsd(model: string, quality: string, size = "1024x1024"): number {
  const m = model.toLowerCase();
  if (m.startsWith("gpt-image-2")) {
    const portraitLike = size !== "1024x1024";
    if (quality === "high") return portraitLike ? 0.165 : 0.211;
    if (quality === "low") return portraitLike ? 0.005 : 0.006;
    return portraitLike ? 0.041 : 0.053;
  }
  if (m.includes("gpt-image-1-mini")) {
    if (quality === "high") return 0.036;
    if (quality === "low") return 0.005;
    return 0.011;
  }
  if (m.includes("gpt-image")) {
    if (quality === "high") return 0.167;
    if (quality === "low") return 0.011;
    return 0.042;
  }
  if (m.includes("dall-e-3")) return 0.04;
  return 0.04;
}

async function fetchSourceImage(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const fetched = await fetchServerImage(url, { maxBytes: 25 * 1024 * 1024 });
  if (!fetched.ok) throw new Error(fetched.message);
  return { buffer: fetched.bytes, mimeType: fetched.contentType };
}

function pickExtension(mimeType: string): string {
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("gif")) return "gif";
  return "png";
}

async function callImagesGenerations(input: {
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  quality: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    n: 1,
    size: input.size
  };
  // gpt-image-1 uses quality; older models may ignore or error — only send for gpt-image*
  if (input.model.toLowerCase().includes("gpt-image")) {
    body.quality = input.quality;
  } else if (input.model.toLowerCase().includes("dall-e-3")) {
    body.quality = input.quality === "high" ? "hd" : "standard";
    body.response_format = "b64_json";
  } else {
    body.response_format = "b64_json";
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI images/generations failed (${response.status}): ${errText.slice(0, 400)}`);
  }

  const payload = await response.json();
  // gpt-image-1 often returns b64_json by default
  const data = payload?.data?.[0];
  if (data?.b64_json) {
    return { bytes: Buffer.from(data.b64_json, "base64"), mimeType: "image/png" };
  }
  if (data?.url) {
    const fetched = await fetchSourceImage(data.url);
    return { bytes: fetched.buffer, mimeType: fetched.mimeType };
  }
  throw new Error("OpenAI images/generations: no b64_json or url in response");
}

async function callImagesEdits(input: {
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  images: Array<{ buffer: Buffer; mimeType: string }>;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const form = new FormData();
  form.append("model", input.model);
  form.append("prompt", input.prompt);
  form.append("n", "1");
  form.append("size", input.size);
  if (input.model.toLowerCase().includes("gpt-image")) {
    form.append("quality", input.quality);
  } else {
    form.append("response_format", "b64_json");
  }

  if (input.images.length === 0) {
    throw new Error("OpenAI images/edits requires at least one source image");
  }
  input.images.slice(0, 4).forEach((source, index) => {
    const ext = pickExtension(source.mimeType);
    const blob = new Blob([new Uint8Array(source.buffer)], {
      type: source.mimeType.startsWith("image/") ? source.mimeType : "image/png"
    });
    const field =
      input.model.toLowerCase().startsWith("gpt-image-2") || input.images.length > 1
        ? "image[]"
        : "image";
    form.append(field, blob, `source-${index + 1}.${ext}`);
  });

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI images/edits failed (${response.status}): ${errText.slice(0, 400)}`);
  }

  const payload = await response.json();
  const data = payload?.data?.[0];
  if (data?.b64_json) {
    return { bytes: Buffer.from(data.b64_json, "base64"), mimeType: "image/png" };
  }
  if (data?.url) {
    const fetched = await fetchSourceImage(data.url);
    return { bytes: fetched.buffer, mimeType: fetched.mimeType };
  }
  throw new Error("OpenAI images/edits: no b64_json or url in response");
}

export class OpenAiImageProvider implements ImageProvider {
  name = "openai-image";

  async process(input: ImageProviderInput): Promise<ImageProviderOutput> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured on the server.");
    }

    const model = getOpenAiImageModel();
    const size = input.size?.trim() || getOpenAiImageSize();
    const quality = input.quality?.trim() || getOpenAiImageQuality();
    const task = input.task === "generate" ? "regenerate" : input.task;

    if (
      task === "de_text" ||
      task === "to_trad" ||
      task === "square_ai" ||
      task === "hero_enhance" ||
      task === "creative_hero" ||
      task === "ad_creative"
    ) {
      if (!modelSupportsImageEdit(model)) {
        throw new Error(
          `${task} requires an edit-capable model (images/edits). Current OPENAI_IMAGE_MODEL=${model} cannot edit.`
        );
      }
      const sourceUrls = input.sourceImages.map((url) => url.trim()).filter(Boolean).slice(0, 4);
      if (!sourceUrls.length) {
        throw new Error(`${task} requires at least one source image`);
      }
      const sources = await Promise.all(sourceUrls.map((url) => fetchSourceImage(url)));
      let prompt: string;
      if (task === "to_trad") {
        prompt = buildToTradPrompt(input.prompt);
      } else if (task === "de_text") {
        prompt = buildDeTextPrompt(input.prompt);
      } else {
        prompt = input.prompt?.trim() || "";
        if (!prompt) throw new Error(`${task} requires a skill prompt`);
      }
      const out = await callImagesEdits({
        apiKey,
        model,
        prompt,
        size,
        quality,
        images: sources
      });
      return {
        resultBytes: out.bytes,
        mimeType: out.mimeType,
        provider: this.name,
        model,
        cost: estimateImageCostUsd(model, quality, size)
      };
    }

    if (task === "regenerate") {
      const built = buildRegeneratePrompt({
        title: input.title,
        imageDescription: input.imageDescription,
        prompt: input.prompt
      });
      const out = await callImagesGenerations({
        apiKey,
        model,
        prompt: built.prompt,
        size,
        quality
      });
      return {
        resultBytes: out.bytes,
        mimeType: out.mimeType,
        provider: this.name,
        model,
        cost: estimateImageCostUsd(model, quality, size),
        warning: built.warning
      };
    }

    throw new Error(`OpenAiImageProvider does not support task=${input.task} in D4`);
  }
}

export function createOpenAiImageProvider(): ImageProvider {
  return new OpenAiImageProvider();
}
