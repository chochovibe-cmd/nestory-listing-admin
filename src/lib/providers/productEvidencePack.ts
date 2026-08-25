export type ProductEvidenceClassification = {
  brand?: string | null;
  ip?: string | null;
  characters?: string[] | string | null;
  productType?: string | null;
};

export type ProductImageTextEvidence = {
  translated_text?: string | null;
  ocr_text?: string | null;
  sort_order?: number | null;
};

export type ProductEvidencePack = {
  classification: string[];
  raw_product_text: string[];
  variant_facts: string[];
  image_facts: string[];
  image_visible_text: string[];
  existing_specs: string[];
  web_product_facts: string[];
  ip_context: string[];
};

export type ProductEvidencePackInput = {
  rawTitle?: string | null;
  classification?: ProductEvidenceClassification | null;
  variantSummary?: string | null;
  existingSpec?: string | null;
  imageDescription?: string | null;
  imageTexts?: ProductImageTextEvidence[] | null;
  webSearchSummary?: string | null;
  ipContext?: string | null;
};

function uniqueLines(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    for (const rawLine of (value ?? "").split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      output.push(line);
    }
  }
  return output;
}

/** Existing per-image translated text is authoritative over its raw OCR twin. */
export function selectProductImageVisibleText(
  image: ProductImageTextEvidence,
): string | null {
  const translated = image.translated_text?.trim();
  if (translated) return translated;
  const ocr = image.ocr_text?.trim();
  return ocr || null;
}

function splitAggregateVision(value: string | null | undefined): {
  imageFacts: string[];
  visibleText: string[];
} {
  const text = value?.trim();
  if (!text) return { imageFacts: [], visibleText: [] };
  const visibleMarker = text.indexOf("【圖上文字】");
  if (visibleMarker === -1) {
    return {
      imageFacts: uniqueLines([text.replace("【外觀描述】", "")]),
      visibleText: [],
    };
  }
  return {
    imageFacts: uniqueLines([
      text.slice(0, visibleMarker).replace("【外觀描述】", ""),
    ]),
    visibleText: uniqueLines([
      text.slice(visibleMarker + "【圖上文字】".length),
    ]).filter((line) => line !== "（無）" && line !== "(無)"),
  };
}

export function buildProductEvidencePack(
  input: ProductEvidencePackInput,
): ProductEvidencePack {
  const classification = input.classification ?? {};
  const characters = Array.isArray(classification.characters)
    ? classification.characters
    : (classification.characters ?? "").split(/[・、,，/]+/u);
  const aggregate = splitAggregateVision(input.imageDescription);
  const imageVisibleText = (input.imageTexts ?? [])
    .slice()
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map(selectProductImageVisibleText);

  return {
    classification: uniqueLines([
      classification.brand?.trim() ? `品牌：${classification.brand.trim()}` : null,
      classification.ip?.trim() ? `IP：${classification.ip.trim()}` : null,
      characters.map((value) => value.trim()).filter(Boolean).length > 0
        ? `角色：${characters.map((value) => value.trim()).filter(Boolean).join("・")}`
        : null,
      classification.productType?.trim()
        ? `商品類型：${classification.productType.trim()}`
        : null,
    ]),
    raw_product_text: uniqueLines([input.rawTitle]),
    variant_facts: uniqueLines([input.variantSummary]),
    image_facts: aggregate.imageFacts,
    image_visible_text: uniqueLines([...aggregate.visibleText, ...imageVisibleText]),
    existing_specs: uniqueLines([input.existingSpec]),
    web_product_facts: uniqueLines([input.webSearchSummary]),
    ip_context: uniqueLines([input.ipContext]),
  };
}

const SECTION_LABELS: Array<[keyof ProductEvidencePack, string]> = [
  ["classification", "classification｜人工／已保存分類"],
  ["raw_product_text", "raw_product_text｜原始商品文字"],
  ["variant_facts", "variant_facts｜款式／選項明確資料"],
  ["existing_specs", "existing_specs｜既有顧客規格"],
  ["image_visible_text", "image_visible_text｜圖上實際文字"],
  ["web_product_facts", "web_product_facts｜可信同款網搜"],
  ["image_facts", "image_facts｜圖片客觀外觀"],
  ["ip_context", "ip_context｜IP／角色語境（不可作商品數字來源）"],
];

/** Stable prompt serialization: typed sections stay separate instead of concat soup. */
export function formatProductEvidencePack(pack: ProductEvidencePack): string {
  const sections = SECTION_LABELS
    .filter(([key]) => pack[key].length > 0)
    .map(([key, label]) => `【${label}】\n${pack[key].map((line) => `- ${line}`).join("\n")}`);
  return [
    "【ONE PRODUCT EVIDENCE PACK｜COPY C1.4】",
    "信任順序：已保存 clean field > Variant > 原始商品文字 > 圖上實際文字 > 可信同款網搜 > 圖片客觀外觀 > IP 背景。",
    "精確數字只能取自明確文字；來源衝突時略過衝突事實，不要自行挑一個。IP context 只供語境。",
    ...sections,
  ].join("\n\n");
}
