/**
 * D8b-open: Showmore copy template v2 at **export boundary only**.
 *
 * - Rule assembly is deterministic and free (Q1-A: never write showmore_* DB columns).
 * - Does NOT mutate Shopify / draft title_zh / description_html storage.
 * - Q5-A: rewriteMode is always "rules"; LLM hook is documented only (no live call).
 * - Q4-B: footer defaults live in code (zero migration / zero team_settings).
 *
 * Template source: 【文案·三之五】Showmore 文案模板 v2.
 */

import { extractFaqPairs, normalizeDescriptionToPlainText } from "@/lib/contentGenerator/htmlFormat";
import { pickScenarioKeywords } from "@/lib/contentGenerator/scenarioKeywords";
import { normalizeProductTypeForDisplay } from "@/lib/productTypeLabels";

/** Future: "llm_optional" would call a cheap model; D8b-open never enables it. */
export type ShowmoreRewriteMode = "rules" | "llm_optional";

export interface ShowmoreCopyDraftInput {
  title_zh?: string | null;
  taobao_title?: string | null;
  original_title?: string | null;
  ip_name?: string | null;
  character_name?: string | null;
  product_type?: string | null;
  description_html?: string | null;
  description_plain?: string | null;
  product_highlights?: string[] | null;
  generated_faq_html?: string | null;
  spec_text?: string | null;
  why_we_chose_it?: string | null;
}

export interface ShowmoreAssembledCopy {
  title: string;
  brief: string;
  /** Plain text body (template v2) before formatPlainTextAsHtml / video / embed. */
  descriptionPlain: string;
  /** Always "rules" in D8b-open (Q5-A). */
  rewriteMode: "rules";
}

const TITLE_TAIL = "收藏送禮推薦";

/** Q4-B: code-only public footer (not team_settings this pack). */
export const DEFAULT_SHOWMORE_FOOTER = [
  "【交貨方式說明】",
  "下單後依商品銷售狀態出貨：台灣現貨約 1–3 個工作天處理；預購／代購依到貨時程，頁面或聊聊會再說明。",
  "",
  "【運送方式說明】",
  "支援台灣本島常溫配送；離島與特殊商品以結帳可選物流為準。請確認收件資料正確，以免延誤。"
].join("\n");

/** Q3-A: stock + color-diff public FAQ when draft has none. */
export const DEFAULT_SHOWMORE_FAQ_PAIRS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "現在有現貨嗎？",
    answer:
      "庫存與出貨方式以商品頁銷售狀態為準；現貨會盡速出貨，預購／代購會標明預估時程。"
  },
  {
    question: "實品顏色會跟照片一樣嗎？",
    answer: "因螢幕色差與拍攝光源，實品色調可能略有差異，敬請見諒。"
  }
];

const SOURCE_PLATFORM_RE =
  /淘寶|天貓|閑魚|閒魚|1688|拼多多|抖音|小紅書|代購來源|貨源/gi;

/** Prices / currency inside copy (never write prices into Showmore body). */
const PRICE_IN_COPY_RE =
  /(?:NT\$|NT\s*|\$|¥|￥|元|圓)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:元|圓|塊錢)|售價\s*[:：]?\s*\d|定價\s*[:：]?\s*\d|成本\s*[:：]?\s*\d/gi;

const SECTION_HEADER_RE = /^([A-E])｜\s*(.*)$/;
const NOISE_TITLE_TERMS = [
  "日本正版",
  "正版授權",
  "正版",
  "批發",
  "代購",
  "熱賣",
  "爆款",
  "官方",
  "正品",
  "包郵"
];

