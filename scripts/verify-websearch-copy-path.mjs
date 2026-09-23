/**
 * Reads the real search + prompt modules (not a copied mirror).
 * No live Tavily or model calls.
 * Run: node scripts/verify-websearch-copy-path.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = process.cwd();

if (process.env.NESTORY_TS_IMPORT !== "1") {
  const loader = pathToFileURL(path.join(root, "scripts", "register-ts-loader.mjs")).href;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--import", loader, path.join(root, "scripts", "verify-websearch-copy-path.mjs")],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NESTORY_TS_IMPORT: "1" },
    },
  );
  process.exit(result.status ?? 1);
}

const { buildWebSearchQuery, resolveWebSearchForGenerate } = await import(
  "../src/lib/providers/webSearch/index.ts"
);
const { selectRepresentativeVisionImages } = await import(
  "../src/lib/providers/visionProvider.ts"
);

const promptSource = fs.readFileSync(path.join(root, "src/lib/providers/systemPromptBase.ts"), "utf8");
const transpiled = ts.transpileModule(promptSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/^\s*import\s.+?;\s*$/gm, "");
const promptModulePath = path.join(os.tmpdir(), "nestory-system-prompt-check.mjs");
fs.writeFileSync(promptModulePath, transpiled);
const { buildCopyUserMessage, buildFieldRegenUserMessage } = await import(pathToFileURL(promptModulePath).href);

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

const query = buildWebSearchQuery({
  rawTitle: "Hello Kitty 馬克杯",
  specText: "材質：陶瓷 容量：300ml",
  note: "含杯蓋",
  imageDescription: "白色陶瓷杯身",
});
assert(query.includes("Hello Kitty"), "query keeps the title");
assert(query.includes("陶瓷"), "query includes spec text");
assert(query.includes("含杯蓋"), "query includes note");
assert(query.includes("白色陶瓷"), "query includes image description");
assert(query.includes("商品規格"), "query still asks for product specs");

const sparse = buildWebSearchQuery({
  rawTitle: "",
  specText: "壓克力立牌 15cm",
});
assert(sparse.includes("壓克力立牌"), "empty title can still search from spec");

const summary = "材質：陶瓷。尺寸：高 9cm。";
const fakeProvider = {
  name: "tavily",
  isConfigured: () => true,
  search: async (q) => ({
    summary,
    sources: [{ title: "規格頁", url: "https://example.test/spec" }],
    provider: "tavily",
    query: q,
  }),
};

const searched = await resolveWebSearchForGenerate({
  useWebSearch: true,
  rawTitle: "Hello Kitty 馬克杯",
  specText: "陶瓷",
  provider: fakeProvider,
});
assert(searched.didLiveSearch === true, "fake provider is actually called");
assert(searched.result?.summary === summary, "search summary is returned");

const fullPrompt = buildCopyUserMessage({
  rawTitle: "Hello Kitty 馬克杯",
  saleStatus: "現貨",
  source: "淘寶",
  webSearchSummary: summary,
  specText: "陶瓷 300ml",
});
assert(fullPrompt.includes(summary), "full generate prompt receives search summary");
assert(fullPrompt.includes("陶瓷 300ml"), "full generate prompt receives confirmed spec");
assert(fullPrompt.includes("不要原樣照抄"), "raw spec is source material, not the final spec");

const regenPrompt = buildFieldRegenUserMessage({
  rawTitle: "Hello Kitty 馬克杯",
  saleStatus: "現貨",
  source: "淘寶",
  webSearchSummary: summary,
  regenerateField: "generated_description_html",
  currentValues: { generatedDescriptionHtml: "上一版" },
});
assert(regenPrompt.includes(summary), "single-field regen prompt receives cached search summary");

const failedSearch = await resolveWebSearchForGenerate({
  useWebSearch: true,
  rawTitle: "Hello Kitty 馬克杯",
  provider: {
    name: "tavily",
    isConfigured: () => true,
    search: async () => {
      throw new Error("down");
    },
  },
});
assert(failedSearch.result === null, "search failure does not invent a result");
assert(failedSearch.warnings.some((line) => line.includes("未使用網路搜尋")), "search failure warns instead of pretending");

const picked = selectRepresentativeVisionImages([
  { imageType: "main", url: "m1", sortOrder: 0 },
  { imageType: "detail", url: "d1", sortOrder: 1 },
  { imageType: "detail", url: "d2", sortOrder: 2 },
  { imageType: "detail", url: "d3", sortOrder: 3 },
  { imageType: "detail", url: "d4", sortOrder: 4 },
  { imageType: "detail", url: "d5", sortOrder: 5 },
  { imageType: "detail", url: "d6", sortOrder: 6 },
  { imageType: "detail", url: "d7", sortOrder: 7 },
]);
assert(picked.length <= 6, "vision sample stays within 6 images");
assert(picked.some((row) => row.url === "m1"), "vision sample keeps a main image");
assert(picked.some((row) => row.url === "d7"), "vision sample reaches a later detail image");

if (failed > 0) {
  console.error(`${failed} web search path check(s) failed`);
  process.exit(1);
}
console.log("Web search copy path checks passed");
