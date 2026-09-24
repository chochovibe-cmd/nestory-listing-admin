import { externalTimeoutSignal, WEB_SEARCH_TIMEOUT_MS } from "../externalTimeout";
import type { WebSearchProvider, WebSearchSource } from "./types";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

type TavilyResponse = {
  answer?: string;
  results?: Array<{ title?: string; url?: string; content?: string }>;
  error?: string;
};

/**
 * Tavily free tier (~1,000 searches/month). Key: TAVILY_API_KEY (server-only).
 * Never log or return the key.
 */
export class TavilyWebSearchProvider implements WebSearchProvider {
  name = "tavily" as const;

  isConfigured(): boolean {
    return Boolean(process.env.TAVILY_API_KEY?.trim());
  }

  async search(query: string): Promise<{
    summary: string;
    sources: WebSearchSource[];
    provider: "tavily";
    query: string;
  }> {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("TAVILY_API_KEY is not configured on the server.");
    }

    const trimmed = query.trim();
    if (!trimmed) {
      return { summary: "", sources: [], provider: "tavily", query: trimmed };
    }

    const response = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: externalTimeoutSignal(WEB_SEARCH_TIMEOUT_MS),
      body: JSON.stringify({
        api_key: apiKey,
        query: trimmed,
        search_depth: "advanced",
        max_results: 8,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        `Tavily search failed (${response.status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await response.json()) as TavilyResponse;
    if (data.error) {
      throw new Error(`Tavily error: ${data.error}`);
    }

    const sources: WebSearchSource[] = (data.results ?? [])
      .map((row) => ({
        title: (row.title ?? "").trim() || (row.url ?? "").trim(),
        url: (row.url ?? "").trim(),
      }))
      .filter((row) => row.url);

    const summary = formatTavilySummary(trimmed, data.answer, data.results ?? [], sources);
    return { summary, sources, provider: "tavily", query: trimmed };
  }
}

function formatTavilySummary(
  query: string,
  answer: string | undefined,
  results: Array<{ title?: string; url?: string; content?: string }>,
  sources: WebSearchSource[],
): string {
  const lines: string[] = [
    `【網路搜尋結果｜查詢：${query}】`,
    // COPY-FIX-1：搜尋結果升級為「同款判斷後可正面使用」的證據；防幻覺紅線不變。
    "合理判斷與本商品同款時，可以把以下搜尋到的規格、功能、系列背景當作可用事實寫進文案；判斷不是同款或與賣家自標資訊矛盾時才捨棄。顧客文案不要標「來源：網路」或貼 URL；查無依據的精確規格數字仍不要寫進商品規格。",
  ];

  const answerText = (answer ?? "").trim();
  if (answerText) {
    lines.push("", "【綜合摘要】", answerText);
  }

  if (results.length > 0) {
    lines.push("", "【來源摘錄】");
    for (const row of results.slice(0, 8)) {
      const title = (row.title ?? "").trim() || "（無標題）";
      const url = (row.url ?? "").trim();
      const content = extractRelevantExcerpt(row.content ?? "", 400);
      lines.push(`- ${title}${url ? `（${url}）` : ""}`);
      if (content) lines.push(`  ${content}`);
    }
  }

  if (sources.length > 0) {
    lines.push("", "【來源清單】");
    for (const source of sources) {
      lines.push(`- ${source.title}: ${source.url}`);
    }
  }

  if (!answerText && results.length === 0) {
    return "";
  }

  return lines.join("\n");
}

const IDENTITY_OR_DESIGN_HINT =
  /商品|公仔|玩偶|娃娃|角色|人物|造型|外觀|系列|款式|聯名|限定|盲盒|授權|正版|IP|三麗鷗|Hello\s*Kitty|Kuromi|酷洛米|美樂蒂|布丁狗|大耳狗|玉桂狗|Pochacco|帕恰狗|蛋黃哥|史努比|迪士尼/i;
const SPEC_OR_USE_HINT =
  /尺寸|規格|材質|成分|重量|容量|配件|內容物|包裝|功能|cm|mm|公分|毫米|填充|絨毛|PVC|ABS|適用|使用|收納|可拆|可洗|充電|電池|記憶卡|耐熱|防水|承重|長\s*\d/i;
const RELEVANT_HINT = new RegExp(`${IDENTITY_OR_DESIGN_HINT.source}|${SPEC_OR_USE_HINT.source}`, "i");

export function extractRelevantExcerpt(content: string, maxLen = 400): string {
  const text = (content ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  const requestedLimit = Number.isFinite(maxLen) ? Math.floor(maxLen) : 400;
  const limit = Math.max(0, requestedLimit);
  if (!limit) return "";

  // Split before whitespace normalization so source line breaks remain useful sentence boundaries.
  // A dot between digits is a decimal point (for example, 1.5cm), not a sentence end.
  const decimalProtected = text.replace(/(\d)\.(\d)/g, "$1\uE000$2");
  const sentences = decimalProtected
    .split(/(?<=[。．！？!?；;.\n])/)
    .map((part) => part.replace(/\uE000/g, ".").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const key = sentence.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(sentence);
  }

  const identityIndex = unique.findIndex((sentence) => IDENTITY_OR_DESIGN_HINT.test(sentence));
  const specIndex = unique.findIndex((sentence) => SPEC_OR_USE_HINT.test(sentence));
  const selected = new Set<number>();
  if (identityIndex >= 0) selected.add(identityIndex);
  if (specIndex >= 0) selected.add(specIndex);

  // Add further relevant sentences while space remains; output order always follows the source.
  const ordered = [...selected].sort((a, b) => a - b);
  const charCount = (value: string) => Array.from(value).length;
  let used = ordered.reduce((sum, index, position) => sum + charCount(unique[index]) + (position ? 1 : 0), 0);
  for (let i = 0; i < unique.length; i += 1) {
    if (selected.has(i) || !RELEVANT_HINT.test(unique[i])) continue;
    const cost = charCount(unique[i]) + (selected.size ? 1 : 0);
    if (used + cost <= limit) {
      selected.add(i);
      used += cost;
    }
  }

  let excerpt = [...selected].sort((a, b) => a - b).map((index) => unique[index]).join(" ");
  if (excerpt) {
    if (charCount(excerpt) <= limit) return excerpt;
    // Share an overfull budget across representatives, then give unused space to the longer one.
    // This prevents a long identity sentence from consuming the spec/use representative's space.
    const representatives = [...selected].sort((a, b) => a - b).map((index) => unique[index]);
    if (representatives.length === 1) {
      return Array.from(representatives[0]).slice(0, limit).join("").trim();
    }
    const available = Math.max(0, limit - (representatives.length - 1));
    const initialShare = Math.floor(available / representatives.length);
    const lengths = representatives.map(charCount);
    const quotas = lengths.map((length) => Math.min(length, initialShare));
    let remaining = available - quotas.reduce((sum, quota) => sum + quota, 0);
    for (let i = 0; i < quotas.length && remaining > 0; i += 1) {
      const extra = Math.min(lengths[i] - quotas[i], remaining);
      quotas[i] += extra;
      remaining -= extra;
    }
    return representatives
      .map((sentence, index) => Array.from(sentence).slice(0, quotas[index]).join(""))
      .join(" ")
      .trim();
  }

  // No recognizable product facts: retain source context, with a bounded long-sentence fallback.
  const first = unique[0] ?? text.replace(/\s+/g, " ").trim();
  return Array.from(first).slice(0, limit).join("").trim();
}
