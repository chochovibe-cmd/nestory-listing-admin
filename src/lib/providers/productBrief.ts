import { estimateCopyCostUsd, type CopyUsage, type RawUsage } from "./copy";
import { COPY_TIMEOUT_MS, externalTimeoutMessage, externalTimeoutSignal, isExternalTimeout } from "./externalTimeout";

export const PRODUCT_BRIEF_VERSION = "pb1.3-20261006";

export type ProductBrief = {
  version: string;
  identity: {
    ip: string;
    character: string;
    productType: string;
    brand: string;
    category: string;
    sku: string;
  };
  title: {
    enrichedTitle: string;
    ip: string;
    brand: string;
    item: string;
    diff: string;
  };
  confirmedFacts: string[];
  differentiators: string[];
  useCases: string[];
  fanHooks: string[];
  specLines: string[];
  unknowns: string[];
  rejectedEvidence: string[];
};

export type ProductBriefInput = {
  rawTitle: string;
  saleStatus: string;
  source?: string;
  variantSummary?: string;
  note?: string | null;
  imageDescription?: string | null;
  specText?: string | null;
  webSearchSummary?: string | null;
  ipKnowledgePromptBlock?: string | null;
  knownIpNames?: string[];
  existingIp?: string | null;
  existingCharacter?: string | null;
  existingProductType?: string | null;
  existingBrand?: string | null;
  existingSku?: string | null;
};

export type ProductBriefResult = {
  brief: ProductBrief;
  writerText: string;
  model: string;
  usage?: CopyUsage;
  fallback: boolean;
  warning?: string;
};

function clamp(value: string | null | undefined, max: number): string {
  return (value ?? "").normalize("NFKC").trim().slice(0, max);
}

function strings(value: unknown, maxItems = 8, maxLen = 180): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maxLen);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeBrief(raw: unknown, input: ProductBriefInput): ProductBrief {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const identityRaw =
    obj.identity && typeof obj.identity === "object" ? (obj.identity as Record<string, unknown>) : {};
  const titleRaw = obj.title && typeof obj.title === "object" ? (obj.title as Record<string, unknown>) : {};
  const read = (source: Record<string, unknown>, key: string, fallback = "") =>
    typeof source[key] === "string" ? (source[key] as string).normalize("NFKC").trim() : fallback;

  const productType = read(identityRaw, "productType", clamp(input.existingProductType, 80));
  const ip = read(identityRaw, "ip", clamp(input.existingIp, 80));
  const character = read(identityRaw, "character", clamp(input.existingCharacter, 120));
  const brand = read(identityRaw, "brand", clamp(input.existingBrand, 80));
  const sku = read(identityRaw, "sku", clamp(input.existingSku, 80));
  const category = read(identityRaw, "category", productType ? `型態_${productType}` : "");

  const titleIp = read(titleRaw, "ip", ip);
  const titleBrand = read(titleRaw, "brand", brand);
  const titleItem = read(titleRaw, "item", clamp(input.rawTitle, 120));
  const titleDiff = read(titleRaw, "diff", clamp(input.variantSummary, 100));
  const fallbackTitleHead = [titleIp, titleBrand].filter(Boolean).join(" × ");
  const fallbackTitle = [fallbackTitleHead, titleItem, titleDiff].filter(Boolean).join(" | ");

  return {
    version: PRODUCT_BRIEF_VERSION,
    identity: { ip, character, productType, brand, category, sku },
    title: {
      enrichedTitle: read(titleRaw, "enrichedTitle", fallbackTitle),
      ip: titleIp,
      brand: titleBrand,
      item: titleItem,
      diff: titleDiff,
    },
    confirmedFacts: strings(obj.confirmedFacts, 10, 220),
    differentiators: strings(obj.differentiators, 6, 180),
    useCases: strings(obj.useCases, 5, 160),
    fanHooks: strings(obj.fanHooks, 4, 180),
    specLines: strings(obj.specLines, 12, 180),
    unknowns: strings(obj.unknowns, 8, 180),
    rejectedEvidence: strings(obj.rejectedEvidence, 6, 180),
  };
}