function nf(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function stripNoise(value: string): string {
  let next = value;
  for (const term of NOISE_TITLE_TERMS) {
    next = next.split(term).join("");
  }
  return next.replace(/\s+/g, " ").trim();
}

/**
 * Strip source-platform names and in-copy prices (template iron rules 2–3).
 * Also drops empty lines left behind.
 */
export function sanitizeShowmoreCopyText(text: string): string {
  if (!text) return "";
  const cleaned = text
    .replace(SOURCE_PLATFORM_RE, "")
    .replace(PRICE_IN_COPY_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function draftDisplayTitle(draft: ShowmoreCopyDraftInput): string {
  return (
    nf(draft.title_zh) ||
    nf(draft.taobao_title) ||
    nf(draft.original_title) ||
    ""
  );
}

function resolveProductType(draft: ShowmoreCopyDraftInput): string {
  const raw = nf(draft.product_type);
  if (!raw) return "";
  return normalizeProductTypeForDisplay(raw);
}

/**
 * Parse A–E letter sections from Nestory plain description.
 * Returns map of letter → body lines (without header line).
 */
export function parseLetterSections(
  plain: string
): Partial<Record<"A" | "B" | "C" | "D" | "E", string>> {
  const text = normalizeDescriptionToPlainText(plain);
  if (!text) return {};

  const lines = text.split(/\r?\n/);
  const out: Partial<Record<"A" | "B" | "C" | "D" | "E", string>> = {};
  let current: "A" | "B" | "C" | "D" | "E" | null = null;
  const buf: string[] = [];

  const flush = () => {
    if (!current) return;
    const body = buf.join("\n").trim();
    if (body) out[current] = body;
    buf.length = 0;
  };

  for (const line of lines) {
    const match = line.trim().match(SECTION_HEADER_RE);
    if (match) {
      flush();
      current = match[1] as "A" | "B" | "C" | "D" | "E";
      const rest = (match[2] ?? "").trim();
      // Header may include inline title like "B｜商品亮點" — skip pure labels
      if (rest && !/^(開頭|商品亮點|適合誰|商品資訊|常見問題|FAQ)/i.test(rest)) {
        buf.push(rest);
      }
      continue;
    }
    if (current) buf.push(line);
  }
  flush();
  return out;
}

function pickFeaturePhrase(draft: ShowmoreCopyDraftInput, sections: ReturnType<typeof parseLetterSections>): string {
  const highlights = (draft.product_highlights ?? [])
    .map((h) => nf(h))
    .filter(Boolean);
  if (highlights[0]) {
    // Short first highlight for title slot
    return stripNoise(highlights[0]).replace(/[。．.！!？?]+$/g, "").slice(0, 12);
  }

  const b = sections.B ?? "";
  if (b) {
    const first = b
      .split(/\n/)
      .map((l) => l.replace(/^[・･•✔✓]\s*/, "").trim())
      .find(Boolean);
    if (first) return stripNoise(first).slice(0, 12);
  }

  return "";
}

function pickCategoryWord(draft: ShowmoreCopyDraftInput, productType: string): string {
  if (productType) {
    const scenarios = pickScenarioKeywords([productType], undefined, 1);
    if (scenarios[0]) return scenarios[0];
    return productType;
  }
  return "";
}

/**
 * Q2-A strict template v2 title:
 * `【{IP}】{主體}-{特色}｜{類別詞}｜收藏送禮推薦`
 * Missing parts are omitted (never fabricate).
 */
export function buildShowmoreTitle(draft: ShowmoreCopyDraftInput): string {
  const ip = nf(draft.ip_name);
  const character = nf(draft.character_name);
  const productType = resolveProductType(draft);
  const plain = normalizeDescriptionToPlainText(
    draft.description_html || draft.description_plain || ""
  );
  const sections = parseLetterSections(plain);
  const feature = pickFeaturePhrase(draft, sections);
  const category = pickCategoryWord(draft, productType);

  // 商品主體: character + type, de-dupe if type already in character text
  let core = "";
  if (character && productType) {
    core = character.includes(productType) || productType.includes(character)
      ? character
      : `${character}${productType}`;
  } else {
    core = character || productType;
  }

  // Fallback core from cleaned Shopify title (still different skeleton via IP + tail)
  if (!core) {
    const base = stripNoise(draftDisplayTitle(draft))
      .replace(/[【】\[\]（）()]/g, " ")
      .replace(/[|｜]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (ip && base.startsWith(ip)) {
      core = base.slice(ip.length).trim();
    } else {
      core = base;
    }
    // Drop trailing feature-ish pipes already in shopify title
    core = core.replace(/\s*[|｜].*$/, "").trim().slice(0, 28);
  }

  const parts: string[] = [];
  if (ip) parts.push(`【${ip}】`);

  let middle = core;
  if (middle && feature && !middle.includes(feature)) {
    middle = `${middle}-${feature}`;
  } else if (!middle && feature) {
    middle = feature;
  }
  if (middle) parts.push(middle);

  const head = parts.join("");
  const tailBits = [category, TITLE_TAIL].filter(Boolean);
  if (tailBits.length) {
    const segments = [head, ...tailBits].filter(Boolean);
    return sanitizeShowmoreCopyText(segments.join("｜"));
  }

  if (head) return sanitizeShowmoreCopyText(head);

  // Last resort: original display title (still sanitized)
  return sanitizeShowmoreCopyText(draftDisplayTitle(draft));
}

/**
 * One-line brief. Empty only when literally no IP/type/title signal.
 */
export function buildShowmoreBrief(draft: ShowmoreCopyDraftInput): string {
  const ip = nf(draft.ip_name);
  const productType = resolveProductType(draft);
  const scenarios = productType ? pickScenarioKeywords([productType], undefined, 2) : [];
  const scene = scenarios.length ? scenarios.join("、") : "收藏、日常使用與送禮";

  if (ip && productType) {
    return sanitizeShowmoreCopyText(
      `${ip}人氣${productType}，適合${scene}。`
    );
  }
  if (ip) {
    return sanitizeShowmoreCopyText(`${ip}人氣角色周邊，適合${scene}。`);
  }
  if (productType) {
    return sanitizeShowmoreCopyText(`${productType}周邊，適合${scene}。`);
  }

  const title = draftDisplayTitle(draft);
  if (title) {
    return sanitizeShowmoreCopyText(`${stripNoise(title).slice(0, 24)}，適合收藏與送禮。`);
  }
  return "";
}

function bulletizeHighlight(line: string): string {
  const t = line.replace(/^[・･•✔✓\-\s]+/, "").trim();
  if (!t) return "";
  return `✔ ${t}`;
}

function buildHighlightsBlock(
  draft: ShowmoreCopyDraftInput,
  sections: ReturnType<typeof parseLetterSections>
): string {
  const fromField = (draft.product_highlights ?? [])
    .map((h) => nf(h))
    .filter(Boolean)
    .slice(0, 5)
    .map(bulletizeHighlight)
    .filter(Boolean);

  if (fromField.length) return fromField.join("\n");

  const fromB = (sections.B ?? "")
    .split(/\n/)
    .map((l) => bulletizeHighlight(l))
    .filter(Boolean)
    .slice(0, 5);
  if (fromB.length) return fromB.join("\n");

  // why_we_chose as last soft source (only if short enough to be a "特色")
  const why = nf(draft.why_we_chose_it);
  if (why && why.length <= 80) {
    return bulletizeHighlight(why);
  }
  return "";
}

function buildInfoBlock(
  draft: ShowmoreCopyDraftInput,
  sections: ReturnType<typeof parseLetterSections>
): string {
  const lines: string[] = [];
  const push = (label: string, value: string) => {
    const v = sanitizeShowmoreCopyText(value);
    if (!v) return;
    // Skip if value is only punctuation
    if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(v)) return;
    lines.push(`➼ ${label}：${v}`);
  };

  const name = draftDisplayTitle(draft);
  push("商品名稱", name);
  push("IP", nf(draft.ip_name));
  push("角色", nf(draft.character_name));
  push("類型", resolveProductType(draft));

  const spec = nf(draft.spec_text);
  if (spec) {
    // Only factual lines; drop price-ish / source-ish leftovers
    const cleaned = sanitizeShowmoreCopyText(spec);
    if (cleaned) push("規格", cleaned.replace(/\n+/g, "；").slice(0, 200));
  }

  // D section bullets that look like facts (keep ➼ / ・ lines, skip empty headers)
  const dBody = sections.D ?? "";
  if (dBody) {
    for (const rawLine of dBody.split(/\n/)) {
      const line = rawLine.replace(/^[・･•➼\s]+/, "").trim();
      if (!line) continue;
      if (/^適用情境/.test(line)) {
        push("用途", line.replace(/^適用情境\s*[:：]?\s*/, ""));
        continue;
      }
      // Avoid duplicating labels we already emit
      if (/^(商品名稱|IP|角色|類型|規格)/.test(line)) continue;
      const sanitized = sanitizeShowmoreCopyText(line);
      if (sanitized && lines.length < 12) {
        lines.push(`➼ ${sanitized}`);
      }
    }
  }

  // C 適合誰 → 用途 if not already
  const c = nf(sections.C ?? "");
  if (c && !lines.some((l) => l.includes("用途"))) {
    push("適合", sanitizeShowmoreCopyText(c).replace(/\n+/g, " ").slice(0, 120));
  }

  return lines.join("\n");
}

function buildIntroBlock(
  sections: ReturnType<typeof parseLetterSections>,
  plainFallback: string
): string {
  const a = nf(sections.A ?? "");
  if (a) return sanitizeShowmoreCopyText(a);

  // No letter sections: take first 1–2 short paragraphs of whole plain text
  const plain = sanitizeShowmoreCopyText(plainFallback);
  if (!plain) return "";

  // If it still looks like letter soup without parse, strip letter headers
  const withoutHeaders = plain
    .split(/\n/)
    .filter((line) => !SECTION_HEADER_RE.test(line.trim()))
    .join("\n")
    .trim();

  const paras = withoutHeaders
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 2);

  return sanitizeShowmoreCopyText(paras.join("\n\n")).slice(0, 400);
}

function buildFaqBlock(draft: ShowmoreCopyDraftInput): string {
  const pairs = extractFaqPairs(draft.generated_faq_html ?? "");
  const usable = pairs
    .map((p) => ({
      question: sanitizeShowmoreCopyText(p.question),
      answer: sanitizeShowmoreCopyText(p.answer)
    }))
    .filter((p) => p.question && p.answer);

  const source = usable.length > 0 ? usable.slice(0, 6) : [...DEFAULT_SHOWMORE_FAQ_PAIRS];

  return source
    .map((p, i) => `Q${i + 1}：${p.question}\nA${i + 1}：${p.answer}`)
    .join("\n\n");
}

/**
 * Full plain description for Showmore 商品介紹 (before HTML).
 * Order: 介紹 → 特色 → 資訊 → FAQ → footer.
 * Sections with no evidence are omitted (except footer + FAQ which always have defaults).
 */
export function buildShowmoreDescriptionPlain(draft: ShowmoreCopyDraftInput): string {
  const raw = draft.description_html || draft.description_plain || "";
  const plain = normalizeDescriptionToPlainText(raw);
  const sections = parseLetterSections(plain);

  const blocks: string[] = [];

  const intro = buildIntroBlock(sections, plain);
  if (intro) {
    blocks.push(`商品介紹\n${intro}`);
  }

  const highlights = buildHighlightsBlock(draft, sections);
  if (highlights) {
    blocks.push(`商品特色\n${highlights}`);
  }

  const info = buildInfoBlock(draft, sections);
  if (info) {
    blocks.push(`商品資訊\n${info}`);
  }

  const faq = buildFaqBlock(draft);
  if (faq) {
    blocks.push(`常見問題 FAQ\n${faq}`);
  }

  blocks.push(DEFAULT_SHOWMORE_FOOTER);

  return sanitizeShowmoreCopyText(blocks.join("\n\n"));
}

/**
 * Assemble Showmore title / brief / description for one draft.
 * Always rules mode (Q5-A). LLM optional path is a no-op stub for future.
 */
export function assembleShowmoreCopy(
  draft: ShowmoreCopyDraftInput,
  options?: { rewriteMode?: ShowmoreRewriteMode }
): ShowmoreAssembledCopy {
  // Q5-A: ignore llm_optional — never call a model in this pack.
  void options?.rewriteMode;

  return {
    title: buildShowmoreTitle(draft),
    brief: buildShowmoreBrief(draft),
    descriptionPlain: buildShowmoreDescriptionPlain(draft),
    rewriteMode: "rules"
  };
}
