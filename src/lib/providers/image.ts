export type ImageProviderTask = "generate" | "translate_text" | "remove_bg" | "outpaint_square";

export interface ImageProviderInput {
  sourceImages: string[];
  imageType: "main" | "detail" | "spec";
  task: ImageProviderTask;
  prompt?: string;
  imageDescription?: string;
}

export interface ImageProviderOutput {
  resultUrl: string;
  provider: string;
  model: string;
  cost?: number;
}

export interface ImageProvider {
  name: string;
  process(input: ImageProviderInput): Promise<ImageProviderOutput>;
}