function fallbackBrief(input: ProductBriefInput): ProductBrief {
  const facts = [
    input.rawTitle ? `原始標題：${clamp(input.rawTitle, 220)}` : "",
    input.variantSummary ? `款式：${clamp(input.variantSummary, 600)}` : "",
    input.note ? `備註：${clamp(input.note, 500)}` : "",
    input.imageDescription ? `圖片可見：${clamp(input.imageDescription, 700)}` : "",
    input.specText ? `規格素材：${clamp(input.specText, 900)}` : "",
  ].filter(Boolean);

  return normalizeBrief(
    {
      identity: {
        ip: input.existingIp ?? "",
        character: input.existingCharacter ?? "",
        productType: input.existingProductType ?? "",
        brand: input.existingBrand ?? "",
        sku: input.existingSku ?? "",
      },
      title: {
        ip: input.existingIp ?? "",
        brand: input.existingBrand ?? "",
        item: input.rawTitle,
        diff: input.variantSummary ?? "",
      },
      confirmedFacts: facts,
      differentiators: [],
      useCases: [],
      fanHooks: [],
      specLines: input.specText ? input.specText.split(/\r?\n/).slice(0, 12) : [],
      unknowns: ["Product Brief 模型未成功整理；Writer 僅可使用上述直接素材，不可補猜規格。"],
      rejectedEvidence: input.webSearchSummary ? ["網搜未經 Product Brief 同款判斷，本次 Writer 不直接使用。"] : [],
    },
    input,
  );
}

export function serializeProductBriefForWriter(brief: ProductBrief): string {
  const section = (label: string, values: string[]) =>
    values.length ? `${label}\n${values.map((value) => `- ${value}`).join("\n")}` : "";

  return [
    `【Product Brief｜${brief.version}｜內部商品理解，不是顧客文案】`,
    `商品身份\n- IP：${brief.identity.ip || "未確認"}\n- 角色：${brief.identity.character || "未確認"}\n- 品項：${brief.identity.productType || "未確認"}\n- 品牌／聯名方：${brief.identity.brand || "未確認"}`,
    `建議商品標題\n- ${brief.title.enrichedTitle || brief.title.item || "未整理"}`,
    section("已確認事實", brief.confirmedFacts),
    section("這件商品真正有差異的地方", brief.differentiators),
    section("生活／使用情境", brief.useCases),
    section("粉絲角度", brief.fanHooks),
    section("可安全寫入的規格", brief.specLines),
    section("仍未知，Writer 不可補猜", brief.unknowns),
  ].filter(Boolean).join("\n\n");
}

function evidenceMessage(input: ProductBriefInput): string {
  const known = (input.knownIpNames ?? []).slice(0, 120).join("、");
  return [
    `來源：${input.source || "淘寶"}`,
    `銷售狀態：${input.saleStatus}`,
    `原始標題：${clamp(input.rawTitle, 260) || "（無）"}`,
    input.variantSummary ? `款式：${clamp(input.variantSummary, 1200)}` : "",
    input.note ? `操作備註：${clamp(input.note, 800)}` : "",
    input.imageDescription ? `圖片辨識：${clamp(input.imageDescription, 1400)}` : "",
    input.specText ? `草稿既有規格（legacy candidate；可能由舊生成寫入，不能單獨證明尺寸／材質等高風險事實）：${clamp(input.specText, 1800)}` : "",
    input.webSearchSummary ? `網搜素材：\n${clamp(input.webSearchSummary, 3000)}` : "",
    input.ipKnowledgePromptBlock ? `IP 背景：\n${clamp(input.ipKnowledgePromptBlock, 900)}` : "",
    input.existingIp ? `草稿既有 IP：${clamp(input.existingIp, 100)}` : "",
    input.existingCharacter ? `草稿既有角色：${clamp(input.existingCharacter, 160)}` : "",
    input.existingProductType ? `草稿既有品項：${clamp(input.existingProductType, 100)}` : "",
    input.existingBrand ? `草稿既有品牌：${clamp(input.existingBrand, 100)}` : "",
    input.existingSku ? `草稿既有 SKU：${clamp(input.existingSku, 100)}` : "",
    known ? `已建檔 IP 名稱（命中時原樣使用）：${known}` : "",
  ].filter(Boolean).join("\n");
}

