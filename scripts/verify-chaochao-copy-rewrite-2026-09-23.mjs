/**
 * 2026-09-23 Chaochao copy rewrite: title contract, description HTML,
 * regen context, SEO post-process, search share, truncation plumbing.
 * Imports real modules. No live model or Tavily calls.
 * Run: node scripts/verify-chaochao-copy-rewrite-2026-09-23.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();

if (process.env.NESTORY_TS_IMPORT !== "1") {
  const loader = pathToFileURL(path.join(root, "scripts", "register-ts-loader.mjs")).href;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--import", loader, path.join(root, "scripts", "verify-chaochao-copy-rewrite-2026-09-23.mjs")],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NESTORY_TS_IMPORT: "1" },
    },
  );
  process.exit(result.status ?? 1);
}

const { finalizeProductTitle, parseTitleSegments, PRODUCT_TITLE_MAX_LENGTH } = await import(
  "../src/lib/contentGenerator/titleContract.ts"
);
const { parseCopySegments, COPY_SEGMENT_KEYS, COPY_OUTPUT_TRUNCATED_WARNING, generateWithParseRetry } = await import(
  "../src/lib/providers/copy.ts"
);
const { formatChaochaoSalesDescriptionHtml, descriptionPreviewHtml } = await import(
  "../src/lib/contentGenerator/htmlFormat.ts"
);
const { finalizeSeoTitleForTone, finalizeMetaDescriptionForTone } = await import(
  "../src/lib/contentGenerator/seoGenerator.ts"
);
const { buildCopySystemPrompt, buildFieldRegenUserMessage, buildFieldRegenSystemPrompt } = await import(
  "../src/lib/providers/systemPrompt.ts"
);
const { buildWebSearchQuery } = await import("../src/lib/providers/webSearch/index.ts");
const { extractRelevantExcerpt } = await import("../src/lib/providers/webSearch/tavily.ts");

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("OK:", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL:", name, err.message);
  }
}

check("all tones share one title prompt, Chaochao uses a short dedicated voice prompt", () => {
  const chaochao = buildCopySystemPrompt("潮巢導購版", "標準");
  const vinyl = buildCopySystemPrompt("黑膠文藝收藏感", "標準");
  assert.match(chaochao, /商品標題契約｜所有語氣共用/);
  assert.match(vinyl, /商品標題契約｜所有語氣共用/);
  assert.match(chaochao, /IP中文＋英文 × 品牌/);
  assert.match(vinyl, /IP中文＋英文 × 品牌/);
  assert.doesNotMatch(chaochao, /官網會再收成 60/);
  assert.doesNotMatch(chaochao, /開頭段＋四個「◈ 標題」/);
  assert.doesNotMatch(chaochao, /先寫買家真正在意的痛點/);
  assert.doesNotMatch(chaochao, /導購小標：依這件商品/);
  assert.match(chaochao, /商品介紹/);
  assert.match(chaochao, /收藏亮點/);
  assert.match(chaochao, /購買提醒/);
  assert.match(vinyl, /開頭段＋四個「◈ 標題」/);
  assert.match(vinyl, /鼓勵堆疊音譯變體/);
  assert.doesNotMatch(chaochao, /鼓勵堆疊音譯變體/);
  assert.match(chaochao, /把雨季變可愛一點/);
  assert.match(chaochao, /滑雪服主題造型/);
  assert.doesNotMatch(chaochao, /Hello Kitty 沒有嘴巴/);
  assert.doesNotMatch(chaochao, /把段落寫滿/);
  assert.doesNotMatch(chaochao, /像懂收藏的選物店主/);
  assert.doesNotMatch(chaochao, /不要停在「不僅是收藏品」/);
  assert.match(chaochao, /商品小編/);
  assert.match(chaochao, /文青可愛/);
  assert.match(chaochao, /粉絲才會點頭/);
  assert.match(chaochao, /資料少可以只有 1–2 題/);
  assert.doesNotMatch(chaochao, /摸起來比想像中還軟/);
  assert.doesNotMatch(chaochao, /痛點導購/);
  assert.doesNotMatch(chaochao, /商品介紹＋收藏亮點＋導購小標三段/);
  assert.match(vinyl, /為什麼這個商品值得在潮巢出現/);
  assert.doesNotMatch(vinyl, /連小八慵懶歪頭/);
  assert.doesNotMatch(vinyl, /粉絲才會點頭/);
  assert.ok(chaochao.length < vinyl.length, `Chaochao prompt should be shorter than shared tones (${chaochao.length} vs ${vinyl.length})`);
});

check("title assembly: English brand, Chinese fallback, no brand, omit filler third", () => {
  assert.equal(
    finalizeProductTitle({
      titleIp: "三麗鷗 Sanrio",
      titleBrand: "Bandai",
      titleItem: "家族米粒公仔吊飾盲盒",
      titleDiff: "隨機單盒",
    }),
    "三麗鷗 Sanrio × Bandai | 家族米粒公仔吊飾盲盒 | 隨機單盒",
  );
  assert.equal(
    finalizeProductTitle({
      titleIp: "寶可夢 Pokémon",
      titleBrand: "BRUNO",
      titleItem: "聯名多功能料理鍋／電熱鍋",
    }),
    "寶可夢 Pokémon × BRUNO | 聯名多功能料理鍋／電熱鍋",
  );
  assert.equal(
    finalizeProductTitle({
      rawTitle: "史努比 Snoopy | 多功能三明治機／華夫餅機 | 標準款",
      detectedIpDisplay: "史努比 Snoopy",
      titleItem: "多功能三明治機／華夫餅機",
    }),
    "史努比 Snoopy | 多功能三明治機／華夫餅機",
  );
  assert.equal(
    finalizeProductTitle({
      rawTitle: "Bandai × 三麗鷗 Sanrio | 家族米粒公仔吊飾盲盒 | 隨機單盒",
      detectedIpDisplay: "三麗鷗 Sanrio",
      detectedBrand: "Bandai",
      titleItem: "家族米粒公仔吊飾盲盒",
      titleDiff: "隨機單盒",
    }),
    "三麗鷗 Sanrio × Bandai | 家族米粒公仔吊飾盲盒 | 隨機單盒",
  );
});

check("long title trims by phrase, not mid-word", () => {
  const longItem = "超長精準商品名稱還有更多說明讓第二段變得很長需要整段詞組處理的尾巴HelloKittyAlias";
  const title = finalizeProductTitle({
    detectedIpDisplay: "三麗鷗 Sanrio",
    detectedBrand: "Bandai",
    titleItem: longItem,
    titleDiff: "隨機單盒附贈超長不必要的第三段說明文字繼續堆",
  });
  assert.ok(Array.from(title).length <= PRODUCT_TITLE_MAX_LENGTH, title);
  assert.match(title, /^三麗鷗/);
  assert.doesNotMatch(title, /標準款/);
  assert.equal(parseTitleSegments(title)[0], "三麗鷗 Sanrio × Bandai");
  assert.doesNotMatch(title, /KittyAli$/);
});

check("parser keeps assembler keys and 14 customer fields", () => {
  assert.equal(COPY_SEGMENT_KEYS.length, 14);
  const parsed = parseCopySegments(
    `[[enriched_title]]
三麗鷗 Sanrio × Bandai | 家族米粒公仔吊飾盲盒 | 隨機單盒
[[title_ip]]
三麗鷗 Sanrio
[[title_brand]]
Bandai
[[title_item]]
家族米粒公仔吊飾盲盒
[[title_diff]]
隨機單盒
[[generated_description_html]]
商品介紹
`,
    "test",
    "test",
  );
  assert.equal(parsed.titleBrand, "Bandai");
  assert.equal(parsed.titleItem, "家族米粒公仔吊飾盲盒");
});

check("new and old Chaochao description HTML remain readable", () => {
  const next = `商品介紹

今天的麵包坊由 Hello Kitty 值班。

收藏亮點
・圓滾滾麵包輪廓：看起來像剛出爐。
・柔軟絨毛：拿在手上有份量。

適合誰
・想送朋友一份會心一笑的人

商品資訊
・角色：Hello Kitty
・材質：絨毛`;
  const html = formatChaochaoSalesDescriptionHtml(next, null, true);
  assert.match(html, /<h2>商品介紹<\/h2>/);
  assert.match(html, /<h2>收藏亮點<\/h2>/);
  assert.match(html, /<h2>適合誰<\/h2>/);
  assert.match(html, /<h2>商品資訊<\/h2>/);
  assert.match(html, /&amp;|&lt;|<li>角色：Hello Kitty<\/li>/);

  const withCare = formatChaochaoSalesDescriptionHtml(`${next}

購買提醒
・毛絨拍鬆即可恢復蓬鬆感`);
  assert.match(withCare, /<h2>購買提醒<\/h2>/);
  assert.match(withCare, /<li>毛絨拍鬆即可恢復蓬鬆感<\/li>/);

  const escaped = formatChaochaoSalesDescriptionHtml("商品介紹\n\nA < B & C\n\n收藏亮點\n・1\n\n適合誰\n・2\n\n商品資訊\n・3");
  assert.match(escaped, /A &lt; B &amp; C/);

  const legacy = `商品介紹

想隨身帶著Pingu去冒險？

收藏亮點
・Pingu正版授權
・相機與錄影功能

導購小標：獨特的隨身配件

這款迷你相機吊飾兼具功能性和趣味性。`;
  const legacyHtml = descriptionPreviewHtml(legacy, "潮巢導購版");
  assert.match(legacyHtml, /<h2>獨特的隨身配件<\/h2>/);
  assert.doesNotMatch(legacyHtml, /<h2>商品資訊<\/h2>/);
});

check("non-SEO regen user message includes variant, note, search, IP context", () => {
  const regen = buildFieldRegenUserMessage({
    rawTitle: "Hello Kitty 麵包吊飾",
    saleStatus: "現貨",
    source: "淘寶",
    variantSummary: "Hello Kitty／大耳狗",
    note: "指定角色",
    webSearchSummary: "材質：絨毛。",
    ipKnowledgePromptBlock: "【IP背景】三麗鷗",
    regenerateField: "generated_description_html",
    currentValues: { generatedDescriptionHtml: "上一版" },
    tone: "潮巢導購版",
    copyLength: "標準",
  });
  assert.match(regen, /Hello Kitty／大耳狗/);
  assert.match(regen, /指定角色/);
  assert.match(regen, /材質：絨毛/);
  assert.match(regen, /【IP背景】三麗鷗/);
  const titleRegen = buildFieldRegenSystemPrompt("enriched_title", "黑膠文藝收藏感", "標準");
  assert.match(titleRegen, /商品標題契約/);
  assert.match(titleRegen, /\[\[title_item\]\]/);
});

check("Chaochao SEO drops 首選 stacking; other tones keep it; brand suffix is not doubled", () => {
  const chaochaoTitle = finalizeSeoTitleForTone("三麗鷗 麵包吊飾 | 潮巢 Nestory", ["交換禮物"], "潮巢導購版");
  assert.match(chaochaoTitle, /潮巢 Nestory$/);
  assert.equal((chaochaoTitle.match(/潮巢 Nestory/g) ?? []).length, 1);
  assert.doesNotMatch(chaochaoTitle, /交換禮物/);
  const otherMeta = finalizeMetaDescriptionForTone("三麗鷗吊飾適合掛包。", ["交換禮物"], "黑膠文藝收藏感");
  assert.match(otherMeta, /首選/);
  const chaochaoMeta = finalizeMetaDescriptionForTone("三麗鷗吊飾適合掛包。", ["交換禮物"], "潮巢導購版");
  assert.doesNotMatch(chaochaoMeta, /首選/);
});

check("search supplements use seller evidence and manual note without AI vision claims", () => {
  const query = buildWebSearchQuery({
    rawTitle: "Hello Kitty 馬克杯",
    specText: "這段規格非常長而且會把額度吃光如果還是從頭截到尾不管後面的備註與圖片文字一二三四五六七八九十",
    note: "含杯蓋",
    imageDescription: "白色陶瓷杯身",
  });
  assert.match(query, /含杯蓋/);
  assert.doesNotMatch(query, /白色陶瓷/);
  const excerpt = extractRelevantExcerpt(
    "前言廣告促銷滿減包郵。本款尺寸約 10cm，材質絨毛，內含記憶卡槽。後面還有更多無關文字。",
    80,
  );
  assert.match(excerpt, /尺寸約 10cm/);
});

check("five fixture cases assemble title, 4-section HTML, Chaochao SEO", () => {
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(root, "docs/audits/fixtures/chaochao-copy-rewrite-2026-09-23.json"), "utf8"),
  );
  assert.equal(fixtures.kind, "非真實模型生成");
  assert.equal(fixtures.cases.length, 5);
  for (const item of fixtures.cases) {
    const title = finalizeProductTitle(item.titleParts);
    assert.equal(title, item.expectedTitle, item.id);
    assert.ok(Array.from(title).length <= PRODUCT_TITLE_MAX_LENGTH, item.id);
    const html = formatChaochaoSalesDescriptionHtml(item.description);
    assert.match(html, /<h2>商品介紹<\/h2>/, item.id);
    assert.match(html, /<h2>收藏亮點<\/h2>/, item.id);
    assert.match(html, /<h2>商品資訊<\/h2>/, item.id);
    assert.doesNotMatch(html, /導購小標/, item.id);
    const seoTitle = finalizeSeoTitleForTone(item.seoTitle, ["交換禮物"], "潮巢導購版");
    assert.match(seoTitle, /潮巢 Nestory$/);
    assert.doesNotMatch(seoTitle, /交換禮物|首選/);
    const meta = finalizeMetaDescriptionForTone(item.metaDescription, ["交換禮物"], "潮巢導購版");
    assert.doesNotMatch(meta, /首選/);
  }
});

check("truncation is reported without auto retry", () => {
  assert.match(COPY_OUTPUT_TRUNCATED_WARNING, /沒有自動重試/);
});

const truncatedOutput = await generateWithParseRetry(async () => ({
  text: "[[enriched_title]]\n三麗鷗 Sanrio | 吊飾\n[[generated_description_html]]\n商品介紹\n",
  truncated: true,
  usage: { inputTokens: 1, outputTokens: 1 },
}), "test", "claude-sonnet");
check("parse retry surfaces truncation flag", () => {
  assert.equal(truncatedOutput.outputTruncated, true);
});

if (failed) {
  console.error(`\nFAILED ${failed} check(s)`);
  process.exit(1);
}
console.log("chaochao copy rewrite verifier passed");
