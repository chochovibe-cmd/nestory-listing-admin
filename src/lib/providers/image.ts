/**
 * Image processing provider interface (D4).
 * Real implementation: openai-image-provider.ts
 */

export type ImageProviderTask =
  | "de_text"
  | "regenerate"
  /** SYN-1: simplified → traditional on-image text via images/edits */
  | "to_trad"
  /** @deprecated prefer de_text / regenerate; kept for older stubs */
  | "generate"
  | "translate_text"
  | "remove_bg"
  | "outpaint_square";

export interface ImageProviderInput {
  /** Source image public URLs (de_text needs ≥1; regenerate may use as style hint only). */
  sourceImages: string[];
  imageType: "main" | "detail" | "spec" | "variant" | string;
  task: ImageProviderTask;
  prompt?: string;
  imageDescription?: string | null;
  /** Product title for regenerate prompt (Q5-A). */
  title?: string | null;
}

export interface ImageProviderOutput {
  /** Raw image bytes from the provider (preferred for Storage upload). */
  resultBytes: Buffer;
  mimeType: string;
  /** Optional remote URL if provider returned one instead of bytes. */
  resultUrl?: string;
  provider: string;
  model: string;
  cost?: number;
  /** Non-fatal note (e.g. empty image_description for regenerate). */
  warning?: string;
}

export interface ImageProvider {
  name: string;
  process(input: ImageProviderInput): Promise<ImageProviderOutput>;
}

/** Tasks that D4 ai-process actually runs. */
export function isD4ImageTask(
  task: string
): task is "de_text" | "regenerate" | "to_trad" {
  return task === "de_text" || task === "regenerate" || task === "to_trad";
}