const SYSTEM_PROMPT = `你是 Nestory 商品資料編輯，不是文案寫手。先理解「這一件商品」再交棒給 Writer。

只輸出 JSON。工作目標：
1. 從賣家標題、款式、圖片、規格、備註辨認商品身份。
2. 網搜不是自動可信：只有能合理判斷為同款／同系列同規格的內容才可進 confirmedFacts 或 specLines；只有同 IP、同類型但不是同款的結果放 rejectedEvidence。
3. 網搜的「綜合摘要」只是搜尋服務整理出的候選線索，不是證據本身。任何尺寸、材質、配件、系列等商品事實，都要能在後面的來源標題／來源摘錄中看到同款身份線索（至少要對得上品牌／聯名方、品項或系列名稱）。如果來源標題明顯是另一品牌、另一系列或另一種商品，即使綜合摘要把它寫成目標商品，也必須丟 rejectedEvidence，不能拿那個來源的規格。
4. 當次直接證據優先：賣家標題／款式／操作備註／圖中文字 > 明確同款官方或零售資料 > 草稿既有分類與規格（legacy candidate） > 圖片可見外觀 > 泛網搜。
5. 草稿既有 IP、角色、品項、品牌與規格可能是前一次 AI／舊網搜留下的資料，只能當提示，不能蓋過當次賣家證據。若衝突，以當次直接證據為準；多角色／隨機盲盒不可只因草稿既有角色就縮成單一角色。既有 SKU 仍維持既有 authority。
6. 尺寸、材質、授權、年份、限定、庫存、到貨等高風險事實：草稿既有規格單獨出現不算直接證據；必須能由當次賣家標題／款式／操作備註／圖中文字，或明確同款官方／零售資料交叉支持。否則放 unknowns 或 rejectedEvidence，不得進 confirmedFacts／specLines。
7. 賣家服務／店鋪促銷不是商品物理事實：保固、售後、退換、贈品、滿額、店鋪活動、客服承諾、物流時效等不要放進 confirmedFacts、differentiators、useCases、fanHooks 或 specLines。
8. differentiators 只留 3–6 個「換成同 IP 另一件商品就不一定成立」的差異。
9. fanHooks 是角色／主題造成的收藏心理或畫面，不可杜撰劇情設定。
10. 不要寫銷售文案、形容詞堆疊、SEO 句子。
11. 台灣繁中。手办→公仔／模型、钥匙扣→鑰匙圈、亚克力→壓克力、挂件→吊飾、毛绒→毛絨。
12. title.enrichedTitle 依「IP中文＋必要英文 × 品牌 | 精準品項 | 重要差異」整理；沒有品牌就省略，不硬塞。
13. SKU：既有 SKU 優先；沒有才依 CHO-{型態縮寫}-{IP縮寫}-{角色縮寫}-001 產生，縮寫 2–3 碼大寫英文。無法可靠縮寫可留空。

JSON schema:
{
  "identity":{"ip":"","character":"","productType":"","brand":"","category":"","sku":""},
  "title":{"enrichedTitle":"","ip":"","brand":"","item":"","diff":""},
  "confirmedFacts":[""],
  "differentiators":[""],
  "useCases":[""],
  "fanHooks":[""],
  "specLines":["項目：內容"],
  "unknowns":[""],
  "rejectedEvidence":[""]
}`;

