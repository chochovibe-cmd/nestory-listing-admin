export type ImageSkillTask =
  | "square_pad"
  | "square_ai"
  | "hero_enhance"
  | "creative_hero"
  | "ad_creative";

export type ImageSkillQuality = "economy" | "standard";

export type ImageSkillStyle =
  | "chocho"
  | "clean"
  | "cute"
  | "tech"
  | "lifestyle";

export const IMAGE_SKILL_TASK_LABELS: Record<ImageSkillTask, string> = {
  square_pad: "免費補成方形",
  square_ai: "AI 延展成方形",
  hero_enhance: "主圖優化",
  creative_hero: "創意主圖",
  ad_creative: "AI 廣告圖"
};

export const IMAGE_SKILL_STYLE_LABELS: Record<ImageSkillStyle, string> = {
  chocho: "潮巢選物",
  clean: "清新極簡",
  cute: "可愛活潑",
  tech: "科技潮流",
  lifestyle: "生活感"
};

export function qualityForSkill(
  task: ImageSkillTask,
  quality: ImageSkillQuality
): "low" | "medium" {
  if (quality === "standard") return "medium";
  // Economy is deliberately low-cost. Human can request a V2 at standard quality.
  return "low";
}

export function sizeForSkill(task: ImageSkillTask): string {
  return task === "ad_creative" ? "1024x1280" : "1024x1024";
}

export function approximateOutputCostUsd(
  task: ImageSkillTask,
  quality: ImageSkillQuality
): number {
  if (task === "square_pad") return 0;
  const q = qualityForSkill(task, quality);
  if (task === "ad_creative") return q === "low" ? 0.005 : 0.041;
  return q === "low" ? 0.006 : 0.053;
}

function styleInstruction(style: ImageSkillStyle): string {
  switch (style) {
    case "clean":
      return "clean editorial ecommerce, quiet cream or neutral background, restrained props, generous negative space";
    case "cute":
      return "cute but tasteful, soft playful shapes, gentle color accents, not childish or cluttered";
    case "tech":
      return "clean modern tech campaign, controlled contrast, crisp lighting, minimal set design";
    case "lifestyle":
      return "warm believable lifestyle photography, natural light, human-scale context, not over-staged";
    case "chocho":
    default:
      return "Chocho Nestory selection-store style: clean, fresh, a little playful, editorial, warm, minimal colors, not Taobao-promotional";
  }
}

const PRODUCT_FIDELITY = [
  "The real product in the reference image is the source of truth.",
  "Preserve the exact product identity and physical design.",
  "Do NOT alter product count, proportions, colors, character face, printed artwork, logos, packaging, accessories, patterns, hardware, or distinctive details.",
  "Do NOT invent extra product parts.",
  "Never stretch or squash the product.",
  "If a requested aesthetic conflicts with product fidelity, preserve the product and simplify the scene instead."
].join(" ");

export function buildImageSkillPrompt(input: {
  task: Exclude<ImageSkillTask, "square_pad">;
  title?: string | null;
  imageDescription?: string | null;
  style?: ImageSkillStyle;
  instruction?: string | null;
  adHeadline?: string | null;
}): string {
  const style = styleInstruction(input.style ?? "chocho");
  const note = input.instruction?.trim();
  const title = input.title?.trim();
  const desc = input.imageDescription?.trim();

  const common = [
    PRODUCT_FIDELITY,
    "No watermarks, price tags, seller badges, fake logos, or promotional stickers.",
    "Do not render any readable text unless explicitly requested; for ad creative, leave clean space for typography that will be added later by the app.",
    `Art direction: ${style}.`
  ];

  if (input.task === "square_ai") {
    common.push(
      "Extend the canvas to a square composition without cropping the product.",
      "Preserve the original product scale as much as practical and continue or rebuild only the surrounding background.",
      "Keep the product comfortably inside safe margins and visually centered unless the user's note says otherwise."
    );
  }

  if (input.task === "hero_enhance") {
    common.push(
      "Create a polished ecommerce hero image from the primary reference.",
      "Keep the product itself faithful; improve only background, spacing, lighting balance, and presentation.",
      "Prefer a simple studio/editorial composition with generous breathing room."
    );
  }

  if (input.task === "creative_hero") {
    common.push(
      "Create one refined campaign-style hero image using all references only to understand the same product and its real-life feel.",
      "The first reference is the identity anchor. Other references may guide angle, texture, or atmosphere but must not change the product.",
      "Keep the composition suitable as a Shopify primary image: product clear, readable silhouette, uncluttered scene."
    );
  }

  if (input.task === "ad_creative") {
    common.push(
      "Create a premium 4:5 vertical advertising visual for an ecommerce product detail page.",
      "Use the product as the visual focus and create one strong selling-point composition, not a specification table.",
      "Reserve a clean negative-space area for Traditional Chinese typography to be added later by the app.",
      "Do not draw any text inside the image."
    );
    if (input.adHeadline?.trim()) {
      common.push(
        `The later typography will communicate this idea, so design the visual around it without drawing the words: ${input.adHeadline.trim().slice(0, 180)}.`
      );
    }
  }

  if (title) common.push(`Product context: ${title.slice(0, 180)}.`);
  if (desc) common.push(`Verified visual context: ${desc.slice(0, 700)}.`);
  if (note) common.push(`User instruction: ${note.slice(0, 500)}.`);

  return common.join("\n");
}


export const IMAGE_SKILL_SOURCE_FLAG_PREFIX = "image_skill_source:";

export function isImageSkillTask(value: unknown): value is ImageSkillTask {
  return (
    value === "square_pad" ||
    value === "square_ai" ||
    value === "hero_enhance" ||
    value === "creative_hero" ||
    value === "ad_creative"
  );
}

export function isImageSkillQuality(value: unknown): value is ImageSkillQuality {
  return value === "economy" || value === "standard";
}

export function isImageSkillStyle(value: unknown): value is ImageSkillStyle {
  return (
    value === "chocho" ||
    value === "clean" ||
    value === "cute" ||
    value === "tech" ||
    value === "lifestyle"
  );
}

export function imageSkillUsesApi(task: ImageSkillTask): boolean {
  return task !== "square_pad";
}

export function imageSkillSourceFlagKey(imageId: string): string {
  return `${IMAGE_SKILL_SOURCE_FLAG_PREFIX}${imageId}`;
}

function stringFlags(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") result[key] = value;
    else if (value != null && typeof value !== "object") result[key] = String(value);
  }
  return result;
}

export function markImageSkillSource(
  flags: unknown,
  imageId: string,
  task: Exclude<ImageSkillTask, "ad_creative">
): Record<string, string> {
  return {
    ...stringFlags(flags),
    [imageSkillSourceFlagKey(imageId)]: task
  };
}

export function clearImageSkillSource(
  flags: unknown,
  imageId: string
): Record<string, string> {
  const next = stringFlags(flags);
  delete next[imageSkillSourceFlagKey(imageId)];
  return next;
}

export function hasImageSkillSource(flags: unknown, imageId: string): boolean {
  return Boolean(stringFlags(flags)[imageSkillSourceFlagKey(imageId)]);
}

export function imageSkillSourceTask(
  flags: unknown,
  imageId: string
): string | null {
  return stringFlags(flags)[imageSkillSourceFlagKey(imageId)] ?? null;
}
