import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import {
  stripCustomerSourceMarkers,
  stripCustomerSourceMarkersList,
} from "@/lib/providers/stripCustomerSourceMarkers";

/** COPY C1.1: customer-facing AI text must be Taiwan Traditional before persist. */
export function finalizeCustomerText(value: string | null | undefined): string {
  return stripCustomerSourceMarkers(
    localizeToTaiwanTraditionalText(value ?? ""),
  ).trim();
}

export function finalizeCustomerTextList(values: string[] | null | undefined): string[] {
  return stripCustomerSourceMarkersList(
    (values ?? [])
      .map((value) => localizeToTaiwanTraditionalText(value))
      .filter((value) => value.trim()),
  );
}

const BACKEND_ONLY_SPEC_LABELS = new Set([
  "分類",
  "貨品分類",
  "顏色分類",
  "適用人群",
  "是否為特殊用途化妝品",
  "流行趨勢詞",
  "場景類型",
  "適用節日",
  "賣家促銷",
  "賣家促銷欄",
  "平台活動",
  "平台活動欄",
  "促銷活動",
  "店鋪活動",
  "店鋪服務",
  "銷量",
  "優惠券",
  "包郵",
]);

const CUSTOMER_SPEC_LABELS = new Map<string, string>([
  ["品牌", "品牌"],
  ["IP", "IP"],
  ["系列", "系列"],
  ["角色", "角色"],
  ["商品類型", "商品類型"],
  ["類型", "商品類型"],
  ["材質", "材質"],
  ["商品材質", "材質"],
  ["主要材質", "材質"],
  ["尺寸", "尺寸"],
  ["容量", "容量"],
  ["重量", "重量"],
  ["數量", "數量"],
  ["包裝", "包裝"],
  ["內容物", "內容物"],
  ["配件", "配件"],
  ["款式", "款式"],
  ["功能", "功能"],
  ["盲盒方式", "盲盒方式"],
  ["盲盒規則", "盲盒方式"],
  ["授權資訊", "授權資訊"],
  ["授權", "授權資訊"],
  ["產地", "產地"],
  ["電源", "電源"],
  ["充電方式", "充電方式"],
  ["連線方式", "連線方式"],
  ["燈效", "燈效"],
  ["單體", "單體"],
  ["記憶體", "記憶體"],
  ["使用情境", "使用情境"],
  ["適用情境", "使用情境"],
  ["使用方式", "使用情境"],
  ["用途", "使用情境"],
]);

const SPEC_OUTPUT_ORDER = [
  "品牌", "IP", "系列", "角色", "商品類型", "材質", "尺寸", "容量", "重量",
  "數量", "功能", "配件", "內容物", "包裝", "款式", "盲盒方式", "使用情境",
  "授權資訊", "產地", "電源", "充電方式", "連線方式", "燈效", "單體", "記憶體",
];

const SELLER_OR_PLATFORM_PATTERN =
  /促銷|優惠|折扣|券|包郵|運費|銷量|評分|店鋪|客服|售後|退換|保固|贈品|滿減|立減|紅包/u;