export async function buildProductBrief(input: ProductBriefInput): Promise<ProductBriefResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_BRIEF_MODEL?.trim() || "gpt-4o-mini";
  if (!apiKey) {
    const brief = fallbackBrief(input);
    return {
      brief,
      writerText: serializeProductBriefForWriter(brief),
      model: "deterministic-fallback",
      fallback: true,
      warning: "OPENAI_API_KEY 不可用，Product Brief 使用保守整理；未把未判定網搜直接交給 Writer。",
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: externalTimeoutSignal(COPY_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: evidenceMessage(input) },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Product Brief failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
    }

    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("Product Brief response was empty.");

    const brief = normalizeBrief(JSON.parse(text), input);
    const u = payload?.usage ?? {};
    const cached = Number(u?.prompt_tokens_details?.cached_tokens) || 0;
    const rawUsage: RawUsage = {
      inputTokens: Math.max((Number(u.prompt_tokens) || 0) - cached, 0),
      outputTokens: Number(u.completion_tokens) || 0,
      cachedInputTokens: cached,
      cacheCreationTokens: 0,
    };

    return {
      brief,
      writerText: serializeProductBriefForWriter(brief),
      model,
      fallback: false,
      usage: { ...rawUsage, costUsd: estimateCopyCostUsd(model, rawUsage) },
    };
  } catch (error) {
    if (isExternalTimeout(error)) {
      error = new Error(externalTimeoutMessage("copy"));
    }
    const brief = fallbackBrief(input);
    return {
      brief,
      writerText: serializeProductBriefForWriter(brief),
      model: "deterministic-fallback",
      fallback: true,
      warning: `Product Brief 整理失敗，已改用保守 fallback：${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

export function applyProductBriefToCopyOutput<T extends {
  enrichedTitle: string;
  detectedIpName: string;
  detectedCharacterName: string;
  detectedProductType: string;
  detectedProductBrand: string;
  detectedCategory: string;
  sku: string;
  spec?: string;
  titleIp?: string;
  titleBrand?: string;
  titleItem?: string;
  titleDiff?: string;
  usage?: CopyUsage;
}>(output: T, result: ProductBriefResult): T {
  const brief = result.brief;
  const writerUsage = output.usage;
  const briefUsage = result.usage;
  const usage =
    writerUsage || briefUsage
      ? {
          inputTokens: (writerUsage?.inputTokens ?? 0) + (briefUsage?.inputTokens ?? 0),
          outputTokens: (writerUsage?.outputTokens ?? 0) + (briefUsage?.outputTokens ?? 0),
          cachedInputTokens: (writerUsage?.cachedInputTokens ?? 0) + (briefUsage?.cachedInputTokens ?? 0),
          cacheCreationTokens: (writerUsage?.cacheCreationTokens ?? 0) + (briefUsage?.cacheCreationTokens ?? 0),
          costUsd: (writerUsage?.costUsd ?? 0) + (briefUsage?.costUsd ?? 0),
        }
      : undefined;

  return {
    ...output,
    enrichedTitle: brief.title.enrichedTitle || output.enrichedTitle,
    detectedIpName: brief.identity.ip || output.detectedIpName,
    detectedCharacterName: brief.identity.character || output.detectedCharacterName,
    detectedProductType: brief.identity.productType || output.detectedProductType,
    detectedProductBrand: brief.identity.brand || output.detectedProductBrand,
    detectedCategory:
      brief.identity.category ||
      (brief.identity.productType ? `型態_${brief.identity.productType}` : output.detectedCategory),
    sku: brief.identity.sku || output.sku,
    spec: brief.specLines.length ? brief.specLines.join("\n") : output.spec,
    titleIp: brief.title.ip || output.titleIp,
    titleBrand: brief.title.brand || output.titleBrand,
    titleItem: brief.title.item || output.titleItem,
    titleDiff: brief.title.diff || output.titleDiff,
    ...(usage ? { usage } : {}),
  };
}
