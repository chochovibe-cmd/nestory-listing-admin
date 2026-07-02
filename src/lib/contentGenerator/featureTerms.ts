function normalizeFeatureSource(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/三丽鸥/g, '三麗鷗')
    .replace(/毛绒/g, '毛絨')
    .replace(/挂件/g, '掛件')
    .replace(/钥匙扣/g, '鑰匙圈')
    .replace(/亚克力/g, '壓克力')
    .replace(/滑雪装/g, '滑雪服')
    .replace(/睡衣装/g, '睡衣')
    .replace(/圣诞/g, '聖誕')
    .replace(/联名/g, '聯名')
    .replace(/校园/g, '校園')
    .replace(/吊牌/g, '吊牌')
    .replace(/\s+/g, ' ')
    .trim();
}

const FORBIDDEN_FEATURE_PATTERNS = [
  /日本正版/,
  /平台加價/,
  /千人加購/,
  /包郵/,
  /現貨/,
  /約\s*14\s*天/,
  /促銷|特價|熱賣|爆款|下殺/,
  /限定|稀有|絕版|官方授權|停產/,
];

const GENERIC_FEATURE_TERMS = new Set(['\u806f\u540d\u6b3e']);

const FEATURE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bFLASTA\b/i, 'FLASTA'],
  [/\u6f01\u592b\u5e3d[\s\S]*(\u76f8\u6a5f|\u651d\u5f71)|(\u76f8\u6a5f|\u651d\u5f71)[\s\S]*(\u6f01\u592b\u5e3d|\u5713\u6846\u773c\u93e1)|\u9ec3\u8272\u76f8\u6a5f/i, '\u6f01\u592b\u5e3d\u76f8\u6a5f\u6b3e'],
  [/\u651d\u5f71|\u76f8\u6a5f|camera/i, '\u651d\u5f71\u4e3b\u984c\u6b3e'],
  [/棒球|球棒|棒球帽|baseball/i, '棒球款'],
  [/滑雪服|滑雪款|滑雪|雪衣|ski/i, '滑雪服款'],
  [/聯名款|聯名|collab|collaboration/i, '聯名款'],
  [/小畫家|畫家|painter/i, '小畫家款'],
  [/生日款|生日|birthday/i, '生日款'],
  [/聖誕款|聖誕|christmas|xmas/i, '聖誕款'],
  [/和服|浴衣|kimono/i, '和服款'],
  [/校園款|校園|制服|學生|school/i, '校園款'],
  [/睡衣款|睡衣|pajama|pyjama/i, '睡衣款'],
  [/吊牌款|吊牌|tag/i, '吊牌款'],
  [/包包款|包包造型|手提包造型|背包造型/i, '包包款'],
];

function canUseFeatureTerm(term: string): boolean {
  if (!term.trim()) {
    return false;
  }

  if (FORBIDDEN_FEATURE_PATTERNS.some((pattern) => pattern.test(term))) {
    return false;
  }

  return true;
}

function addFeatureTerm(terms: string[], term: string) {
  const isGeneric = GENERIC_FEATURE_TERMS.has(term);

  if (isGeneric && terms.length > 0) {
    return;
  }

  if (!isGeneric) {
    const genericIndex = terms.findIndex((value) => GENERIC_FEATURE_TERMS.has(value));

    if (genericIndex >= 0) {
      terms.splice(genericIndex, 1);
    }
  }

  if (terms.length >= 2 || terms.includes(term) || !canUseFeatureTerm(term)) {
    return;
  }

  terms.push(term);
}
export function extractFeatureTerms(
  imageDescription: string | null | undefined,
  intro: string | null | undefined,
): string[] {
  const sourceText = normalizeFeatureSource([imageDescription, intro].filter(Boolean).join(' '));

  if (!sourceText) {
    return [];
  }

  const terms: string[] = [];

  for (const [pattern, term] of FEATURE_PATTERNS) {
    if (pattern.test(sourceText)) {
      addFeatureTerm(terms, term);
    }
  }

  return terms;
}