function cleanSpecValue(value: string): string {
  return value
    .replace(/^[【\[（(]+/u, "")
    .replace(/[】\]）)]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSpecLine(line: string): { label: string; value: string } | null {
  const match = line.match(/^\s*([^：:]{1,24})\s*[：:]\s*(.+?)\s*$/u);
  if (!match) return null;
  return { label: match[1].trim(), value: cleanSpecValue(match[2]) };
}

export type SpecEvidenceClassification = {
  brand?: string | null;
  ip?: string | null;
  characters?: string[] | string | null;
  productType?: string | null;
};

export type SpecEvidenceMergeInput = {
  existingSpec?: string | null;
  classification?: SpecEvidenceClassification | null;
  variantFacts?: string | null;
  providerSpec?: string | null;
  imageEvidence?: string | string[] | null;
  webEvidence?: string | null;
};

export type SpecEvidenceMergeResult = {
  specText: string | null;
  warnings: string[];
};

type SpecSource = "existing" | "classification" | "variant" | "image" | "web" | "provider";
type SpecFact = { label: string; value: string; source: SpecSource };

function isSafeUnknownSpec(label: string, value: string): boolean {
  if (!label || label.length > 24 || SELLER_OR_PLATFORM_PATTERN.test(`${label} ${value}`)) return false;
  if (/^(名稱|商品名稱|標題|備註|說明|其他)$/u.test(label)) return false;
  return true;
}

function comparableSpecValue(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/約|大約|約為|\s+/gu, "");
}

function parseSpecEvidence(value: string | null | undefined, source: SpecSource): {
  facts: SpecFact[];
  sawBlindBoxNoChoice: boolean;
  sawRandom: boolean;
} {
  const localized = finalizeCustomerText(value);
  const facts: SpecFact[] = [];
  let sawBlindBoxNoChoice = false;
  let sawRandom = false;
  for (const rawLine of localized.split(/\r?\n/u)) {
    const line = rawLine
      .replace(/^\s*[-*・•‧·]\s*/u, "")
      .replace(/^(?:【外觀描述】|【圖上文字】)\s*/u, "")
      .trim();
    const parsed = splitSpecLine(line);
    if (!parsed || !parsed.value) continue;
    const { label, value: cleanValue } = parsed;
    const combined = `${label} ${cleanValue}`;
    if (/盲盒/u.test(combined) && /不可指定|不指定/u.test(combined)) sawBlindBoxNoChoice = true;
    if (/隨機/u.test(combined)) sawRandom = true;
    if (BACKEND_ONLY_SPEC_LABELS.has(label) || SELLER_OR_PLATFORM_PATTERN.test(combined)) continue;
    const canonicalLabel = CUSTOMER_SPEC_LABELS.get(label) ??
      (isSafeUnknownSpec(label, cleanValue) ? label : null);
    if (!canonicalLabel) continue;
    facts.push({ label: canonicalLabel, value: cleanValue, source });
  }
  return { facts, sawBlindBoxNoChoice, sawRandom };
}

function classificationFacts(
  classification: SpecEvidenceClassification | null | undefined,
): SpecFact[] {
  if (!classification) return [];
  const characters = Array.isArray(classification.characters)
    ? classification.characters
    : (classification.characters ?? "").split(/[・、,，/]+/u);
  const facts: SpecFact[] = [];
  if (classification.brand?.trim()) {
    facts.push({ label: "品牌", value: classification.brand.trim(), source: "classification" });
  }
  if (classification.ip?.trim()) {
    facts.push({ label: "IP", value: classification.ip.trim(), source: "classification" });
  }
  const characterText = characters.map((item) => item.trim()).filter(Boolean).join("・");
  if (characterText) facts.push({ label: "角色", value: characterText, source: "classification" });
  if (classification.productType?.trim()) {
    facts.push({
      label: "商品類型",
      value: classification.productType.trim(),
      source: "classification",
    });
  }
  return facts;
}

function variantEvidence(value: string | null | undefined): SpecFact[] {
  const parsed = parseSpecEvidence(value, "variant").facts;
  if (parsed.length > 0) return parsed;
  const clean = finalizeCustomerText(value)
    .replace(/(?:售價|成本)\s*(?:NT\$|NTD|RMB|¥|￥)?\s*\d+(?:\.\d+)?/giu, "")
    .replace(/\r?\n+/gu, "、")
    .replace(/\s{2,}/gu, " ")
    .trim();
  return clean ? [{ label: "款式", value: clean, source: "variant" }] : [];
}

function derivedUsageScenario(productType: string | undefined): string | null {
  if (!productType) return null;
  if (/吊飾|掛件|鑰匙圈/u.test(productType)) return "包包吊掛／鑰匙掛飾／收藏展示";
  if (/擺件|公仔/u.test(productType)) return "桌面擺放／收藏展示";
  return null;
}

/**
 * COPY C1.4 full-generation spec authority: clean every source, protect saved
 * owner facts, and merge every non-conflicting evidence key instead of letting
 * a short provider response replace the whole block.
 */
export function mergeCustomerSpecEvidence(
  input: SpecEvidenceMergeInput,
): SpecEvidenceMergeResult {
  const parsedSources = [
    parseSpecEvidence(input.existingSpec, "existing"),
    { facts: classificationFacts(input.classification), sawBlindBoxNoChoice: false, sawRandom: false },
    { facts: variantEvidence(input.variantFacts), sawBlindBoxNoChoice: false, sawRandom: false },
    parseSpecEvidence(Array.isArray(input.imageEvidence) ? input.imageEvidence.join("\n") : input.imageEvidence, "image"),
    parseSpecEvidence(input.webEvidence, "web"),
    parseSpecEvidence(input.providerSpec, "provider"),
  ];
  const factsByLabel = new Map<string, SpecFact>();
  const conflicted = new Set<string>();
  const warnings: string[] = [];
  const protectedSources = new Set<SpecSource>(["existing", "classification", "variant"]);

  for (const parsed of parsedSources) {
    for (const fact of parsed.facts) {
      if (conflicted.has(fact.label)) continue;
      const current = factsByLabel.get(fact.label);
      if (!current) {
        factsByLabel.set(fact.label, fact);
        continue;
      }
      if (comparableSpecValue(current.value) === comparableSpecValue(fact.value)) continue;
      if (protectedSources.has(current.source)) continue;
      factsByLabel.delete(fact.label);
      conflicted.add(fact.label);
      warnings.push(`規格「${fact.label}」來源衝突，已略過待人工確認。`);
    }
  }

  const sawBlindBoxNoChoice = parsedSources.some((parsed) => parsed.sawBlindBoxNoChoice);
  const sawRandom = parsedSources.some((parsed) => parsed.sawRandom);
  if (!factsByLabel.has("盲盒方式") && (sawBlindBoxNoChoice || sawRandom)) {
    const rule = sawRandom && sawBlindBoxNoChoice
      ? "隨機出貨，不可指定款式"
      : sawRandom
        ? "隨機出貨"
        : "不可指定款式";
    factsByLabel.set("盲盒方式", { label: "盲盒方式", value: rule, source: "existing" });
  }

  if (!factsByLabel.has("使用情境")) {
    const usage = derivedUsageScenario(factsByLabel.get("商品類型")?.value);
    if (usage) {
      factsByLabel.set("使用情境", { label: "使用情境", value: usage, source: "classification" });
    }
  }

  const orderedLabels = [
    ...SPEC_OUTPUT_ORDER.filter((label) => factsByLabel.has(label)),
    ...Array.from(factsByLabel.keys()).filter((label) => !SPEC_OUTPUT_ORDER.includes(label)),
  ];
  const specText = orderedLabels
    .map((label) => factsByLabel.get(label))
    .filter((fact): fact is SpecFact => Boolean(fact))
    .map((fact) => `${fact.label}：${fact.value}`)
    .join("\n");
  return { specText: specText || null, warnings: Array.from(new Set(warnings)) };
}

/** Backward-compatible wrapper for older callers and focused tests. */
export function finalizeCustomerSpecText(
  providerSpec: string | null | undefined,
  existingSpec: string | null | undefined,
): string | null {
  return mergeCustomerSpecEvidence({ providerSpec, existingSpec }).specText;
}
