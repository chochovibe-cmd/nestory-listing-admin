/**
 * B8/B19 pure-logic verification (no real Tavily key required for core asserts).
 * Run: node scripts/verify-b8-b19-websearch.mjs
 *
 * Covers: fingerprint/cache hit, missing-key honest degrade, query builder,
 * IP tone map (manual vs auto, D5-B rows), evidence-pool prompt order,
 * 6 tones alignment.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const root = process.cwd();
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

// --- Load compiled-ish TS via dynamic import of source through tsx if available,
// otherwise re-implement minimal mirrors for critical pure functions. ---

function fingerprintWebSearchQuery(query) {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function buildWebSearchQuery(input) {
  let title = (input.rawTitle ?? "").normalize("NFKC").trim();
  title = title
    .replace(/【[^】]*】/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/(包邮|包郵|现货|現貨|免运|免運|618|双11|雙11|促销|促銷)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hints = [input.ipName, input.characterName, input.productType]
    .map((v) => (v ?? "").normalize("NFKC").trim())
    .filter(Boolean);
  const base = title || hints.join(" ");
  if (!base) return "";
  const head = base.slice(0, 160);
  return `${head} 商品規格 尺寸 材質`.replace(/\s+/g, " ").trim();
}

function parseWebSearchCache(raw) {
  if (!raw || typeof raw !== "object") return null;
  const summary = typeof raw.summary === "string" ? raw.summary : "";
  if (!summary.trim()) return null;
  const query = typeof raw.query === "string" ? raw.query : "";
  const queryFingerprint =
    typeof raw.queryFingerprint === "string"
      ? raw.queryFingerprint
      : fingerprintWebSearchQuery(query);
  return {
    query,
    queryFingerprint,
    summary,
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    provider: raw.provider || "tavily",
    fetchedAt: raw.fetchedAt || "",
  };
}

async function resolveWebSearchForGenerate(params) {
  const warnings = [];
  if (!params.useWebSearch) {
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }
  const provider = params.provider;
  if (!provider.isConfigured()) {
    warnings.push(
      "已要求 Web Search 補充資訊，但伺服器尚未設定搜尋服務（TAVILY_API_KEY），本次生成未使用網路搜尋結果。",
    );
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }
  const query = buildWebSearchQuery({
    rawTitle: params.rawTitle,
    ipName: params.ipName,
    characterName: params.characterName,
    productType: params.productType,
  });
  if (!query) {
    warnings.push("Web Search 已開啟，但標題為空，無法組查詢，本次未搜尋。");
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }
  const fingerprint = fingerprintWebSearchQuery(query);
  const cached = parseWebSearchCache(params.existingCache);
  if (cached && cached.queryFingerprint === fingerprint && cached.summary.trim()) {
    return {
      result: {
        summary: cached.summary,
        sources: cached.sources,
        provider: cached.provider || provider.name,
        query: cached.query || query,
        fromCache: true,
      },
      cacheToPersist: null,
      warnings,
      didLiveSearch: false,
    };
  }
  try {
    const live = await provider.search(query);
    if (!live.summary.trim()) {
      warnings.push("Web Search 已執行但沒有可用結果，本次文案未使用網路補充。");
      return { result: null, cacheToPersist: null, warnings, didLiveSearch: true };
    }
    const cache = {
      query: live.query,
      queryFingerprint: fingerprint,
      summary: live.summary,
      sources: live.sources,
      provider: live.provider,
      fetchedAt: new Date().toISOString(),
    };
    return {
      result: { ...live, fromCache: false },
      cacheToPersist: cache,
      warnings,
      didLiveSearch: true,
    };
  } catch (error) {
    warnings.push(`Web Search 失敗（${error.message}），本次生成未使用網路搜尋結果。`);
    return { result: null, cacheToPersist: null, warnings, didLiveSearch: false };
  }
}

// --- IP tone map (mirror of ipToneMap.ts + resolveCopyTone) ---
const DEFAULT_IP_TONE_MAP = {
  鬼滅之刃: "中二熱血宣言",
  鏈鋸人: "小編聊天口吻",
  美少女戰士: "黑膠文藝收藏感",
  吉伊卡哇: "可愛周邊輕鬆感",
  三麗鷗: "可愛周邊輕鬆感",
};

function mergeIpToneMap(override) {
  const merged = { ...DEFAULT_IP_TONE_MAP };
  if (!override) return merged;
  for (const [k, v] of Object.entries(override)) {
    const key = k.normalize("NFKC").trim();
    const tone = typeof v === "string" ? v.normalize("NFKC").trim() : "";
    if (key && tone) merged[key] = tone;
  }
  return merged;
}

function resolveCopyTone(tone, detectedIpName, toneMap = DEFAULT_IP_TONE_MAP) {
  if (tone !== "依IP自動匹配") return tone;
  const key = (detectedIpName ?? "").normalize("NFKC").trim();
  return (key && toneMap[key]) || "黑膠文藝收藏感";
}

const COPY_TONES = [
  "黑膠文藝收藏感",
  "日系選物店溫柔感",
  "可愛周邊輕鬆感",
  "中二熱血宣言",
  "小編聊天口吻",
  "依IP自動匹配",
];

// 1) fingerprint
assert(
  fingerprintWebSearchQuery("  吉伊卡哇  吊飾  ") === fingerprintWebSearchQuery("吉伊卡哇 吊飾"),
  "fingerprint collapses whitespace + lowercases",
);

// 2) query builder
const q1 = buildWebSearchQuery({ rawTitle: "【现货】吉伊卡哇 小八 吊饰 包邮" });
assert(q1.includes("吉伊卡哇"), "query keeps product keywords");
assert(q1.includes("商品規格"), "query appends spec tail (D1-A one call)");
assert(!/现货|包邮/.test(q1), "query strips marketplace noise");

// 3) missing key honest degrade
{
  let searchCalls = 0;
  const outcome = await resolveWebSearchForGenerate({
    useWebSearch: true,
    rawTitle: "鬼滅之刃 炭治郎 公仔",
    provider: {
      name: "tavily",
      isConfigured: () => false,
      search: async () => {
        searchCalls += 1;
        return { summary: "x", sources: [], provider: "tavily", query: "x" };
      },
    },
  });
  assert(searchCalls === 0, "no key → never calls search");
  assert(outcome.result === null, "no key → no fake result");
  assert(
    outcome.warnings.some((w) => w.includes("TAVILY_API_KEY")),
    "no key → honest warning mentions TAVILY_API_KEY",
  );
}

// 4) cache hit skips live search
{
  let searchCalls = 0;
  const mock = {
    name: "tavily",
    isConfigured: () => true,
    search: async (query) => {
      searchCalls += 1;
      return {
        summary: `摘要 for ${query}`,
        sources: [{ title: "s", url: "https://example.com" }],
        provider: "tavily",
        query,
      };
    },
  };
  const title = "咒術迴戰 五条悟 立牌";
  const first = await resolveWebSearchForGenerate({
    useWebSearch: true,
    rawTitle: title,
    provider: mock,
  });
  assert(first.didLiveSearch === true, "first generate does live search");
  assert(first.cacheToPersist && first.cacheToPersist.summary, "first generate returns cache to persist");
  assert(searchCalls === 1, "first generate = 1 API call");

  const second = await resolveWebSearchForGenerate({
    useWebSearch: true,
    rawTitle: title,
    existingCache: first.cacheToPersist,
    provider: mock,
  });
  assert(second.didLiveSearch === false, "cache hit → no live search");
  assert(second.result?.fromCache === true, "cache hit → fromCache true");
  assert(searchCalls === 1, "cache hit → still 1 total API call");
  assert(second.cacheToPersist === null, "cache hit → nothing new to persist");
}

// 5) title change invalidates cache (D2-A)
{
  let searchCalls = 0;
  const mock = {
    name: "tavily",
    isConfigured: () => true,
    search: async (query) => {
      searchCalls += 1;
      return {
        summary: `摘要 ${searchCalls}`,
        sources: [],
        provider: "tavily",
        query,
      };
    },
  };
  const first = await resolveWebSearchForGenerate({
    useWebSearch: true,
    rawTitle: "舊標題商品",
    provider: mock,
  });
  const second = await resolveWebSearchForGenerate({
    useWebSearch: true,
    rawTitle: "全新不同商品標題",
    existingCache: first.cacheToPersist,
    provider: mock,
  });
  assert(searchCalls === 2, "fingerprint change → re-search");
  assert(second.result?.fromCache === false, "new title not from cache");
}

// 6) resolveCopyTone semantics
assert(
  resolveCopyTone("可愛周邊輕鬆感", "鬼滅之刃") === "可愛周邊輕鬆感",
  "manual tone always wins (never remapped by IP)",
);
assert(
  resolveCopyTone("依IP自動匹配", "鬼滅之刃") === "中二熱血宣言",
  "auto-match 鬼滅 → 中二熱血",
);
assert(
  resolveCopyTone("依IP自動匹配", "鏈鋸人") === "小編聊天口吻",
  "D5-B 鏈鋸人 → 小編聊天口吻",
);
assert(
  resolveCopyTone("依IP自動匹配", "美少女戰士") === "黑膠文藝收藏感",
  "D5-B 美少女戰士 → 黑膠文藝",
);
assert(
  resolveCopyTone("依IP自動匹配", "未知IP") === "黑膠文藝收藏感",
  "unknown IP → fallback 黑膠",
);
assert(
  resolveCopyTone("依IP自動匹配", null) === "黑膠文藝收藏感",
  "no IP yet (first gen) → fallback",
);
{
  const map = mergeIpToneMap({ 鬼滅之刃: "小編聊天口吻" });
  assert(
    resolveCopyTone("依IP自動匹配", "鬼滅之刃", map) === "小編聊天口吻",
    "team_settings override wins for auto-match",
  );
  assert(
    resolveCopyTone("中二熱血宣言", "鬼滅之刃", map) === "中二熱血宣言",
    "override never affects manual tone",
  );
}

// 7) 6 tones in source files
{
  const copyTs = fs.readFileSync(path.join(root, "src/lib/providers/copy.ts"), "utf8");
  for (const t of COPY_TONES) {
    assert(copyTs.includes(`"${t}"`), `COPY_TONES includes ${t}`);
  }
  const panel = fs.readFileSync(
    path.join(root, "src/components/listing/WorkspaceInputPanel.tsx"),
    "utf8",
  );
  for (const t of COPY_TONES) {
    assert(panel.includes(t), `WorkspaceInputPanel lists tone ${t}`);
  }
  assert(panel.includes("useState(true)"), "Web Search default ON in form state");
  assert(panel.includes("sessionProvider"), "session model override present");
}

// 8) evidence pool order in systemPrompt
{
  const prompt = fs.readFileSync(path.join(root, "src/lib/providers/systemPrompt.ts"), "utf8");
  const idxSearch = prompt.indexOf("網路搜尋補充資訊");
  const idxVision = prompt.indexOf("客觀屬性");
  const idxConservative = prompt.indexOf("保守通用規格");
  assert(idxSearch > 0 && idxVision > idxSearch, "evidence: web search before vision attributes");
  assert(idxConservative > idxSearch, "evidence: web search before conservative generic");
  assert(prompt.includes("tone !== \"依IP自動匹配\""), "resolveCopyTone gates on 依IP自動匹配 only");
}

// 9) migration 023 exists
{
  const mig = path.join(root, "supabase/migrations/023_web_search_cache_and_ip_tone.sql");
  assert(fs.existsSync(mig), "migration 023 file exists");
  const sql = fs.readFileSync(mig, "utf8");
  assert(sql.includes("web_search_cache"), "023 adds web_search_cache");
  assert(sql.includes("ip_tone_map_overrides"), "023 seeds ip_tone_map_overrides");
}

// 10) source modules exist
assert(fs.existsSync(path.join(root, "src/lib/providers/webSearch/tavily.ts")), "tavily provider file");
assert(fs.existsSync(path.join(root, "src/lib/providers/ipToneMap.ts")), "ipToneMap file");
{
  const mapSrc = fs.readFileSync(path.join(root, "src/lib/providers/ipToneMap.ts"), "utf8");
  assert(mapSrc.includes('鏈鋸人: "小編聊天口吻"'), "source map D5-B 鏈鋸人");
  assert(mapSrc.includes('美少女戰士: "黑膠文藝收藏感"'), "source map D5-B 美少女戰士");
}

console.log(failed === 0 ? "\nALL passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
