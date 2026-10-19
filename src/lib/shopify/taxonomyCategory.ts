import { normalizeProductTypeForTags } from "@/lib/productTypeLabels";

const GID_PREFIX = "gid://shopify/TaxonomyCategory/";

function gid(suffix: string): string {
  return `${GID_PREFIX}${suffix}`;
}

const TYPE_TAG_PREFIX = "類型_";

/** 固定類型（tag 引擎正式輸出的 類型_ 值）→ Shopify TaxonomyCategory gid */
export const SHOPIFY_CATEGORY_BY_TYPE: Readonly<Record<string, string>> = {
  公仔模型: gid("tg-5-8-1-1"),
  景品: gid("tg-5-8-1-1"),
  PVC: gid("tg-5-8-1-1"),
  一番賞大賞: gid("tg-5-8-1-1"),
  一番賞小賞: gid("tg-5-8-1-1"),
  盲盒: gid("tg-5-8-1-1"),
  扭蛋: gid("tg-5-8-1-1"),
  黏土人: gid("tg-5-8-1-1"),
  可動模型: gid("tg-5-8-1-1"),
  盒玩: gid("tg-5-8-1-1"),
  食玩: gid("tg-5-8-1-1"),
  模型套組: gid("ae-2-6"),
  娃娃抱枕: gid("tg-5-8-11"),
  絨毛娃娃: gid("tg-5-8-11"),
  大型娃娃: gid("tg-5-8-11"),
  吊飾徽章: gid("aa-4-1"),
  壓克力立牌: gid("hg-3-13"),
  立牌: gid("hg-3-13"),
  桌面擺件: gid("hg-3-30"),
  展示收納: gid("hg-3-59"),
  複製畫海報: gid("hg-3-4-2-1"),
  掛畫裝飾: gid("hg-3-4-2-4"),
  燈具小物: gid("hg-13-9"),
  杯具餐具: gid("hg-11-10-5"),
  毛巾毯子: gid("hg-15-4"),
  生活雜貨: gid("hg"),
  手機殼: gid("el-4-8-4-13"),
  手機支架: gid("el-4-8-4-6"),
  藍牙耳機: gid("el-2-2-7-1-3"),
  藍牙音響: gid("el-2-2-10-4"),
  滑鼠墊: gid("el-7-8-8"),
  滑鼠: gid("el-7-9-12-11"),
  鍵盤: gid("el-7-9-12-8"),
  鍵帽: gid("el-7-9-11-3-2"),
  手把控制器: gid("el-7-9-12-5-3"),
  充電周邊: gid("el-7-15-5"),
  服飾: gid("aa-1"),
  包包: gid("aa-5-4"),
  帽子: gid("aa-2-17"),
  襪子: gid("aa-1-18"),
  飾品配件: gid("aa-6"),
  文具: gid("os-4"),
  貼紙: gid("tg-5-2-10"),
  筆記本: gid("os-4-9-9"),
  卡片票卡: gid("ae-2-2-3"),
  印章: gid("tg-5-2-8"),
  保溫杯瓶: gid("hg-11-3-10")
};

/** 自由字關鍵字（product_type 原文子字串）→ gid；比對時長字優先 */
export const SHOPIFY_CATEGORY_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ["手錶", gid("aa-6-11")],
  ["電腦包", gid("lb-15")],
  ["耳機包", gid("el-2-1-2-3")],
  ["文具包", gid("os-3-16")],
  ["吹風機", gid("hb-3-10-12-6")],
  ["加濕器", gid("hg-9-1-9")],
  ["按摩儀", gid("hb-3-11-8")],
  ["相機", gid("co-2")],
  ["音箱", gid("el-2-2-10-4")],
  ["夜燈", gid("hg-13-10")],
  ["檯燈", gid("hg-13-5")],
  ["臺燈", gid("hg-13-5")],
  ["燈", gid("hg-13-9")],
  ["浴巾", gid("hg-15-4-1-1")],
  ["毛巾", gid("hg-15-4-1-2")],
  ["手鍊", gid("aa-6-3")],
  ["手環", gid("aa-6-3")],
  ["拖鞋", gid("aa-8-7")],
  ["冰箱貼", gid("hg-3-56")],
  ["羽毛球拍", gid("sg-4-14-1-2-2")],
  ["保溫杯", gid("hg-11-3-10")],
  ["鼠標", gid("el-7-9-12-11")],
  ["擺件", gid("hg-3-30")],
  ["擺飾", gid("hg-3-30")],
  ["掛飾", gid("aa-4-8")]
];

// 長字優先；同長度保持表內原順序（Array.prototype.sort 為穩定排序）。
const KEYWORDS_LONGEST_FIRST: ReadonlyArray<readonly [string, string]> = [...SHOPIFY_CATEGORY_KEYWORDS].sort(
  (a, b) => b[0].length - a[0].length
);

function hasOwn(map: Readonly<Record<string, string>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

export function resolveShopifyCategoryId(input: {
  tags: readonly string[] | null | undefined;
  productType: string | null | undefined;
}): string | null {
  // 1. 依 tags 原順序，第一個 類型_ tag（正規化後）命中就回傳
  for (const tag of input.tags ?? []) {
    if (typeof tag !== "string" || !tag.startsWith(TYPE_TAG_PREFIX)) continue;
    const type = normalizeProductTypeForTags(tag.slice(TYPE_TAG_PREFIX.length));
    if (hasOwn(SHOPIFY_CATEGORY_BY_TYPE, type)) return SHOPIFY_CATEGORY_BY_TYPE[type];
  }

  // 2. product_type 原文
  const productType = normalizeProductTypeForTags((input.productType ?? "").trim());
  if (!productType) return null;
  if (hasOwn(SHOPIFY_CATEGORY_BY_TYPE, productType)) return SHOPIFY_CATEGORY_BY_TYPE[productType];
  for (const [keyword, categoryId] of KEYWORDS_LONGEST_FIRST) {
    if (productType.includes(keyword)) return categoryId;
  }

  return null;
}
