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
      return [
        "Clean editorial ecommerce photography.",
        "Background: warm white, cream, or soft neutral seamless surface.",
        "Lighting: one large soft key light from upper-left around 45 degrees with very gentle fill from the opposite side.",
        "Camera: natural 50mm-product-photo perspective, slightly above product level, no dramatic wide-angle distortion.",
        "Framing: product should occupy roughly 55-68% of frame width with at least 8% clear safe margin on every side.",
        "Surface and props: matte neutral surface; zero or one small neutral prop only.",
        "Shadow: soft believable contact shadow directly under the product.",
        "Avoid: glossy luxury staging, neon, fake bokeh, busy props, floating objects, excessive saturation."
      ].join(" ");
    case "cute":
      return [
        "Cute but tasteful editorial product photography.",
        "Background: soft cream or muted pastel, never candy-neon.",
        "Lighting: broad soft daylight with a gentle warm fill.",
        "Camera: natural 50mm perspective, slightly elevated, product shape must remain undistorted.",
        "Framing: product occupies about 55-65% of frame width with generous negative space.",
        "Props: at most two tiny simple props with rounded shapes; they must never overlap or compete with the product.",
        "Shadow: subtle soft contact shadow.",
        "Avoid: childish sticker collage, confetti overload, cartoon scenery, fake text, over-saturated pink."
      ].join(" ");
    case "tech":
      return [
        "Modern restrained tech campaign photography.",
        "Background: charcoal, cool grey, or off-white depending on product contrast.",
        "Lighting: crisp controlled key light with a soft rim, preserving readable material texture.",
        "Camera: clean 50-70mm product perspective with straight geometry and no fisheye look.",
        "Framing: product occupies roughly 58-70% of frame width and stays fully inside safe margins.",
        "Props: none or one minimal geometric surface only.",
        "Shadow: controlled soft contact shadow, not a floating glow.",
        "Avoid: cyberpunk neon, excessive reflections, holographic effects, fake UI graphics, clutter."
      ].join(" ");
    case "lifestyle":
      return [
        "Believable warm lifestyle product photography.",
        "Background: a real everyday setting such as a light wood desk, shelf, or soft fabric surface, kept simple.",
        "Lighting: natural window light from one side with realistic soft falloff.",
        "Camera: human-scale 50mm perspective, slightly above product level.",
        "Framing: product remains the clear hero at about 55-65% of frame width.",
        "Props: at most two context props, neutral and partially out of focus, never covering the product.",
        "Shadow: natural contact shadow matching the window-light direction.",
        "Avoid: staged influencer set, messy room, dramatic fake sunlight beams, hands unless explicitly requested."
      ].join(" ");
    case "chocho":
    default:
      return [
        "Chocho Nestory selection-store editorial product photography: clean, warm, playful only in small accents, never Taobao-promotional.",
        "Background: warm ivory or light cream seamless backdrop with a matte pale-wood or linen-like surface when useful.",
        "Lighting: large soft key light from upper-left around 45 degrees plus very light fill from the right; soft natural contrast.",
        "Camera: natural 50mm product-photo perspective, roughly 10-15 degrees above product level, no wide-angle distortion.",
        "Framing: product is clear and centered slightly low, occupying roughly 58-68% of frame width with at least 8% safe margin on all sides.",
        "Palette: cream, warm neutral, black details, with at most one restrained lime accent when it does not alter the product.",
        "Props: zero to two small neutral editorial props such as a ceramic tray, plain card, or tiny dried flower; never overlap the product.",
        "Shadow: soft believable contact shadow under the product.",
        "Avoid: seller badges, price graphics, neon gradients, fake packaging, excessive props, over-saturation, dramatic AI glow, floating product."
      ].join(" ");
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

  const common = [
    PRODUCT_FIDELITY,
    "Treat the source image itself as the only visual authority for product appearance. Do not infer packaging text, logos, colors, or accessories from descriptive metadata.",
    "No watermarks, price tags, seller badges, fake logos, promotional stickers, fake packaging copy, or invented readable text.",
    "Do not render any readable text unless explicitly requested; typography for ad creative is added later by the app.",
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
      "Keep the product itself faithful; improve only the surrounding background, spacing, lighting balance, and presentation.",
      "Keep the complete product visible. Target roughly 58-68% frame width and at least 8% clear margin on every edge.",
      "Prefer a simple studio/editorial composition with generous breathing room and a realistic contact shadow.",
      "If preserving the exact merchandise conflicts with the requested scene, simplify the scene instead of redrawing the product."
    );
  }

  if (input.task === "creative_hero") {
    common.push(
      "Create one refined campaign-style hero image using all references only to understand the same product and its real-life feel.",
      "The first reference is the identity anchor. Other references may guide texture, scale, and atmosphere but must never contribute new product parts or alternate designs.",
      "Keep the composition suitable as a Shopify primary image: full product visible, readable silhouette, uncluttered scene, realistic contact with the surface.",
      "Keep props behind or clearly separated from the product; never cover logos, character faces, accessories, or packaging details."
    );
  }

  if (input.task === "ad_creative") {
    common.push(
      "Create a premium 4:5 vertical advertising visual for an ecommerce product detail page.",
      "Use the product as the visual focus and create one strong selling-point composition, not a specification table.",
      "STRICT LAYOUT: keep the product and every prop entirely within the upper 60% of the frame.",
      "STRICT LAYOUT: the lower 40% must be a smooth empty continuation of the background with no product parts, props, shadows, badges, or decorative objects because the app will place Traditional Chinese typography there.",
      "Do not draw any text inside the image."
    );
    if (input.adHeadline?.trim()) {
      common.push(
        `The later typography will communicate this idea, so design the visual around it without drawing the words: ${input.adHeadline.trim().slice(0, 180)}.`
      );
    }
  }

  if (title) common.push(`Product context: ${title.slice(0, 180)}.`);
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
