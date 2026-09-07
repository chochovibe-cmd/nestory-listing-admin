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
      body: JSON.stringify({
        api_key: apiKey,
        query: trimmed,
        search_depth: "basic",
        max_results: 5,
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
    for (const row of results.slice(0, 5)) {
      const title = (row.title ?? "").trim() || "（無標題）";
      const url = (row.url ?? "").trim();
      const content = (row.content ?? "").trim().slice(0, 400);
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
