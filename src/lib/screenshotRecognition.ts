// B3: pure helpers for screenshot recognition fill planning + summary text.
// Keep side-effect free so UI and API can share the same 2A (only-empty) rules.

/** Align with visionProvider MAX_OCR_IMAGES — safe to import from client components. */
export const MAX_SCREENSHOT_IMAGES = 4;

export type ScreenshotMode = "product" | "spec";

export type RecognizedVariant = {
  name: string;
  costCny: number | null;
};

export type RecognitionFields = {
  title: string | null;
  costCny: number | null;
  features: string | null;
  specText: string | null;
  variants: RecognizedVariant[];
};

export type VariantRowLike = {
  name: string;
  sku: string;
  price: string;
  qty: string;
};

export type FillPlan = {
  /** Values to apply (only empty-target fields). */
  title: string | null;
  costCny: number | null;
  note: string | null;
  specText: string | null;
  variants: VariantRowLike[] | null;
  /** Human-readable lines for the yellow result notice. */
  filledLines: string[];
  /** Missing / skipped / kept-manual lines. */
  missingLines: string[];
  summary: string;
};

function isBlank(value: string | null | undefined): boolean {
  return !value || !value.trim();
}

function formatCost(costCny: number): string {
  // Prefer integer display when whole; keep one decimal when needed.
  if (Number.isInteger(costCny)) return String(costCny);
  return String(Math.round(costCny * 100) / 100);
}

