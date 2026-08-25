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
]);

const CUSTOMER_SPEC_LABELS = new Map<string, string>([
  ["品牌", "品牌"],
  ["IP", "IP"],
  ["系列", "系列"],
  ["角色", "角色"],
  ["商品類型", "商品類型"],
  ["類型", "商品類型"],
  ["材質", "材質"],
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
]);

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

/**
 * Full-generation spec finalizer.
 * Provider spec wins when it is non-empty; existing OCR/spec_text is fallback only.
 * The chosen source is localized and source markers are stripped, then low-value
 * marketplace/admin labels are removed. Useful blind-box semantics are preserved.
 * No numbers or facts are invented here; this helper only keeps/relabels evidence text.
 */
export function finalizeCustomerSpecText(
  providerSpec: string | null | undefined,
  existingSpec: string | null | undefined,
): string | null {
  const provider = (providerSpec ?? "").trim();
  const providerBlank = !provider || provider === "（無）" || provider === "(無)";
  const selected = providerBlank ? (existingSpec ?? "") : provider;
  const localized = finalizeCustomerText(selected);
  if (!localized || localized === "（無）" || localized === "(無)") return null;

  const output: string[] = [];
  const seen = new Set<string>();
  let sawBlindBoxNoChoice = false;
  let sawRandom = false;

  for (const rawLine of localized.split(/\r?\n/u)) {
    const line = rawLine
      .replace(/^\s*[-*・•‧·]\s*/u, "")
      .trim();
    if (!line) continue;

    const parsed = splitSpecLine(line);
    if (!parsed) continue;
    const { label, value } = parsed;
    if (!value) continue;

    if (BACKEND_ONLY_SPEC_LABELS.has(label)) {
      const combined = `${label} ${value}`;
      if (/盲盒/u.test(combined) && /不可指定|不指定/u.test(combined)) {
        sawBlindBoxNoChoice = true;
      }
      if (/隨機/u.test(combined)) {
        sawRandom = true;
      }
      continue;
    }

    const canonicalLabel = CUSTOMER_SPEC_LABELS.get(label);
    if (!canonicalLabel) continue;

    if (canonicalLabel === "盲盒方式") {
      if (/不可指定|不指定/u.test(value)) sawBlindBoxNoChoice = true;
      if (/隨機/u.test(value)) sawRandom = true;
    }

    const normalizedLine = `${canonicalLabel}：${value}`;
    if (!seen.has(normalizedLine)) {
      seen.add(normalizedLine);
      output.push(normalizedLine);
    }
  }

  const hasBlindBoxLine = output.some((line) => line.startsWith("盲盒方式："));
  if (!hasBlindBoxLine && (sawBlindBoxNoChoice || sawRandom)) {
    const rule = sawRandom && sawBlindBoxNoChoice
      ? "隨機出貨，不可指定款式"
      : sawRandom
        ? "隨機出貨"
        : "不可指定款式";
    output.push(`盲盒方式：${rule}`);
  }

  return output.length > 0 ? output.join("\n") : null;
}