function countSpecLines(specText: string): number {
  return specText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

/**
 * 2A：只填空白欄。回傳要套用的值＋「已填入／未辨識到」摘要。
 * mode=spec 時標題／成本／備註較不強調（仍可補空）；重點在規格＋款式。
 */
export function planScreenshotFill(
  current: {
    title: string;
    price: string;
    note: string;
    specText: string;
    variants: VariantRowLike[];
  },
  recognized: RecognitionFields,
  mode: ScreenshotMode = "product"
): FillPlan {
  const filledLines: string[] = [];
  const missingLines: string[] = [];

  let title: string | null = null;
  let costCny: number | null = null;
  let note: string | null = null;
  let specText: string | null = null;
  let variants: VariantRowLike[] | null = null;

  // --- 標題 ---
  if (mode === "product") {
    if (!isBlank(current.title)) {
      if (recognized.title) missingLines.push("標題已有內容，未覆蓋");
    } else if (recognized.title) {
      title = recognized.title.trim();
      filledLines.push("標題✓");
    } else {
      missingLines.push("未辨識到標題，請手填");
    }
  }

  // --- 成本 ¥ ---
  const hasCost =
    recognized.costCny != null &&
    Number.isFinite(recognized.costCny) &&
    recognized.costCny > 0;
  if (!isBlank(current.price)) {
    if (hasCost) missingLines.push("成本已有內容，未覆蓋");
  } else if (hasCost) {
    costCny = recognized.costCny as number;
    filledLines.push(`成本 ¥${formatCost(costCny)}✓`);
  } else if (mode === "product") {
    missingLines.push("未辨識到成本，請手填");
  }

  // --- 備註（特色） ---
  if (mode === "product") {
    if (!isBlank(current.note)) {
      if (recognized.features) missingLines.push("備註已有內容，未覆蓋");
    } else if (recognized.features?.trim()) {
      note = recognized.features.trim();
      filledLines.push("備註✓");
    } else {
      missingLines.push("未辨識到特色／備註（可手填）");
    }
  }

  // --- 規格 ---
  if (!isBlank(current.specText)) {
    if (recognized.specText) missingLines.push("規格已有內容，未覆蓋");
  } else if (recognized.specText?.trim()) {
    specText = recognized.specText.trim();
    const lines = countSpecLines(specText);
    filledLines.push(lines > 1 ? `規格 ${lines} 行✓` : "規格✓");
  } else {
    missingLines.push("未辨識到規格（可手填或留空由系統整理）");
  }

  // --- 款式（1A：僅當表單尚無任何有名稱的款式列時才填） ---
  const hasExistingVariants = current.variants.some((row) => row.name.trim());
  const recognizedVariants = (recognized.variants ?? []).filter((v) => v.name?.trim());
  if (hasExistingVariants) {
    if (recognizedVariants.length > 0) {
      missingLines.push("款式已有內容，未覆蓋");
    }
  } else if (recognizedVariants.length > 0) {
    variants = recognizedVariants.map((v) => ({
      name: v.name.trim(),
      sku: "",
      // 成本存進 price 欄（現有簡表用 price 當售價／成本混合；B7 會重做）
      // 這裡放 ¥ 成本字串，方便操作者對照；定價仍以上方主成本為準。
      price: v.costCny != null && v.costCny > 0 ? formatCost(v.costCny) : "",
      qty: ""
    }));
    filledLines.push(`款式 ${variants.length} 列✓`);
  } else if (mode === "spec") {
    missingLines.push("未辨識到款式列（可手動新增）");
  }

  const parts: string[] = [];
  if (filledLines.length > 0) {
    parts.push(`已填入：${filledLines.join("／")}`);
  } else {
    parts.push("已填入：（無，欄位皆已有內容或未辨識到可用資料）");
  }
  if (missingLines.length > 0) {
    parts.push(missingLines.join("；"));
  }

  return {
    title,
    costCny,
    note,
    specText,
    variants,
    filledLines,
    missingLines,
    summary: parts.join("。")
  };
}

/** Strip ```json fences and parse model output into RecognitionFields. */
export function parseRecognitionJson(raw: string): RecognitionFields {
  const empty: RecognitionFields = {
    title: null,
    costCny: null,
    features: null,
    specText: null,
    variants: []
  };
  if (!raw?.trim()) return empty;

  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  // Try object substring if model added prose.
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const title =
      typeof data.title === "string" && data.title.trim() ? data.title.trim() : null;
    let costCny: number | null = null;
    const costRaw = data.costCny ?? data.cost_cny ?? data.priceCny ?? data.price;
    if (typeof costRaw === "number" && Number.isFinite(costRaw) && costRaw > 0) {
      costCny = costRaw;
    } else if (typeof costRaw === "string") {
      const n = Number(costRaw.replace(/[^\d.]/g, ""));
      if (Number.isFinite(n) && n > 0) costCny = n;
    }
    const features =
      typeof data.features === "string" && data.features.trim()
        ? data.features.trim()
        : typeof data.highlights === "string" && data.highlights.trim()
          ? data.highlights.trim()
          : null;
    const specText =
      typeof data.specText === "string" && data.specText.trim()
        ? data.specText.trim()
        : typeof data.spec_text === "string" && data.spec_text.trim()
          ? data.spec_text.trim()
          : typeof data.specs === "string" && data.specs.trim()
            ? data.specs.trim()
            : null;

    const variants: RecognizedVariant[] = [];
    const rawVariants = data.variants;
    if (Array.isArray(rawVariants)) {
      for (const item of rawVariants) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const name =
          typeof row.name === "string"
            ? row.name.trim()
            : typeof row.option === "string"
              ? row.option.trim()
              : "";
        if (!name) continue;
        let vCost: number | null = null;
        const vc = row.costCny ?? row.cost_cny ?? row.price;
        if (typeof vc === "number" && Number.isFinite(vc) && vc > 0) vCost = vc;
        else if (typeof vc === "string") {
          const n = Number(vc.replace(/[^\d.]/g, ""));
          if (Number.isFinite(n) && n > 0) vCost = n;
        }
        variants.push({ name, costCny: vCost });
      }
    }

    return { title, costCny, features, specText, variants };
  } catch {
    // Fallback: treat whole text as loose OCR blob → put into specText only.
    return {
      ...empty,
      specText: raw.trim().slice(0, 2000) || null
    };
  }
}
